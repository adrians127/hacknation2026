import { ArrowRight } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { FieldChange } from "@subsurf/contracts/scans/scan-results.schema";

import { endpointLabel } from "@/features/hosts/lib/endpoint";

const HASHED = new Set<FieldChange["field"]>(["ssh.hostKey", "tls.cert"]);

function Value({ change, value, side }: { change: FieldChange; value: string | null; side: "before" | "after" }) {
  const { t } = useTranslation("hosts");
  if (value === null) return <span className="text-muted-foreground">—</span>;
  const shown =
    change.field === "tls.selfSigned"
      ? t(value === "true" ? "fieldChange.yes" : "fieldChange.no")
      : change.field === "detection" && value === "detected"
        ? t("fieldChange.detected")
        : HASHED.has(change.field)
        ? `${value.slice(0, 12)}…`
        : value;
  return (
    <span
      title={value}
      className={
        side === "before"
          ? "font-mono break-all text-red-400 line-through decoration-red-400/50"
          : "font-mono break-all text-emerald-400"
      }
    >
      {shown}
    </span>
  );
}

/** Field-level differences of one port (or the host), as "label: before → after" lines. */
export function FieldChangeList({
  changes,
  ip,
  port,
}: {
  changes: readonly FieldChange[];
  ip: string;
  /** For the endpoint label; omitted for host-level changes. */
  port?: number;
}) {
  const { t } = useTranslation("hosts");
  if (changes.length === 0) return null;

  return (
    <ul className="grid gap-1 text-xs">
      {changes.map((change, index) => (
        <li key={index} className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
          {change.endpoint && port !== undefined && (
            <span className="font-mono text-muted-foreground">{endpointLabel(change.endpoint, ip, port)}</span>
          )}
          <span className="font-medium">{t(`fieldChange.fields.${change.field}`)}</span>
          {change.key && <code className="rounded bg-muted px-1">{change.key}</code>}
          <Value change={change} value={change.before} side="before" />
          <ArrowRight aria-hidden className="size-3 self-center text-muted-foreground" />
          <Value change={change} value={change.after} side="after" />
        </li>
      ))}
    </ul>
  );
}
