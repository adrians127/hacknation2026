# Scan export and import format

What `GET /scans/{id}/export` writes and `POST /scans/import` reads. The format is SubSurf's own: one scan's results as the system shows them, plus what users set on its hosts. It builds on the locked [worker result format](worker-result-format.md), which stays the format of one worker run.

- **JSON** is the faithful format: exporting a scan and importing the file gives a scan with no change against the original.
- **CSV** is for spreadsheets and for other tools' data. It leaves out what does not fit a table.

## JSON document

```jsonc
{
  "format": "subsurf-scan",
  "version": 1,
  "exportedAt": "2026-11-22T03:10:00.000Z",
  "scan": {
    "id": "0193f0d0-…",
    "name": "Campus, nightly",
    "status": "completed",
    "createdAt": "2026-11-22T01:00:00.000Z",   // the scan's place among the others
    "startedAt": "2026-11-22T01:00:04.000Z",
    "finishedAt": "2026-11-22T01:32:43.000Z",
    "ports": "21-23,80,443,3306",
    "maxRate": 100,                             // 0 = not recorded
    "counts": { "addresses": 16384, "up": 252, "down": 16132, "timeout": 0,
                "cancelled": 0, "failed": 0, "openPorts": 624 }
  },
  "coverage": ["10.40.0.0/18"],
  "hosts": [ /* one entry per address that is not down */ ],
  "edits": {
    "hosts":    [{ "ip": "10.40.0.1", "triage": "important", "tags": ["dmz"], "note": "…" }],
    "services": [{ "ip": "10.40.0.1", "protocol": "tcp", "port": 22, "triage": "reviewed",
                   "tags": [], "note": "", "nameOverride": null,
                   "productOverride": "OpenSSH (hardened)", "versionOverride": null }]
  }
}
```

- **`hosts[]`** has the [host shape of a worker result](worker-result-format.md#hosts) (`ObservedHostSchema`), sensitive fields decrypted. It is the scan's merged view of each address: when several workers observed a host, the entry holds what the scan page shows, not each worker's own result.
- **`coverage`** lists the address blocks the scan has an observation for. **An address inside them without an entry in `hosts[]` was scanned and is `down`.** Addresses that timed out, were cancelled or failed are always listed, with their status. Without this rule a /16 file would be 65,000 `down` entries; without `down` answers an imported scan could never report a host as new or gone, because only `up` and `down` are conclusive.
- **`edits`** holds what users set, keyed by address (and port): ids do not survive an export. Only hosts and services somebody edited are listed. `ports[].service` stays what the scan observed; a user's correction is in `edits.services[].…Override`.
- `scan.id` and `scan.counts` are informative. An import recomputes the counts from `hosts[]` and `coverage`.

The response is streamed one host per line, so a scan with many page bodies is never held in memory whole. The schema is `ScanExportDocumentSchema` in `packages/contracts/src/scans/scan-export.schema.ts`.

## CSV

One row per HTTP endpoint. A port without HTTP, an `up` host without open ports and an address that is not `up` take one row each. Host columns repeat on every row of the host, port columns on every row of the port.

| Columns | Content |
|---|---|
| `ip`, `status`, `hostnames`, `observed_at`, `latency_ms` | The host. `hostnames` are separated by spaces |
| `host_triage`, `host_tags`, `host_note` | The host's edits. Tags are separated by commas |
| `protocol`, `port`, `service`, `product`, `version`, `extra_info`, `cpe`, `ssh_host_key` | The port and what was detected on it. CPEs are separated by spaces |
| `service_triage`, `service_tags`, `service_note`, `name_override`, `product_override`, `version_override` | The service's edits |
| `scheme`, `vhost`, `url`, `final_url`, `status_code`, `title` | One HTTP endpoint of the port |

- The covered blocks follow as rows with `status` = `down` and a CIDR (or an address) in `ip`: every address of the block without rows of its own is `down`.
- Cells that start with `=`, `+`, `-` or `@` get a leading `'`, so a spreadsheet does not run them as formulas. The import removes it again.
- **Not in the CSV:** response headers, cookies, redirects, page bodies, favicons, TLS certificates, banners, script output, probe results, where a hostname came from, and the scan's own parameters. A tag that contains a comma splits in two on import.
- After a CSV round trip no host or service is new or gone, services without HTTP data are unchanged, and services with HTTP data read as changed in the fields the CSV does not carry.

The columns and the header aliases are in `packages/contracts/src/scans/scan-csv.ts`.

## What an import accepts

`POST /scans/import` takes the file itself as the request body (`application/json` or `text/csv`, up to 64 MiB, gzip accepted):

| File | How it is imported |
|---|---|
| The JSON document above | One finished job per batch of covered addresses; the addresses the file leaves out are written as `down` |
| One [worker result](worker-result-format.md) `{ scan, hosts }`, or a list of them | Replayed as they are, one job each, with their worker id, timing and parameters. All must belong to one scan. `pnpm db:seed:hosts --json <dir>` writes such files |
| CSV with the columns above | As the JSON document. Only an address column is required: a row without a status is an `up` host, and rows that cannot be read are skipped and reported as warnings |

**Another tool's CSV** is read through the alias table (`SCAN_CSV_ALIASES`): `address` or `host` for `ip`, `service_name` for `service`, `http_title` for `title` and so on. Supporting a different column naming means adding its header names there, with a test.

Rules:

- **Same pipeline.** Every result goes through the ingest a worker's result goes through, so encryption at rest, port fingerprints and the Host/Service assets follow the same rules. Everything is written in one transaction: a failed import leaves nothing behind.
- **Placement.** The scan takes its place among the others by when the file says it ran (`scan.createdAt`, the earliest worker start, or the earliest `observed_at`), never in the future, and at the time of the import when the file does not say. An older file can therefore become the base scan of a newer scan.
- **Once.** The same content is imported once. A second upload answers `409 SCAN_ALREADY_IMPORTED` with the existing scan's id. Export time, the scan's id and the edits do not make a file different.
- **Edits** are applied only with `?edits=fill` (which also needs `hosts:update`), and only where the host or service has no value yet: tags are added, the triage is set while it is `unreviewed`, the note while it is empty, a correction while there is none. Nothing a user set is overwritten.
- **Older and hand-written files.** The result format grows with every worker (a port's `tls` list came with the tlsx worker). Keys a file leaves out are read as "nothing observed": a host needs only `ip` and `status`, a port only `port`, an HTTP endpoint only `scheme` and `url`, and a document may omit `coverage` and `edits`. What is there is validated strictly. The export itself always writes every key.
- **Limits:** 1,048,576 addresses, 20,000 hosts up, 4,096 worker results (`SCAN_IMPORT_LIMITS`).

The reader is `packages/contracts/src/scans/scan-import.ts`. The import page runs it for the preview and the backend runs the same code on the uploaded file.

## Sensitive data

An exported file holds decrypted response headers, cookies' metadata, certificates, banners and analysts' notes in plain text. Treat it like the database itself. Every role that may read scans (`scans:read`) may export them.
