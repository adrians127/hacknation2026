import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import type { ServiceDetail } from "@subsurf/contracts/hosts/hosts.schema";

import { Badge } from "@/components/ui/badge";
import { certificateState, statusCodeClass } from "@/features/hosts/lib/badges";
import { formatDateTime, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

type HttpEndpoint = ServiceDetail["http"][number];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-1.5">
      <h5 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h5>
      {children}
    </section>
  );
}

function KeyValueTable({ rows }: { rows: readonly (readonly [ReactNode, ReactNode])[] }) {
  return (
    <table className="w-full text-xs">
      <tbody>
        {rows.map(([key, value], index) => (
          <tr key={index} className="border-b last:border-0">
            <th scope="row" className="py-1 pr-3 text-left align-top font-mono font-normal whitespace-nowrap text-muted-foreground">
              {key}
            </th>
            <td className="py-1 font-mono break-all">{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Flag({ on, label, warn = false }: { on: boolean; label: string; warn?: boolean }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        on ? "text-foreground" : "text-muted-foreground line-through",
        !on && warn && "border-amber-500/40 text-amber-500",
      )}
    >
      {label}
    </Badge>
  );
}

/** One HTTP endpoint of a port, collapsed to its status line until opened. */
export function HttpEndpointDetails({ endpoint }: { endpoint: HttpEndpoint }) {
  const { t, i18n } = useTranslation("hosts");
  const locale = i18n.resolvedLanguage;
  const cert = endpoint.tls?.cert;
  const certState = cert ? certificateState(cert.notAfter) : null;

  return (
    <details className="group rounded-lg border">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-3 py-2 text-sm">
        <Badge variant="outline" className={statusCodeClass(endpoint.statusCode)}>
          {endpoint.statusCode ?? "—"}
        </Badge>
        <span className="font-mono text-xs break-all">{endpoint.url}</span>
        {endpoint.finalUrl !== endpoint.url && (
          <span className="font-mono text-xs break-all text-muted-foreground">→ {endpoint.finalUrl}</span>
        )}
        <span className="text-muted-foreground">{endpoint.title ?? t("http.noTitle")}</span>
      </summary>

      <div className="grid gap-4 border-t p-3">
        {endpoint.error && (
          <p role="alert" className="text-sm text-destructive">
            {endpoint.error.code}: {endpoint.error.message}
          </p>
        )}

        {endpoint.redirects.length > 0 && (
          <Section title={t("http.redirects")}>
            <ol className="grid gap-1 font-mono text-xs">
              {endpoint.redirects.map((redirect, index) => (
                <li key={index} className="break-all">
                  {redirect.statusCode} {redirect.url} → {redirect.location}
                  {!redirect.followed && (
                    <span className="text-muted-foreground"> ({t("http.notFollowed")})</span>
                  )}
                </li>
              ))}
            </ol>
          </Section>
        )}

        <Section title={t("http.headers")}>
          <KeyValueTable rows={endpoint.headers.map((header) => [header.name, header.value] as const)} />
        </Section>

        {endpoint.cookies.length > 0 && (
          <Section title={t("http.cookies")}>
            <ul className="grid gap-1.5">
              {endpoint.cookies.map((cookie) => (
                <li key={cookie.name} className="flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="font-mono font-medium">{cookie.name}</span>
                  <Flag on={cookie.secure} label="Secure" warn={endpoint.scheme === "https"} />
                  <Flag on={cookie.httpOnly} label="HttpOnly" warn />
                  <Badge variant="outline" className="text-muted-foreground">
                    SameSite={cookie.sameSite ?? "—"}
                  </Badge>
                  {cookie.path && <span className="text-muted-foreground">path={cookie.path}</span>}
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{t("http.cookieValuesHashed")}</p>
          </Section>
        )}

        {endpoint.tls && cert && (
          <Section title={t("http.tls")}>
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline">{endpoint.tls.version}</Badge>
              {cert.selfSigned && (
                <Badge variant="outline" className="border-amber-500/40 text-amber-500">
                  {t("http.selfSigned")}
                </Badge>
              )}
              {certState === "expired" && (
                <Badge variant="outline" className="border-red-500/40 text-red-500">
                  {t("http.expired")}
                </Badge>
              )}
              {certState === "expiring" && (
                <Badge variant="outline" className="border-amber-500/40 text-amber-500">
                  {t("http.expiresSoon")}
                </Badge>
              )}
            </div>
            <KeyValueTable
              rows={[
                [t("http.subject"), cert.subjectCn ?? "—"],
                [t("http.san"), cert.san.join(", ") || "—"],
                [t("http.issuer"), cert.issuer ?? "—"],
                [
                  t("http.validity"),
                  `${formatDateTime(cert.notBefore, locale)} – ${formatDateTime(cert.notAfter, locale)}`,
                ],
                [t("http.key"), `${cert.keyAlgorithm} ${cert.keyBits ?? ""}`.trim()],
                [t("http.cipher"), `${endpoint.tls.cipher}${endpoint.tls.alpn ? ` · ${endpoint.tls.alpn}` : ""}`],
                ["SHA-256", cert.sha256],
              ]}
            />
          </Section>
        )}

        {endpoint.favicon && (
          <Section title={t("http.favicon")}>
            <KeyValueTable
              rows={[
                ["mmh3", String(endpoint.favicon.mmh3)],
                ["URL", endpoint.favicon.url],
              ]}
            />
          </Section>
        )}

        {endpoint.probes.length > 0 && (
          <Section title={t("http.probes")}>
            <KeyValueTable
              rows={endpoint.probes.map(
                (probe) =>
                  [
                    probe.path,
                    <span key={probe.path} className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline" className={statusCodeClass(probe.statusCode)}>
                        {probe.statusCode ?? "—"}
                      </Badge>
                      {probe.location && <span>→ {probe.location}</span>}
                      {probe.title && <span className="text-muted-foreground">{probe.title}</span>}
                    </span>,
                  ] as const,
              )}
            />
          </Section>
        )}

        {endpoint.body && (
          <Section title={t("http.body")}>
            <p className="text-xs text-muted-foreground">
              {endpoint.body.contentType ?? "—"} · {formatNumber(endpoint.body.size, locale)} B
              {endpoint.body.truncated && ` · ${t("http.truncated")}`}
            </p>
            {endpoint.body.content && (
              <pre className="max-h-48 overflow-auto rounded-md bg-muted/50 p-2 text-xs whitespace-pre-wrap">
                {endpoint.body.content}
              </pre>
            )}
          </Section>
        )}
      </div>
    </details>
  );
}
