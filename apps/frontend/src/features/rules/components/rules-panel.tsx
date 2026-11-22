import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import type { Rule } from "@subsurf/contracts/rules/rules.schema";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { DataTable } from "@/components/data-table";
import { GuardedButton } from "@/components/guarded-button";
import { IconAction } from "@/components/icon-action";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useDeleteRule } from "@/features/rules/api/delete-rule";
import { useRules } from "@/features/rules/api/get-rules";
import { useUpdateRule } from "@/features/rules/api/update-rule";
import { RuleFormDialog } from "@/features/rules/components/rule-form-dialog";
import { RuleSummary } from "@/features/rules/components/rule-summary";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useCan } from "@/lib/auth/use-can";
import { createDataTableColumns } from "@/lib/data-table";
import { formatDay } from "@/lib/format";

const column = createDataTableColumns<Rule>();

/** Every rule in order, with what it holds now; the first matching rule sets a value. */
export function RulesPanel() {
  const { t, i18n } = useTranslation("rules");
  const errorMessage = useErrorMessage();
  const rules = useRules();
  const { mutate: updateRule, isPending: updating } = useUpdateRule();
  const remove = useDeleteRule();
  const canUpdate = useCan("rules:update");
  const [editing, setEditing] = useState<Rule | "new" | null>(null);
  const [deleting, setDeleting] = useState<Rule | null>(null);
  const count = rules.data?.items.length ?? 0;

  const columns = useMemo(() => {
    const change = (rule: Rule, body: { enabled?: boolean; position?: number }) =>
      updateRule(
        { params: { path: { id: rule.id } }, body },
        { onError: (error) => toast.error(errorMessage(error)) },
      );
    const affected = (rule: Rule) =>
      [
        rule.affected.vulnerabilities > 0 && t("affected.vulnerabilities", { count: rule.affected.vulnerabilities }),
        rule.affected.services > 0 && t("affected.services", { count: rule.affected.services }),
        rule.affected.hosts > 0 && t("affected.hosts", { count: rule.affected.hosts }),
        rule.affected.tags > 0 && t("affected.tags", { count: rule.affected.tags }),
      ].filter((part) => part !== false);

    return column.columns([
      column.accessor("position", {
        header: t("columns.order"),
        enableSorting: false,
        cell: ({ row: { original: rule } }) => (
          <div className="flex items-center gap-0.5">
            <span className="w-5 text-right font-mono text-muted-foreground">{rule.position + 1}</span>
            <IconAction
              label={t("actions.moveUp", { name: rule.name })}
              icon={<ArrowUp />}
              permissions={["rules:update"]}
              disabledReason={rule.position === 0 ? t("actions.first") : undefined}
              onClick={() => change(rule, { position: rule.position - 1 })}
            />
            <IconAction
              label={t("actions.moveDown", { name: rule.name })}
              icon={<ArrowDown />}
              permissions={["rules:update"]}
              disabledReason={rule.position === count - 1 ? t("actions.last") : undefined}
              onClick={() => change(rule, { position: rule.position + 1 })}
            />
          </div>
        ),
      }),
      column.accessor("name", {
        header: t("columns.name"),
        enableSorting: false,
        cell: ({ row: { original: rule } }) => (
          <div className="grid max-w-64 gap-1">
            <span className="font-medium">{rule.name}</span>
            <Badge variant="outline" className="w-fit">
              {t(`kinds.${rule.definition.kind}.name`)}
            </Badge>
            {rule.note && <span className="line-clamp-2 text-xs text-muted-foreground">{rule.note}</span>}
          </div>
        ),
      }),
      column.display({
        id: "definition",
        header: t("columns.definition"),
        cell: ({ row: { original: rule } }) => <RuleSummary definition={rule.definition} />,
      }),
      column.display({
        id: "affected",
        header: t("columns.affected"),
        cell: ({ row: { original: rule } }) => {
          const parts = affected(rule);
          return (
            <span className="text-sm text-muted-foreground">
              {rule.definition.kind === "change_priority"
                ? t("affected.readTime")
                : parts.length > 0
                  ? parts.join(", ")
                  : t("affected.none")}
            </span>
          );
        },
      }),
      column.accessor("enabled", {
        header: t("columns.enabled"),
        enableSorting: false,
        cell: ({ row: { original: rule } }) => (
          <div className="grid gap-1">
            <Checkbox
              checked={rule.enabled}
              disabled={!canUpdate || updating}
              aria-label={t("actions.toggle", { name: rule.name })}
              onCheckedChange={(checked) => change(rule, { enabled: checked === true })}
            />
            {rule.expiresAt && (
              <span className={rule.expired ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                {t(rule.expired ? "expired" : "expires", { date: formatDay(rule.expiresAt, i18n.language) })}
              </span>
            )}
          </div>
        ),
      }),
      column.display({
        id: "actions",
        header: () => <span className="sr-only">{t("columns.actions")}</span>,
        cell: ({ row: { original: rule } }) => (
          <div className="flex justify-end gap-1">
            <IconAction
              label={t("actions.edit", { name: rule.name })}
              icon={<Pencil />}
              permissions={["rules:update"]}
              onClick={() => setEditing(rule)}
            />
            <IconAction
              label={t("actions.delete", { name: rule.name })}
              icon={<Trash2 />}
              permissions={["rules:delete"]}
              destructive
              onClick={() => setDeleting(rule)}
            />
          </div>
        ),
      }),
    ]);
  }, [t, i18n.language, updateRule, updating, errorMessage, canUpdate, count]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-sm text-muted-foreground">{t("intro")}</p>
        <GuardedButton permissions={["rules:create"]} onClick={() => setEditing("new")}>
          <Plus />
          {t("actions.add")}
        </GuardedButton>
      </div>
      {rules.isPending ? (
        <Skeleton className="h-64 w-full" />
      ) : rules.isError ? (
        <p role="alert" className="text-destructive">
          {errorMessage(rules.error)}
        </p>
      ) : (
        <Card>
          <CardContent>
            <DataTable columns={columns} data={rules.data.items} emptyLabel={t("empty")} />
          </CardContent>
        </Card>
      )}

      {editing && (
        <RuleFormDialog rule={editing === "new" ? null : editing} onClose={() => setEditing(null)} />
      )}
      {deleting && (
        <ConfirmDialog
          title={t("deleteTitle")}
          description={t("deleteDescription", { name: deleting.name })}
          confirmLabel={t("deleteTitle")}
          destructive
          pending={remove.isPending}
          error={remove.isError ? errorMessage(remove.error) : null}
          onCancel={() => {
            remove.reset();
            setDeleting(null);
          }}
          onConfirm={() =>
            remove.mutate(
              { params: { path: { id: deleting.id } } },
              {
                onSuccess: () => {
                  toast.success(t("toast.deleted"));
                  setDeleting(null);
                },
              },
            )
          }
        />
      )}
    </div>
  );
}
