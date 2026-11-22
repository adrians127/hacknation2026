# Detection signature format

Detection signatures (PDF section 2, item 10) recognise technologies, CMSs, admin panels, staging environments and anything else a security team wants to flag, from what the scanner already fetched. They only detect: no logins, no form data, no payloads. The schema is `SignatureDefinitionSchema` in `packages/contracts/src/signatures/signatures.schema.ts`; the backend side is described in [`apps/backend/README.md`](../apps/backend/README.md#signatures).

## A signature

| Field | Meaning |
|---|---|
| `name` | Unique. |
| `category` | `cms`, `web-server`, `language`, `framework`, `application`, `device`, `service`, `admin-panel`, `staging`, `default-page`, `interesting-header`, `interesting-cookie`, `other`. |
| `product` | Optional technology name: the technologies report lists matches under it. |
| `severity` | `info`, `low`, `medium`, `high`, or `null` (detection only). With a severity a match is also a finding, a DefectDojo finding and a dashboard entry. |
| `confidence` | The least confidence a match gets; matching on two kinds of evidence raises it to `high`. |
| `definition` | `{ "match": "all" \| "any", "conditions": [...] }`, 1 to 10 conditions. |

`all`: every condition holds, the HTTP ones on the same page (endpoint) of the service. `any`: at least one condition holds. `port` conditions always narrow, in both modes.

## Conditions

A matcher is `{ "op": "equals" | "contains" | "prefix" | "regex", "value": "...", "caseSensitive": false }`. Regular expressions use RE2 syntax (no lookarounds or backreferences) and run in linear time. `version` is an optional RE2 pattern whose first group is the version; it never decides the match.

| `target` | Fields | Reads |
|---|---|---|
| `header` | `name`, `value?`, `version?` | A response header (names in lowercase); without `value` its presence is enough. |
| `cookie` | `name` | A cookie name (values are never kept). |
| `title` | `value`, `version?` | The page title. |
| `body` | `value`, `version?` | The page's HTML, its first 256 KiB (e.g. the version in the footer). |
| `favicon` | `mmh3` (list of int32) | The favicon hash in Shodan's convention (`http.favicon.hash`). The scanner fetches `/favicon.ico` of the same host. |
| `probe` | `path`, `status` (codes), `title?`, `location?`, `version?` | How a path answers a plain GET. Paths start with `/` and have no `?`, `#`, `@`, `\` or `..`; the scanner requests the enabled signatures' paths (at most 32) from the next scan on and never follows redirects. |
| `banner` | `value`, `version?` | What a non-HTTP service sent first (SSH, FTP, SMTP). |
| `service` | `field` (`name`, `product`, `version`, `extraInfo`, `cpe`), `value`, `version?` | nmap's service detection. |
| `port` | `ports` | Limits the other conditions to these ports. |

## Export and import

`GET /signatures/export` (`?builtIn=true` adds the built-ins) writes, and `POST /signatures/import` (`?conflict=skip|replace`) reads:

```json
{
  "format": "subsurf.signatures",
  "version": 1,
  "signatures": [
    {
      "name": "WordPress version in the footer",
      "category": "cms",
      "product": "WordPress",
      "severity": null,
      "confidence": "medium",
      "definition": {
        "match": "all",
        "conditions": [
          { "target": "body", "value": { "op": "contains", "value": "powered by wordpress" }, "version": "WordPress (\\d[\\d.]*)" }
        ]
      }
    },
    {
      "name": "Admin path",
      "category": "admin-panel",
      "severity": "medium",
      "confidence": "medium",
      "definition": { "match": "any", "conditions": [{ "target": "probe", "path": "/admin/", "status": [200, 401] }] }
    },
    { "key": "php", "name": "PHP", "category": "language", "confidence": "low", "enabled": false,
      "definition": { "match": "any", "conditions": [{ "target": "cookie", "name": { "op": "equals", "value": "phpsessid" } }] } }
  ]
}
```

The import is all or nothing. An entry with a built-in's `key` only switches that built-in on or off; built-ins cannot be changed, only duplicated.
