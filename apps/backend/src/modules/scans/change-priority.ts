import type {
  ChangePriority,
  ChangeReason,
  ScanChangeRow,
} from "@subsurf/contracts/scans/scan-changes.schema";

/** Remote access, file sharing and databases that should rarely face a network. */
const RISKY_PORTS: ReadonlySet<number> = new Set([
  21, 23, 445, 1433, 1521, 2375, 3306, 3389, 5432, 5900, 6379, 9200, 11211, 27017,
]);

const ADMIN_PATH = /admin|login|manager|console|phpmyadmin|setup|install/i;

const answered = (status: string | null) => status !== null && /^2\d\d$/.test(status);

/** A change before it is rated. */
export type ChangeFacts = Omit<ScanChangeRow, "priority" | "reason">;
type RowFacts = ChangeFacts;

interface Rated {
  priority: ChangePriority;
  reason: ChangeReason;
}

const high = (reason: ChangeReason): Rated => ({ priority: "high", reason });
const medium = (reason: ChangeReason): Rated => ({ priority: "medium", reason });
const low = (reason: ChangeReason): Rated => ({ priority: "low", reason });

function hostRow(row: RowFacts): Rated {
  if (row.change === "new") return row.lifecycle === "unstable" ? medium("returning-host") : high("new-host");
  if (row.change === "gone") return row.lifecycle === "inactive" ? medium("host-inactive") : low("host-gone");
  return low("no-answer");
}

function serviceRow(row: RowFacts): Rated {
  if (row.change === "gone") return low("service-gone");
  return row.port !== null && RISKY_PORTS.has(row.port) ? high("risky-port") : medium("new-service");
}

/** Cookie flags are listed as `Secure, HttpOnly, SameSite=…`. */
const flags = (value: string | null) => new Set((value ?? "").split(", "));

/** Lost `Secure` or `HttpOnly`. */
function weakened(before: string | null, after: string | null): boolean {
  const now = flags(after);
  return [...flags(before)].some((flag) => (flag === "Secure" || flag === "HttpOnly") && !now.has(flag));
}

function fieldRow(row: RowFacts): Rated {
  switch (row.field) {
    case "ssh.hostKey":
      return high("ssh-key-changed");
    case "tls.selfSigned":
      return row.after === "true" ? high("self-signed") : medium("cert-change");
    case "http.probe":
      return answered(row.after) && !answered(row.before) && ADMIN_PATH.test(row.key ?? "")
        ? high("admin-panel")
        : medium("page-change");
    case "service.name":
    case "service.product":
    case "service.version":
    case "service.extraInfo":
    case "service.cpe":
      return medium("version-change");
    case "http.endpoint":
      return row.after === null ? low("other") : medium("new-endpoint");
    case "http.status":
    case "http.title":
    case "http.redirect":
      return medium("page-change");
    case "tls.cert":
    case "tls.issuer":
    case "tls.expiry":
    case "tls.version":
      return medium("cert-change");
    case "http.securityHeader":
      return row.after === null ? medium("security-header-removed") : low("other");
    case "http.cookieFlags":
      return weakened(row.before, row.after) ? medium("cookie-flags-weakened") : low("other");
    case "http.header":
      return medium("technology-header");
    default:
      return low("other");
  }
}

/** The priority of one change and why (`ChangeReasonSchema`). */
export function rateChange(row: RowFacts): ScanChangeRow {
  const rated = row.field !== null ? fieldRow(row) : row.port === null ? hostRow(row) : serviceRow(row);
  return { ...row, ...rated };
}

export const PRIORITY_ORDER: Record<ChangePriority, number> = { high: 0, medium: 1, low: 2 };
