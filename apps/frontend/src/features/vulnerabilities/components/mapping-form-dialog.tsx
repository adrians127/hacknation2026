import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { CreatePackageMappingBodySchema } from "@subsurf/contracts/vulnerabilities/vulnerabilities.schema";

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCreateMapping } from "@/features/vulnerabilities/api/create-mapping";
import { useErrorMessage } from "@/hooks/use-error-message";

const FIELDS = ["cpeVendor", "cpeProduct", "packageName"] as const;
type Field = (typeof FIELDS)[number];

export function MappingFormDialog({
  ecosystems,
  onClose,
}: {
  ecosystems: readonly string[];
  onClose: () => void;
}) {
  const { t } = useTranslation("vulnerabilities");
  const { t: tc } = useTranslation();
  const errorMessage = useErrorMessage();
  const create = useCreateMapping();
  const [values, setValues] = useState({
    cpeVendor: "",
    cpeProduct: "",
    ecosystem: ecosystems[0] ?? "",
    packageName: "",
  });
  const [invalid, setInvalid] = useState<ReadonlySet<Field>>(new Set());

  const set = (field: keyof typeof values, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
    setInvalid((previous) => new Set([...previous].filter((item) => item !== field)));
  };

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = {
      cpeVendor: values.cpeVendor.trim(),
      cpeProduct: values.cpeProduct.trim(),
      ecosystem: values.ecosystem,
      packageName: values.packageName.trim(),
    };
    const parsed = CreatePackageMappingBodySchema.safeParse(body);
    if (!parsed.success) {
      const paths = new Set(parsed.error.issues.map((issue) => issue.path[0]));
      setInvalid(new Set(FIELDS.filter((field) => paths.has(field))));
      return;
    }
    create.mutate(
      { body },
      {
        onSuccess: () => {
          toast.success(t("toast.mappingAdded"));
          onClose();
        },
      },
    );
  }

  const text = (field: Field, label: string, hint: string, error: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`mapping-${field}`}>{label}</Label>
      <Input
        id={`mapping-${field}`}
        value={values[field]}
        placeholder={hint}
        onChange={(event) => set(field, event.target.value)}
        aria-invalid={invalid.has(field) ? true : undefined}
      />
      {invalid.has(field) && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{t("mappings.form.title")}</DialogTitle>
            <DialogDescription>{t("mappings.form.description")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {text("cpeVendor", t("mappings.form.vendor"), t("mappings.form.vendorHint"), t("mappings.form.invalidName"))}
            {text("cpeProduct", t("mappings.form.product"), t("mappings.form.productHint"), t("mappings.form.invalidName"))}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mapping-ecosystem">{t("mappings.ecosystem")}</Label>
            <Select value={values.ecosystem} onValueChange={(value) => set("ecosystem", value)}>
              <SelectTrigger id="mapping-ecosystem">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ecosystems.map((ecosystem) => (
                  <SelectItem key={ecosystem} value={ecosystem}>
                    {ecosystem}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {text("packageName", t("mappings.package"), t("mappings.form.packageHint"), t("mappings.form.invalidPackage"))}
          {create.isError && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(create.error)}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={create.isPending}>
              {tc("actions.cancel")}
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {t("mappings.add")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
