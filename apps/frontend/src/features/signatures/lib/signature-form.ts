import type {
  SignatureCategory,
  SignatureConfidence,
  SignatureSeverity,
  SignatureTarget,
} from "@subsurf/contracts/signatures/detection.schema";
import type {
  CreateSignatureBody,
  Signature,
  SignatureCondition,
  SignatureDefinition,
  SignatureMatchMode,
  SignatureMatchOp,
  SignatureMatcher,
  SignatureServiceField,
} from "@subsurf/contracts/signatures/signatures.schema";

export interface MatcherForm {
  op: SignatureMatchOp;
  value: string;
  caseSensitive: boolean;
}

/** One condition as the form edits it: every target's fields, lists as text. */
export interface ConditionForm {
  /** React key only. */
  id: string;
  target: SignatureTarget;
  /** Header or cookie name. */
  name: MatcherForm;
  /** Header value (empty = any), title, page, banner, service field. */
  value: MatcherForm;
  /** Probe title (empty = any). */
  title: MatcherForm;
  version: string;
  field: SignatureServiceField;
  /** Favicon hashes, comma or space separated. */
  mmh3: string;
  path: string;
  /** Probe status codes, comma or space separated. */
  status: string;
  ports: string;
}

export interface SignatureFormState {
  name: string;
  description: string;
  category: SignatureCategory;
  product: string;
  /** `""`: only identifies something, no finding. */
  severity: SignatureSeverity | "";
  confidence: SignatureConfidence;
  match: SignatureMatchMode;
  conditions: ConditionForm[];
}

/** Targets whose condition reads a text the version pattern can read too. */
export const VERSION_TARGETS = new Set<SignatureTarget>(["header", "title", "body", "probe", "banner", "service"]);

const matcher = (op: SignatureMatchOp = "contains", value = ""): MatcherForm => ({ op, value, caseSensitive: false });

let nextId = 0;

export function emptyCondition(target: SignatureTarget = "title"): ConditionForm {
  nextId += 1;
  return {
    id: `condition-${nextId}`,
    target,
    name: matcher("equals"),
    value: matcher(),
    title: matcher(),
    version: "",
    field: "product",
    mmh3: "",
    path: "/",
    status: "200",
    ports: "",
  };
}

export const EMPTY_FORM: SignatureFormState = {
  name: "",
  description: "",
  category: "application",
  product: "",
  severity: "",
  confidence: "medium",
  match: "all",
  conditions: [emptyCondition()],
};

const fromMatcher = (value: SignatureMatcher): MatcherForm => ({
  op: value.op,
  value: value.value,
  caseSensitive: value.caseSensitive ?? false,
});

function fromCondition(condition: SignatureCondition): ConditionForm {
  const form = emptyCondition(condition.target);
  switch (condition.target) {
    case "header":
      return {
        ...form,
        name: fromMatcher(condition.name),
        value: condition.value ? fromMatcher(condition.value) : matcher(),
        version: condition.version ?? "",
      };
    case "cookie":
      return { ...form, name: fromMatcher(condition.name) };
    case "title":
    case "body":
    case "banner":
      return { ...form, value: fromMatcher(condition.value), version: condition.version ?? "" };
    case "service":
      return {
        ...form,
        field: condition.field,
        value: fromMatcher(condition.value),
        version: condition.version ?? "",
      };
    case "favicon":
      return { ...form, mmh3: condition.mmh3.join(", ") };
    case "probe":
      return {
        ...form,
        path: condition.path,
        status: condition.status.join(", "),
        title: condition.title ? fromMatcher(condition.title) : matcher(),
        version: condition.version ?? "",
      };
    default:
      return { ...form, ports: condition.ports.join(", ") };
  }
}

export function toFormState(signature: Signature, copy = false): SignatureFormState {
  return {
    name: copy ? "" : signature.name,
    description: signature.description,
    category: signature.category,
    product: signature.product ?? "",
    severity: signature.severity ?? "",
    confidence: signature.confidence,
    match: signature.definition.match,
    conditions: signature.definition.conditions.map(fromCondition),
  };
}

/** Whole numbers from a list typed as text; anything else stays as `NaN`, so the schema refuses it. */
function numbers(text: string): number[] {
  return text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((part) => (/^-?\d+$/.test(part) ? Number(part) : Number.NaN));
}

function toMatcher(form: MatcherForm): SignatureMatcher {
  return { op: form.op, value: form.value, ...(form.caseSensitive && { caseSensitive: true }) };
}

const version = (form: ConditionForm) => (form.version.trim() === "" ? {} : { version: form.version.trim() });

/** The condition as the API takes it; not validated (the schema does that). */
export function toCondition(form: ConditionForm): unknown {
  switch (form.target) {
    case "header":
      return {
        target: "header",
        name: toMatcher({ ...form.name, value: form.name.value.toLowerCase() }),
        ...(form.value.value !== "" && { value: toMatcher(form.value) }),
        ...version(form),
      };
    case "cookie":
      return { target: "cookie", name: toMatcher(form.name) };
    case "title":
    case "body":
    case "banner":
      return { target: form.target, value: toMatcher(form.value), ...version(form) };
    case "service":
      return { target: "service", field: form.field, value: toMatcher(form.value), ...version(form) };
    case "favicon":
      return { target: "favicon", mmh3: numbers(form.mmh3) };
    case "probe":
      return {
        target: "probe",
        path: form.path.trim(),
        status: numbers(form.status),
        ...(form.title.value !== "" && { title: toMatcher(form.title) }),
        ...version(form),
      };
    default:
      return { target: "port", ports: numbers(form.ports) };
  }
}

export function toDefinition(form: SignatureFormState): unknown {
  return { match: form.match, conditions: form.conditions.map(toCondition) };
}

/** The fields the create and update bodies share, from a form whose definition was parsed. */
export function toBody(
  form: SignatureFormState,
  definition: SignatureDefinition,
): CreateSignatureBody {
  return {
    name: form.name.trim(),
    description: form.description.trim(),
    category: form.category,
    product: form.product.trim() === "" ? null : form.product.trim(),
    severity: form.severity === "" ? null : form.severity,
    confidence: form.confidence,
    definition,
  };
}

/** The index of the condition a schema issue points at (`conditions.2.value.value` → 2). */
export function issueCondition(path: readonly PropertyKey[]): number | null {
  const index = path.indexOf("conditions");
  const value = index < 0 ? undefined : path[index + 1];
  return typeof value === "number" ? value : null;
}
