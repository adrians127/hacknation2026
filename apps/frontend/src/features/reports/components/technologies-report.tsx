import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  TechnologyCategorySchema,
  type Technology,
  type TechnologyCategory,
  type TechnologyConfidence,
  type TechnologiesReport,
} from "@subsurf/contracts/reports/reports.schema";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTechnologiesReport } from "@/features/reports/api/get-technologies-report";
import { HostCell, Mono, ReportQuery, ReportSection, ReportShell, ReportTable } from "@/features/reports/components/report-parts";
import { joinList, reportFileName, type CsvTable } from "@/features/reports/lib/export";
import { scanDate, useReportMeta } from "@/features/reports/lib/use-report-meta";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

const ALL = "all";
const CONFIDENCE_ORDER: readonly TechnologyConfidence[] = ["high", "medium", "low"];
const CONFIDENCE_CLASS: Record<TechnologyConfidence, string> = {
  high: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
  medium: "border-sky-500/40 bg-sky-500/10 text-sky-500",
  low: "text-muted-foreground",
};

function technologiesCsv(report: TechnologiesReport): CsvTable {
  return {
    columns: ["technology", "category", "ip", "port", "version", "confidence", "sources"],
    rows: report.technologies.flatMap((technology) =>
      technology.instances.map((instance) => [
        technology.name,
        technology.category,
        instance.ip,
        instance.port,
        instance.version,
        instance.confidence,
        joinList(instance.sources),
      ]),
    ),
  };
}

function Confidence({ technology }: { technology: Technology }) {
  const { t } = useTranslation("reports");
  const counts = CONFIDENCE_ORDER.map(
    (level) => [level, technology.instances.filter((instance) => instance.confidence === level).length] as const,
  ).filter(([, count]) => count > 0);
  return (
    <span className="flex flex-wrap gap-1">
      {counts.map(([level, count]) => (
        <Badge key={level} variant="outline" className={cn(CONFIDENCE_CLASS[level])}>
          {t(`confidence.${level}`)}
          {counts.length > 1 && ` ×${count}`}
        </Badge>
      ))}
    </span>
  );
}

function TechnologiesBody({ report }: { report: TechnologiesReport }) {
  const { t } = useTranslation("reports");
  const meta = useReportMeta();
  const number = (value: number) => formatNumber(value, meta.locale);
  const [category, setCategory] = useState<TechnologyCategory | typeof ALL>(ALL);
  const shown = category === ALL ? report.technologies : report.technologies.filter((entry) => entry.category === category);
  const cms = report.technologies.filter((entry) => entry.category === "cms");

  const versions = (technology: Technology) =>
    technology.versions
      .map((entry) => `${entry.version ?? t("common.unknownVersion")} (${number(entry.services)})`)
      .join(", ");
  const sources = (technology: Technology) =>
    [...new Set(technology.instances.flatMap((instance) => instance.sources))].map((source) => t(`sources.${source}`)).join(", ");

  return (
    <ReportShell
      title={t("kinds.technologies.title")}
      description={t("kinds.technologies.description")}
      meta={[meta.scan(report.scan), meta.generated(report.generatedAt)]}
      fileName={reportFileName("technologies", scanDate(report.scan))}
      json={report}
      csv={() => technologiesCsv(report)}
      controls={
        <div className="grid gap-1.5">
          <Label htmlFor="tech-category">{t("common.category")}</Label>
          <Select
            value={category}
            onValueChange={(value) => setCategory(value === ALL ? ALL : TechnologyCategorySchema.parse(value))}
          >
            <SelectTrigger id="tech-category" className="min-w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>{t("technologies.allCategories")}</SelectItem>
              {TechnologyCategorySchema.options.map((option) => (
                <SelectItem key={option} value={option}>
                  {t(`categories.${option}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      <ReportSection title={t("technologies.cms")}>
        <ReportTable
          rows={cms}
          rowKey={(row) => row.name}
          columns={[
            { header: "CMS", cell: (row) => <span className="font-medium">{row.name}</span> },
            { header: t("technologies.versions"), cell: versions },
            {
              header: t("common.hosts"),
              cell: (row) => (
                <span className="flex flex-wrap gap-x-3 gap-y-1">
                  {row.instances.map((instance) => (
                    <HostCell key={instance.serviceId} ip={instance.ip} />
                  ))}
                </span>
              ),
            },
            { header: t("common.confidence"), cell: (row) => <Confidence technology={row} /> },
          ]}
        />
      </ReportSection>

      <ReportSection title={t("technologies.inventory")} description={t("technologies.confidenceHint")}>
        <ReportTable
          rows={shown}
          rowKey={(row) => row.name}
          limit={40}
          columns={[
            { header: t("common.service"), cell: (row) => <span className="font-medium">{row.name}</span> },
            { header: t("common.category"), cell: (row) => t(`categories.${row.category}`) },
            { header: t("common.hosts"), cell: (row) => number(row.hosts), className: "text-right" },
            { header: t("technologies.versions"), cell: (row) => <span className="text-xs">{versions(row)}</span> },
            { header: t("common.confidence"), cell: (row) => <Confidence technology={row} /> },
            { header: t("common.sources"), cell: (row) => <span className="text-xs text-muted-foreground">{sources(row)}</span> },
          ]}
        />
      </ReportSection>

      <ReportSection title={t("technologies.groups")}>
        <ReportTable
          rows={report.groups}
          rowKey={(row) => `${row.kind}:${row.label}`}
          columns={[
            { header: t("common.category"), cell: (row) => t(`technologies.groupKinds.${row.kind}`) },
            { header: t("common.service"), cell: (row) => <span className="font-medium">{row.label}</span> },
            { header: t("common.services"), cell: (row) => number(row.services), className: "text-right" },
            {
              header: t("common.hosts"),
              cell: (row) => (
                <Mono>
                  {row.members
                    .slice(0, 12)
                    .map((member) => `${member.ip}:${member.port}`)
                    .join(", ")}
                  {row.members.length > 12 && ` (+${row.members.length - 12})`}
                </Mono>
              ),
            },
          ]}
        />
      </ReportSection>
    </ReportShell>
  );
}

export function TechnologiesReportView({ scanId }: { scanId: string }) {
  return <ReportQuery query={useTechnologiesReport(scanId)}>{(report) => <TechnologiesBody report={report} />}</ReportQuery>;
}
