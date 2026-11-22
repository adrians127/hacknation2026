import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { MAX_TAGS, TagSchema } from "@subsurf/contracts/common/common.schema";
import { HOST_SELECTORS_MAX, parseHostSelectors } from "@subsurf/contracts/hosts/host-selectors";
import {
  ScanHostTagActionSchema,
  type ScanHostTagAction,
  type TagScanHostsResponse,
} from "@subsurf/contracts/scans/scan-results.schema";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useTagScanHosts } from "@/features/hosts/api/tag-scan-hosts";
import { useErrorMessage } from "@/hooks/use-error-message";

const INVALID_SHOWN = 5;

type Field = "selectors" | "tag";

interface BulkTagDialogProps {
  scanId: string;
  onClose: () => void;
}

/** Adds a tag to, or removes it from, every host of the scan inside the typed IPs and CIDRs. */
export function BulkTagDialog({ scanId, onClose }: BulkTagDialogProps) {
  const { t } = useTranslation("hosts");
  const errorMessage = useErrorMessage();
  const tagHosts = useTagScanHosts();

  const [action, setAction] = useState<ScanHostTagAction>("add");
  const [selectorText, setSelectorText] = useState("");
  const [tag, setTag] = useState("");
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [noMatch, setNoMatch] = useState(false);

  function selectorError(selectors: string[], invalid: string[]): string | undefined {
    if (invalid.length > 0) {
      const shown = invalid.slice(0, INVALID_SHOWN).join(", ");
      return t("bulkTag.selectorsInvalid", {
        list: invalid.length > INVALID_SHOWN ? `${shown}, …` : shown,
      });
    }
    if (selectors.length === 0) return t("bulkTag.selectorsRequired");
    if (selectors.length > HOST_SELECTORS_MAX) {
      return t("bulkTag.selectorsTooMany", { max: HOST_SELECTORS_MAX });
    }
    return undefined;
  }

  function notify(applied: ScanHostTagAction, appliedTag: string, result: TagScanHostsResponse) {
    const details = [
      result.unchanged > 0 && t(`bulkTag.toast.unchanged.${applied}`, { count: result.unchanged }),
      result.limitReached > 0 &&
        t("bulkTag.toast.limitReached", { count: result.limitReached, max: MAX_TAGS }),
    ].filter(Boolean);
    const show = result.limitReached > 0 ? toast.warning : toast.success;
    show(t(`bulkTag.toast.${applied}`, { count: result.changed, tag: appliedTag }), {
      description: details.length > 0 ? details.join(" · ") : undefined,
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { selectors, invalid } = parseHostSelectors(selectorText);
    const trimmedTag = tag.trim();
    const next = {
      selectors: selectorError(selectors, invalid),
      tag: TagSchema.safeParse(trimmedTag).success ? undefined : t("bulkTag.tagInvalid"),
    };
    setErrors(next);
    setNoMatch(false);
    if (next.selectors || next.tag) return;

    const applied = action;
    tagHosts.mutate(
      { params: { path: { id: scanId } }, body: { action: applied, tag: trimmedTag, selectors } },
      {
        onSuccess: (result) => {
          // Keep the dialog open: no match is usually a typo in the ranges.
          if (result.matched === 0) {
            setNoMatch(true);
            return;
          }
          notify(applied, trimmedTag, result);
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t("bulkTag.title")}</DialogTitle>
            <DialogDescription>{t("bulkTag.description")}</DialogDescription>
          </DialogHeader>
          <Tabs
            value={action}
            onValueChange={(value) => {
              const parsed = ScanHostTagActionSchema.safeParse(value);
              if (parsed.success) setAction(parsed.data);
              setNoMatch(false);
            }}
          >
            <TabsList aria-label={t("bulkTag.action.label")} className="w-full">
              {ScanHostTagActionSchema.options.map((option) => (
                <TabsTrigger key={option} value={option}>
                  {t(`bulkTag.action.${option}`)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="grid gap-2">
            <Label htmlFor="bulk-tag-selectors">{t("bulkTag.selectors")}</Label>
            <Textarea
              id="bulk-tag-selectors"
              value={selectorText}
              rows={4}
              placeholder={t("bulkTag.selectorsPlaceholder")}
              className="font-mono"
              onChange={(event) => {
                setSelectorText(event.target.value);
                setErrors((prev) => ({ ...prev, selectors: undefined }));
                setNoMatch(false);
              }}
              aria-invalid={errors.selectors ? true : undefined}
              aria-describedby={errors.selectors ? "bulk-tag-selectors-error" : "bulk-tag-selectors-hint"}
            />
            {errors.selectors ? (
              <p id="bulk-tag-selectors-error" className="text-sm text-destructive">
                {errors.selectors}
              </p>
            ) : (
              <p id="bulk-tag-selectors-hint" className="text-xs text-muted-foreground">
                {t("bulkTag.selectorsHint")}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bulk-tag-tag">{t("bulkTag.tag")}</Label>
            <Input
              id="bulk-tag-tag"
              value={tag}
              maxLength={50}
              placeholder={t("bulkTag.tagPlaceholder")}
              onChange={(event) => {
                setTag(event.target.value);
                setErrors((prev) => ({ ...prev, tag: undefined }));
              }}
              aria-invalid={errors.tag ? true : undefined}
              aria-describedby={errors.tag ? "bulk-tag-tag-error" : undefined}
            />
            {errors.tag && (
              <p id="bulk-tag-tag-error" className="text-sm text-destructive">
                {errors.tag}
              </p>
            )}
          </div>
          {noMatch && (
            <p role="alert" className="text-sm text-destructive">
              {t("bulkTag.noMatch")}
            </p>
          )}
          {tagHosts.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(tagHosts.error)}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("form.cancel")}
            </Button>
            <Button type="submit" disabled={tagHosts.isPending}>
              {tagHosts.isPending ? t("form.submitting") : t(`bulkTag.submit.${action}`)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
