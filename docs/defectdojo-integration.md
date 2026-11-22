# DefectDojo integration

What the local DefectDojo (3.5.201, `docker/`) offers SubSurf, what we can push and pull, and in which formats. Every claim here was checked against our running instance: its OpenAPI schema (`/api/v2/oa3/schema/`, 205 paths), its source code in the `defectdojo-uwsgi` container and the demo data from `pnpm dojo:seed`. Re-check after bumping `DD_VERSION`.

DefectDojo has no vulnerability knowledge base. It stores and manages findings that scanners produce. SubSurf does the detection (scan, fingerprint, CVE match) and DefectDojo holds the findings for triage, SLA tracking and reporting (PDF, section 3: export observations as informational findings or evidence).

## Data model

| DefectDojo | Also called in 3.5 | SubSurf meaning |
|---|---|---|
| Product Type | Organization | A business unit or network owner |
| Product | Asset | A network range or a group of sites (e.g. `Campus DMZ 192.0.2.0/24`) |
| Engagement | | A scanning programme, e.g. `SubSurf continuous discovery` |
| Test | | One scan stream; each scan run is a (re)import into it |
| Finding | | One observation or potential vulnerability on one host:port |
| Location (`/url/`) | Endpoint (legacy) | `protocol://host:port/path` the finding was seen on |
| Finding Group | | Findings grouped by component, created by `group_by` on import |
| Risk Acceptance | | An accepted finding with owner, justification and expiry |

3.5 is in the middle of renaming: `/assets/` and `/organizations/` exist next to `/products/` and `/product_types/`, and the old `/endpoints/` is now **read-only** (locations replace it). Use `/products/` and `/product_types/`; they are what import-scan's `product_name`/`product_type_name` resolve to.

## Pushing findings (SubSurf → DefectDojo)

Use the import API, not `POST /findings/`. It creates the context, deduplicates, closes what disappeared and keeps history.

| Call | When |
|---|---|
| `POST /api/v2/import-scan/` | First scan of an asset. Creates the test (and product, engagement with `auto_create_context=true`) |
| `POST /api/v2/reimport-scan/` | Every later scan, with `test=<id>` from the first import. New findings are added, missing ones closed, unchanged ones left alone |

Both are `multipart/form-data` with a `file` and these fields (`*` = we always send it):

| Field | Value |
|---|---|
| `scan_type`* | `Generic Findings Import` for our JSON (fingerprints, signatures, CVE matches). `Nmap Scan` and `Masscan Scan` parsers exist too, but they only produce one Info finding per open port |
| `product_name`, `product_type_name`, `engagement_name`, `auto_create_context` | First import only |
| `test`* | Reimport only |
| `scan_date`* | The scan's completion date (`YYYY-MM-DD`) |
| `minimum_severity` | `Info`, so observations are kept |
| `close_old_findings`* | `true` on reimport: findings missing from this run are closed as mitigated |
| `do_not_reactivate`* | `true` on reimport: findings someone closed (false positive, risk accepted, fixed) stay closed when the scan reports them again |
| `group_by` | `component_name` creates finding groups per product, e.g. `Findings in: apache:http_server` |
| `apply_tags_to_findings` | `true`, so test-level `tags` reach the findings |
| `deduplication_execution_mode` | `sync` makes the response wait until deduplication is done (`async` is the default) |
| `lead` | User ID of the engagement lead |

The response (`201`, JSON) has `test_id`, `engagement_id`, `product_id`, `product_type_id` and `statistics.before/after/delta` with counts of `created`, `closed`, `reactivated` and `untouched` findings per severity. Store `test_id` next to the SubSurf asset.

### Generic Findings Import format

```json
{
  "name": "SubSurf",
  "type": "SubSurf discovery",
  "version": "0.1.0",
  "findings": [
    {
      "title": "Apache httpd 2.4.49 path traversal (CVE-2021-41773)",
      "severity": "High",
      "description": "192.0.2.10:443/tcp. Server banner reports Apache/2.4.49. Version-based match against NVD; not verified by exploitation.",
      "date": "2026-11-21",
      "unique_id_from_tool": "subsurf:192.0.2.10:443:apache-cve-2021-41773",
      "endpoints": ["https://192.0.2.10:443"],
      "vulnerability_ids": ["CVE-2021-41773"],
      "cwe": 22,
      "cvssv3": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N",
      "cvssv3_score": 7.5,
      "epss_score": 0.944,
      "epss_percentile": 0.999,
      "known_exploited": true,
      "kev_date": "2021-11-03",
      "component_name": "apache:http_server",
      "component_version": "2.4.49",
      "fix_available": true,
      "fix_version": "2.4.51",
      "mitigation": "Upgrade Apache httpd to 2.4.51 or later.",
      "references": "https://nvd.nist.gov/vuln/detail/CVE-2021-41773",
      "tags": ["subsurf", "kev", "internet-facing"],
      "active": true,
      "verified": false,
      "dynamic_finding": true,
      "static_finding": false
    }
  ]
}
```

- Required: `title`, `severity` (`Info`, `Low`, `Medium`, `High`, `Critical`), `description`. Any field outside the parser's allow-list fails the whole import, so the backend must build this object from a fixed shape.
- `endpoints` take URLs (`https://host:port/path`, `ssh://host:22`) and become locations.
- KEV and EPSS have native fields (`known_exploited`, `kev_date`, `ransomware_used`, `epss_score`, `epss_percentile`), and the findings list can filter on them. Fill them from our local KEV/EPSS copy.
- DefectDojo rewrites `title` to Title Case (`WordPress 5.8.1 Detected`). Keep identifiers and paths in `description`, `endpoints` and `unique_id_from_tool`.

### Deduplication: the host must be in the description

`Generic Findings Import` has no `HASHCODE_FIELDS_PER_SCANNER` entry, so DefectDojo falls back to the legacy hash: `title + cwe + line + file_path + description`, plus `service` (`HASH_CODE_FIELDS_ALWAYS`). **`endpoints` and `unique_id_from_tool` are not part of it.** Two findings with the same title and description on different hosts are treated as one.

Two rules follow, and the seed script applies both:

1. Start `description` with `host:port/tcp`, so each host:port gets its own hash.
2. Keep `title` and `description` stable across runs. No timestamps, counters or EPSS values in them (EPSS changes daily; it has its own field).

The alternative is to configure the hash fields, e.g. `DD_HASHCODE_FIELDS_PER_SCANNER='{"Generic Findings Import": ["title", "endpoints", "vulnerability_ids"]}'` on the DefectDojo containers. That is a deployment setting we would have to carry to every instance, so we do not rely on it.

## Pulling data (DefectDojo → SubSurf)

`GET /api/v2/findings/` is the main read. Responses are JSON pages: `{count, next, previous, results, prefetch}`, `limit`/`offset` paging, ordering with `o` (e.g. `o=-numerical_severity`). 121 query filters exist. The useful ones:

| Need | Filter |
|---|---|
| Everything of one SubSurf asset | `test__engagement__product=<id>` or `test=<id>` |
| One finding by our key | `unique_id_from_tool=subsurf:192.0.2.10:443:apache-cve-2021-41773` |
| Open work | `active=true` |
| Exploited in the wild | `known_exploited=true`, `epss_score_min=0.9` |
| By CVE, severity, tag | `vulnerability_id=CVE-…`, `severity=Critical`, `tags=kev` |
| Decisions | `false_p=true`, `out_of_scope=true`, `risk_accepted=true`, `under_review=true`, `verified=true` |
| Someone's queue | `reviewers=<user id>` |
| Changes since the last sync | `last_status_update`, `updated`, `mitigated_after` (date semantics: check before relying on them) |

`prefetch=reviewers,notes,risk_acceptance_set,locations,test` adds the related objects to a top-level `prefetch` map in the same response. Notes come inline on each finding (`notes[]` with `entry`, `author`, `date`). Each finding also carries `display_status` (e.g. `Inactive, Risk Accepted`), `sla_expiration_date` and `sla_days_remaining`, `hash_code`, `finding_groups[]`, `vulnerability_ids[]` and `accepted_risks[]`.

Other reads:

| Endpoint | Returns |
|---|---|
| `GET /risk_acceptance/` | Name, decision, owner, `accepted_findings[]`, `expiration_date`, justification |
| `GET /url/` | Locations: `protocol`, `host`, `port`, `path` |
| `GET /export/products/{id}/` | The whole product as NDJSON (`application/x-ndjson`): a `header` line, then `engagement`, `test`, `finding`, `risk_acceptance` lines and an `end` line. **Superuser only** |
| `GET /export/manifest/` | Product types, products and counts for an export. Superuser only |
| `POST /{products,engagements,tests,findings}/…/generate_report/` | Report data as JSON (not a PDF) |

### Reading a status

DefectDojo sets `is_mitigated=true` and `active=false` on false positives and out-of-scope findings too, so `is_mitigated` alone does not mean fixed. Map the flags in this order:

| SubSurf status | DefectDojo flags |
|---|---|
| False positive | `false_p=true` |
| Out of scope | `out_of_scope=true` |
| Risk accepted | `risk_accepted=true` (see `accepted_risks[]` for owner and expiry) |
| Fixed | `is_mitigated=true` and none of the above (`mitigated` = when, `mitigated_by` = who) |
| In review | `active=true`, `under_review=true` |
| Confirmed | `active=true`, `verified=true` |
| Open | `active=true` |

A finding that is missing from a reimport gets `is_mitigated=true` automatically, which is how a fixed service shows up without anyone touching DefectDojo.

## Sync into SubSurf (implemented)

`POST /v1/defectdojo/sync` (`defectdojo:import`: admin, editor) pulls the current state and `GET /v1/defectdojo/sync` (`defectdojo:read`) shows the last run. The frontend's **Sync from DefectDojo** card on the scans page calls them. Code: `apps/backend/src/modules/defectdojo/`.

- **Reads:** `/products/`, then `/findings/?test__engagement__product=<id>&prefetch=endpoints` per product, and `/users/` for owner names (skipped if the token may not list users). Offset paging, 20 s timeout per request. DefectDojo is never written to.
- **Full pull, every time.** There is no usable "changed since" filter: `updated` matches exact timestamps only, `o=-updated` is rejected, and tag edits do not move `last_status_update`.
- **Matching a finding to a service** (host:port), first hit wins: `unique_id_from_tool` `subsurf:<ip>:<port>:<id>`, then the `<ip>:<port>/tcp` description prefix, then the finding's locations (IPv4 hosts only; `http`/`https` default ports). A finding for an address or port SubSurf has never seen open is counted as unmatched; nothing is created from DefectDojo.

| Imported | Onto | Rule |
|---|---|---|
| Finding tags | `Service.tags` | Merged into the user tags (case-insensitive, `subsurf` skipped, capped at 20 like a user edit). Tags of false positive / out-of-scope findings are skipped |
| Product tags, `product_manager`, `technical_contact` | `Host.tags` | Same merge; owners as `owner:<username>`, `contact:<username>` |
| Triage | `Service.triage`, only while `unreviewed` | Any finding active and verified → `important`; any still open → unchanged; all false positives → `false_positive`; any false positive, risk acceptance or out of scope → `reviewed`; only fixed (`is_mitigated`) → unchanged, because a reimport closes findings the same way. Our own pushed observations (`subsurf:<ip>:<port>:service`) count only once someone verified, accepted or ruled them out |
| Remediation dates | `Service.remediationPlannedOn`, `slaDueOn`, `riskAcceptedUntil` | Earliest `planned_remediation_date` / `sla_expiration_date` of open findings, earliest risk-acceptance `expiration_date`. Owned by DefectDojo: replaced on every sync, cleared when the findings are gone |

Merged tags are ordinary user tags afterwards: removing a tag in DefectDojo does not remove it here. Updates are conditional on the values read in the sync's transaction, so a user edit made meanwhile wins. Every run is a `DefectDojoSync` row with its counts or error; one runs at a time (409 `DEFECTDOJO_SYNC_RUNNING`).

## Push from SubSurf (implemented)

`POST /v1/defectdojo/push` (`defectdojo:export`: admin, editor), body `{ scanId, hostIds?, serviceIds? }`. The scan page has **Push scan to DefectDojo** and, after ticking hosts or services in the table, **Push N selected**. Code: `defectdojo.push.ts` (selection, upload) and `defectdojo.report.ts` (the report).

- **One finding per service**, `Generic Findings Import`, severity `Info` (PDF section 3: observations as informational findings). Title `Exposed <product version> on <port>/tcp`; the description starts with `<ip>:<port>/tcp` and lists hostnames, service name, extra info, CPE, and per HTTP endpoint the status, title, final URL, software headers (`Server`, `X-Powered-By`, …) and TLS certificate. It holds only fingerprint-level data, so an unchanged service keeps its hash and a changed one (upgrade, new certificate) becomes a new finding while the old one is closed. `unique_id_from_tool` is `subsurf:<ip>:<port>:service`, which the pull matches back.
- **Triage and edits:** `false_positive` → `false_p: true, active: false`; `important` → `verified: true`; service tags → finding tags (spaces and commas become `-`), plus `subsurf`; the note goes to `impact` (outside the hash); product and version (with the user's corrections) → `component_name`/`component_version`, grouped with `group_by=component_name`.
- **Where:** product `SubSurf discovery` (type `SubSurf`), engagement `SubSurf continuous discovery`, test `SubSurf scan results`, created by the first push (`auto_create_context`). Later pushes reimport into the test id stored on the last successful `DefectDojoPush`; if that test was deleted, the next push imports anew.
- **Whole scan:** `close_old_findings=true`, so services the scan no longer sees are closed. `gone` services are left out; an `unknown` host (timeout, cancelled at the deadline) sends its services from the base scan, so a timeout never closes anything. Push scans in order: pushing an older scan after a newer one closes the newer findings.
- **Selection:** a host stands for all its services. `close_old_findings=false`: a partial report must not close the rest.
- Checked on the local instance with the demo scans: run 1 → 616 created; run 2 → 43 created, 45 closed, 3 reactivated, 571 untouched; the same push again → all untouched.
- **Limits found:** a location's protocol is `varchar(10)` (`ms-wbt-server` fails the whole import with HTTP 500), so longer service names become `tcp://`. A failed import is not atomic: DefectDojo may keep a half-filled test, which then has to be deleted by hand.

## Triage from SubSurf (writes)

| Action | Call |
|---|---|
| Confirm | `POST /findings/{id}/verify/` (optional `note`) or `PATCH {verified: true}` |
| False positive / out of scope | `PATCH /findings/{id}/` `{false_p: true, active: false}` / `{out_of_scope: true, active: false}` |
| Fixed | `POST /findings/{id}/close/` `{is_mitigated: true, note}`. DefectDojo sets `mitigated_by` to the caller (sending it is refused) and `mitigated` to now (a sent value is ignored) |
| Accept risk | `POST /risk_acceptance/` `{name, owner, accepted_findings, decision: "A", decision_details, expiration_date, reactivate_expired}`. The product needs `enable_full_risk_acceptance` |
| Assign people | `PATCH /findings/{id}/` `{reviewers: [user ids]}`. There is no separate assignee field |
| Plan the fix | `PATCH {planned_remediation_date, planned_remediation_version}` |
| Comment | `POST /findings/{id}/notes/` `{entry}` |
| Tags | `POST /findings/{id}/tags/` / `PATCH /findings/{id}/remove_tags/` |

### People and attribution

- Users: `POST /users/` needs a `password`. Titles and contact data live in `/user_contact_infos/`.
- Owners per asset: `product_manager`, `technical_contact`, `team_manager` (user IDs) on the product. **These are informational only and grant no access.**
- Access: **`authorized_users` on the product (or product type) grants read and write** to its findings. There is no group or membership API in 3.5 (`dojo_groups`, `product_members` are gone from the schema). Checked: a non-superuser listed in `authorized_users` of one product sees only that product's findings and can add notes and edit them.
- Attribution: writes with the admin token are recorded as `admin` (notes' `author`, `mitigated_by`). To record the real person, the backend needs a token per DefectDojo user. `POST /users/{id}/reset_api_token/` only rotates the token (`204`, no body), so the token has to come from `POST /api-token-auth/` with that user's username and password. The backend would therefore set the password when it provisions the user and store the token encrypted.

## Demo data

The findings sit on hosts from `pnpm db:seed:hosts` (10.40.0.0/18), so a sync matches all 27 of them. `pnpm dojo:seed` (`docker/defectdojo/seed-demo.mjs`) fills the instance through the same import path: 5 people, 3 organizations, 3 assets with owners, access and an SLA, two scan runs per asset (the second one closes 2 findings and adds 1) and triage on 10 findings. See [`docker/README.md`](../docker/README.md#demo-data).
