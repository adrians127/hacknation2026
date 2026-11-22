import { Search, Tag, X } from "lucide-react";
import { useDeferredValue, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import type { TargetSelector } from "@subsurf/contracts/pipelines/pipelines.schema";
import type { Target } from "@subsurf/contracts/targets/targets.schema";

import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  inventoryTags,
  selectionCoverage,
  type TargetSelection,
} from "@/features/pipelines/lib/target-selection";
import { useTargets } from "@/features/targets/api/get-targets";
import { TargetKindBadge } from "@/features/targets/components/target-kind-badge";
import { useErrorMessage } from "@/hooks/use-error-message";
import { useCan } from "@/lib/auth/use-can";
import { formatNumber } from "@/lib/format";

/** Rendering every row of a 100k-target inventory would freeze the page; search narrows it. */
const MAX_LISTED_TARGETS = 200;

const toggle = (values: readonly string[], value: string, on: boolean) =>
  on ? [...values, value] : values.filter((item) => item !== value);

const matches = (target: Target, query: string) =>
  [target.value, target.note, ...target.tags].some((text) => text.toLowerCase().includes(query));

/**
 * Picks a pipeline's targets from the inventory: whole tags and single targets. Selected tags and
 * targets that are gone from the inventory stay listed (and flagged) until removed.
 */
export function TargetPicker({
  selector,
  disabled,
  onChange,
}: {
  selector: TargetSelector;
  disabled: boolean;
  onChange: (selection: TargetSelection) => void;
}) {
  const { t, i18n } = useTranslation("pipelines");
  const locale = i18n.resolvedLanguage;
  const errorMessage = useErrorMessage();
  const idPrefix = useId();
  const canRead = useCan("targets:read");
  const targets = useTargets({ enabled: canRead });
  const [search, setSearch] = useState("");
  const query = useDeferredValue(search.trim().toLowerCase());

  const { tags, targetIds, ranges } = selector;
  const inventory = targets.data?.items;
  const byId = useMemo(() => new Map(inventory?.map((target) => [target.id, target])), [inventory]);
  const tagCounts = useMemo(() => inventoryTags(inventory ?? []), [inventory]);
  const coverage = useMemo(
    () => (inventory ? selectionCoverage(inventory, { tags, targetIds }, ranges) : null),
    [inventory, tags, targetIds, ranges],
  );
  const matching = useMemo(
    () => (inventory && query ? inventory.filter((target) => matches(target, query)) : (inventory ?? [])),
    [inventory, query],
  );
  const shownTags = query ? tagCounts.filter(({ tag }) => tag.toLowerCase().includes(query)) : tagCounts;
  const shownTargets = matching.slice(0, MAX_LISTED_TARGETS);

  const setTags = (next: string[]) => onChange({ tags: next, targetIds });
  const setTargetIds = (next: string[]) => onChange({ tags, targetIds: next });
  const missingTags = new Set(coverage?.missingTags);
  const missingIds = new Set(coverage?.missingIds);
  const searchId = `${idPrefix}-search`;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-1.5" aria-live="polite">
        {tags.length === 0 && targetIds.length === 0 && (
          <p className="text-sm text-muted-foreground">{t("editor.targets.picker.nothingSelected")}</p>
        )}
        {tags.map((tag) => (
          <Badge key={`tag:${tag}`} variant={missingTags.has(tag) ? "destructive" : "secondary"}>
            <Tag aria-hidden />
            {tag}
            {!disabled && (
              <button
                type="button"
                className="-mr-1 rounded-full hover:text-foreground"
                aria-label={t("editor.targets.picker.removeTag", { tag })}
                onClick={() => setTags(tags.filter((item) => item !== tag))}
              >
                <X className="size-3" />
              </button>
            )}
          </Badge>
        ))}
        {targetIds.map((id) => {
          const target = byId.get(id);
          const label = target?.value ?? (inventory ? t("editor.targets.picker.removedTarget") : id.slice(0, 8));
          return (
            <Badge
              key={`target:${id}`}
              variant={missingIds.has(id) ? "destructive" : "outline"}
              className="font-mono"
            >
              {label}
              {!disabled && (
                <button
                  type="button"
                  className="-mr-1 rounded-full hover:text-foreground"
                  aria-label={t("editor.targets.picker.removeTarget", { value: label })}
                  onClick={() => setTargetIds(targetIds.filter((item) => item !== id))}
                >
                  <X className="size-3" />
                </button>
              )}
            </Badge>
          );
        })}
      </div>

      {!canRead ? (
        <p className="text-sm text-muted-foreground">{t("editor.targets.picker.noPermission")}</p>
      ) : targets.isPending ? (
        <Skeleton className="h-40 w-full" />
      ) : targets.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(targets.error)}
        </p>
      ) : inventory?.length === 0 ? (
        <p className="text-sm text-amber-400">
          {t("editor.targets.picker.emptyInventory")}{" "}
          <Link to="/app/targets/new" className="underline underline-offset-4">
            {t("editor.targets.picker.import")}
          </Link>
        </p>
      ) : (
        <>
          <div className="relative">
            <Label htmlFor={searchId} className="sr-only">
              {t("editor.targets.picker.search")}
            </Label>
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              id={searchId}
              type="search"
              className="pl-8"
              value={search}
              placeholder={t("editor.targets.picker.search")}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>

          <div className="max-h-72 overflow-y-auto rounded-md border">
            {shownTags.length > 0 && (
              <section aria-labelledby={`${idPrefix}-tags`}>
                <h3
                  id={`${idPrefix}-tags`}
                  className="sticky top-0 z-10 border-b bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase"
                >
                  {t("editor.targets.picker.tags")}
                </h3>
                <ul>
                  {shownTags.map(({ tag, count }, index) => {
                    const id = `${idPrefix}-tag-${index}`;
                    return (
                      <li key={tag} className="flex items-center gap-3 px-3 py-1.5 hover:bg-muted/50">
                        <Checkbox
                          id={id}
                          checked={tags.includes(tag)}
                          disabled={disabled}
                          onCheckedChange={(checked) => setTags(toggle(tags, tag, checked === true))}
                        />
                        <Label htmlFor={id} className="min-w-0 flex-1 cursor-pointer gap-1.5 font-normal">
                          <Tag aria-hidden className="size-3.5 text-muted-foreground" />
                          <span className="truncate">{tag}</span>
                        </Label>
                        <span className="text-xs text-muted-foreground">
                          {t("editor.targets.picker.tagCount", { count })}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {shownTargets.length > 0 && (
              <section aria-labelledby={`${idPrefix}-targets`}>
                <h3
                  id={`${idPrefix}-targets`}
                  className="sticky top-0 z-10 border-b bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground uppercase"
                >
                  {t("editor.targets.picker.targets")}
                </h3>
                <ul>
                  {shownTargets.map((target) => {
                    const id = `${idPrefix}-target-${target.id}`;
                    const picked = targetIds.includes(target.id);
                    const viaTags = target.tags.filter((tag) => tags.includes(tag));
                    return (
                      <li key={target.id} className="flex items-center gap-3 px-3 py-1.5 hover:bg-muted/50">
                        <Checkbox
                          id={id}
                          checked={picked ? true : viaTags.length > 0 ? "indeterminate" : false}
                          disabled={disabled}
                          onCheckedChange={(checked) =>
                            setTargetIds(toggle(targetIds, target.id, checked === true))
                          }
                          aria-describedby={viaTags.length > 0 ? `${id}-via` : undefined}
                        />
                        <Label htmlFor={id} className="min-w-0 flex-1 cursor-pointer font-mono text-xs font-normal">
                          <span className="truncate">{target.value}</span>
                        </Label>
                        {viaTags.length > 0 && !picked ? (
                          <span id={`${id}-via`} className="hidden text-xs text-muted-foreground sm:inline">
                            {t("editor.targets.picker.viaTags", { tags: viaTags.join(", ") })}
                          </span>
                        ) : (
                          target.tags.length > 0 && (
                            <span className="hidden max-w-48 truncate text-xs text-muted-foreground sm:inline">
                              {target.tags.join(", ")}
                            </span>
                          )
                        )}
                        <TargetKindBadge kind={target.kind} />
                      </li>
                    );
                  })}
                </ul>
                {matching.length > shownTargets.length && (
                  <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
                    {t("editor.targets.picker.truncated", {
                      shown: formatNumber(shownTargets.length, locale),
                      total: formatNumber(matching.length, locale),
                    })}
                  </p>
                )}
              </section>
            )}

            {shownTags.length === 0 && shownTargets.length === 0 && (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                {t("editor.targets.picker.noMatches", { query: search.trim() })}
              </p>
            )}
          </div>

          {coverage && inventory && (
            <div className="grid gap-1 text-sm">
              <p className="text-muted-foreground">
                {[
                  t("editor.targets.picker.coverage.targets", {
                    count: coverage.targets.length,
                    total: formatNumber(inventory.length, locale),
                  }),
                  t("editor.targets.picker.coverage.addresses", {
                    count: coverage.addresses,
                    value: formatNumber(coverage.addresses, locale),
                  }),
                  ...(coverage.domains > 0
                    ? [t("editor.targets.picker.coverage.domains", { count: coverage.domains })]
                    : []),
                ].join(" · ")}
              </p>
              {coverage.missingTags.length > 0 && (
                <p className="text-amber-400">
                  {t("editor.targets.picker.missingTags", { tags: coverage.missingTags.join(", ") })}
                </p>
              )}
              {coverage.missingIds.length > 0 && (
                <p className="text-amber-400">
                  {t("editor.targets.picker.missingTargets", { count: coverage.missingIds.length })}
                </p>
              )}
              {coverage.targets.length === 0 ? (
                <p className="text-amber-400">{t("editor.targets.picker.nothingMatches")}</p>
              ) : (
                coverage.addresses === 0 &&
                coverage.domains === 0 && <p className="text-amber-400">{t("editor.targets.picker.outsideRanges")}</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
