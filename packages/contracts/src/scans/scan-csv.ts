import type { ObservedHost, OpenPort } from "../workers/worker-result.schema";
import type { HostEdit, ScanEdits, ServiceEdit } from "./scan-export.schema";

/**
 * The scan export's CSV: one row per HTTP endpoint; a port without HTTP, an `up` host without
 * open ports and an address that is not `up` take one row each. Host columns repeat on every
 * row of the host, port columns on every row of the port. Lossy next to the JSON export:
 * headers, cookies, certificates, banners and probes are not in it.
 */
export const SCAN_CSV_COLUMNS = [
  "ip",
  "status",
  "hostnames",
  "observed_at",
  "latency_ms",
  "host_triage",
  "host_tags",
  "host_note",
  "protocol",
  "port",
  "service",
  "product",
  "version",
  "extra_info",
  "cpe",
  "ssh_host_key",
  "service_triage",
  "service_tags",
  "service_note",
  "name_override",
  "product_override",
  "version_override",
  "scheme",
  "vhost",
  "url",
  "final_url",
  "status_code",
  "title",
] as const;

export type ScanCsvColumn = (typeof SCAN_CSV_COLUMNS)[number];
export type ScanCsvCell = string | number | null;
export type ScanCsvRow = Record<ScanCsvColumn, ScanCsvCell>;

/** Hostnames and CPEs hold no spaces, tags no commas (a tag with one splits on import). */
export const SCAN_CSV_LIST_SEPARATOR = { hostnames: " ", cpe: " ", tags: "," } as const;

const EMPTY_ROW: ScanCsvRow = {
  ip: null,
  status: null,
  hostnames: null,
  observed_at: null,
  latency_ms: null,
  host_triage: null,
  host_tags: null,
  host_note: null,
  protocol: null,
  port: null,
  service: null,
  product: null,
  version: null,
  extra_info: null,
  cpe: null,
  ssh_host_key: null,
  service_triage: null,
  service_tags: null,
  service_note: null,
  name_override: null,
  product_override: null,
  version_override: null,
  scheme: null,
  vhost: null,
  url: null,
  final_url: null,
  status_code: null,
  title: null,
};

const tagsCell = (tags: readonly string[]) =>
  tags.length > 0 ? tags.join(SCAN_CSV_LIST_SEPARATOR.tags) : null;

function hostCells(host: ObservedHost, edit: HostEdit | undefined): Partial<ScanCsvRow> {
  const names = [...new Set(host.hostnames.map((hostname) => hostname.name))];
  return {
    ip: host.ip,
    status: host.status,
    hostnames: names.length > 0 ? names.join(SCAN_CSV_LIST_SEPARATOR.hostnames) : null,
    observed_at: host.observedAt,
    latency_ms: host.latencyMs,
    host_triage: edit?.triage ?? "unreviewed",
    host_tags: tagsCell(edit?.tags ?? []),
    host_note: edit?.note || null,
  };
}

function portCells(port: OpenPort, edit: ServiceEdit | undefined): Partial<ScanCsvRow> {
  return {
    protocol: port.protocol,
    port: port.port,
    service: port.service?.name ?? null,
    product: port.service?.product ?? null,
    version: port.service?.version ?? null,
    extra_info: port.service?.extraInfo ?? null,
    cpe: port.service?.cpe.length ? port.service.cpe.join(SCAN_CSV_LIST_SEPARATOR.cpe) : null,
    ssh_host_key: port.identity.sshHostKeySha256,
    service_triage: edit?.triage ?? "unreviewed",
    service_tags: tagsCell(edit?.tags ?? []),
    service_note: edit?.note || null,
    name_override: edit?.nameOverride ?? null,
    product_override: edit?.productOverride ?? null,
    version_override: edit?.versionOverride ?? null,
  };
}

/** The rows of one host; `edits` are the ones of this host and its services. */
export function scanCsvRows(host: ObservedHost, edits: ScanEdits): ScanCsvRow[] {
  const hostRow = { ...EMPTY_ROW, ...hostCells(host, edits.hosts.find((edit) => edit.ip === host.ip)) };
  if (host.ports.length === 0) return [hostRow];
  return host.ports.flatMap((port) => {
    const edit = edits.services.find(
      (candidate) =>
        candidate.ip === host.ip && candidate.protocol === port.protocol && candidate.port === port.port,
    );
    const portRow = { ...hostRow, ...portCells(port, edit) };
    if (port.http.length === 0) return [portRow];
    return port.http.map((endpoint) => ({
      ...portRow,
      scheme: endpoint.scheme,
      vhost: endpoint.vhost,
      url: endpoint.url,
      final_url: endpoint.finalUrl,
      status_code: endpoint.statusCode,
      title: endpoint.title,
    }));
  });
}

/** Every address of `block` (a CIDR or an address) without rows of its own is `down`. */
export function scanCsvDownRow(block: string): ScanCsvRow {
  return { ...EMPTY_ROW, ip: block, status: "down" };
}

/**
 * Header names read as each column, lowercase with `_` for spaces and dashes. Another tool's
 * CSV is supported by adding its names here.
 */
export const SCAN_CSV_ALIASES: Record<ScanCsvColumn, readonly string[]> = {
  ip: ["ip", "address", "ip_address", "host", "host_ip"],
  status: ["status", "host_status", "state"],
  hostnames: ["hostnames", "hostname", "dns", "fqdn", "domain"],
  observed_at: ["observed_at", "timestamp", "seen_at", "last_seen"],
  latency_ms: ["latency_ms", "latency", "rtt"],
  host_triage: ["host_triage"],
  host_tags: ["host_tags", "tags"],
  host_note: ["host_note", "note", "notes", "comment"],
  protocol: ["protocol", "proto"],
  port: ["port", "port_number"],
  service: ["service", "service_name"],
  product: ["product", "service_product"],
  version: ["version", "service_version"],
  extra_info: ["extra_info", "extrainfo", "info"],
  cpe: ["cpe"],
  ssh_host_key: ["ssh_host_key"],
  service_triage: ["service_triage", "triage"],
  service_tags: ["service_tags"],
  service_note: ["service_note"],
  name_override: ["name_override"],
  product_override: ["product_override"],
  version_override: ["version_override"],
  scheme: ["scheme"],
  vhost: ["vhost", "virtual_host"],
  url: ["url"],
  final_url: ["final_url"],
  status_code: ["status_code", "http_status", "http_code"],
  title: ["title", "http_title", "page_title"],
};
