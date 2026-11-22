/**
 * HTTP headers a scan comparison looks at (the backend's `comparable.ts`). Everything else
 * (Date, ETag, request ids, caching) differs between two requests to the same page.
 */

/** Name software and its version: compared by value. */
export const TECHNOLOGY_HEADERS = [
  "server",
  "x-powered-by",
  "x-generator",
  "x-aspnet-version",
  "x-aspnetmvc-version",
  "x-jenkins",
] as const;

/** Compared by presence only: CSP nonces and similar values change per request. */
export const SECURITY_HEADERS = [
  "strict-transport-security",
  "content-security-policy",
  "x-frame-options",
  "x-content-type-options",
  "access-control-allow-origin",
  "www-authenticate",
] as const;
