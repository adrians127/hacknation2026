/**
 * CPE names in both bindings: the 2.2 URI nmap reports (`cpe:/a:openbsd:openssh:9.6p1`) and the
 * 2.3 formatted string NVD uses (`cpe:2.3:a:openbsd:openssh:9.6:p1:*:*:*:*:*:*`).
 */

export type CpePart = "a" | "o" | "h";

export interface Cpe {
  part: CpePart;
  vendor: string;
  product: string;
  /** `null` = any (`*` or missing); `"-"` = not applicable. */
  version: string | null;
  update: string | null;
}

const isPart = (text: string): text is CpePart => text === "a" || text === "o" || text === "h";

function value(raw: string | undefined): string | null {
  if (raw === undefined || raw === "" || raw === "*") return null;
  return raw.toLowerCase();
}

function build(fields: (string | undefined)[]): Cpe | null {
  const [rawPart, vendor, product, version, update] = fields;
  const part = rawPart?.toLowerCase() ?? "";
  const parsedVendor = value(vendor);
  const parsedProduct = value(product);
  if (!isPart(part) || !parsedVendor || !parsedProduct) return null;
  return {
    part,
    vendor: parsedVendor,
    product: parsedProduct,
    version: value(version),
    update: value(update),
  };
}

/** `cpe:/part:vendor:product:version:update:edition:language`, percent-encoded. */
export function parseCpe22(uri: string): Cpe | null {
  if (!uri.toLowerCase().startsWith("cpe:/")) return null;
  const fields = uri.slice(5).split(":").map((field) => {
    try {
      return decodeURIComponent(field);
    } catch {
      return field;
    }
  });
  return build(fields);
}

/** `cpe:2.3:part:vendor:product:version:update:…`; `\` escapes the next character. */
export function parseCpe23(formatted: string): Cpe | null {
  if (!formatted.startsWith("cpe:2.3:")) return null;
  const fields: string[] = [];
  let current = "";
  for (let index = 8; index < formatted.length; index++) {
    const char = formatted[index];
    if (char === "\\" && index + 1 < formatted.length) {
      current += formatted[index + 1];
      index++;
    } else if (char === ":") {
      fields.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current);
  return build(fields);
}

export function parseCpe(name: string): Cpe | null {
  return name.startsWith("cpe:2.3:") ? parseCpe23(name) : parseCpe22(name);
}

/** The lookup key of the `cpe` matcher: version-independent. */
export function cpeMatchKey(cpe: Pick<Cpe, "part" | "vendor" | "product">): string {
  return `cpe:${cpe.part}:${cpe.vendor}:${cpe.product}`;
}

/**
 * One version string out of NVD's version + update (`9.6` + `p1` → `9.6p1`), the way scanners
 * report it. `null` when the CPE leaves the version open.
 */
export function joinedVersion(cpe: Pick<Cpe, "version" | "update">): string | null {
  const { version, update } = cpe;
  if (version === null || version === "-") return null;
  if (update === null || update === "-") return version;
  const attached = /^[a-z]/.test(update) && /\d$/.test(version);
  return attached ? `${version}${update}` : `${version}.${update}`;
}

/** nmap's guesses (`5.X`, `1.0 - 1.4`, `2.4.x or later`) are not versions to compare. */
export function isUsableVersion(version: string | null): version is string {
  if (version === null || version === "" || version === "-") return false;
  if (/\s/.test(version)) return false;
  if (/(^|[.\-_])[x*](?=$|[.\-_])/i.test(version)) return false;
  return /\d/.test(version);
}

export function formatCpe(cpe: Cpe): string {
  return [`cpe:/${cpe.part}`, cpe.vendor, cpe.product, cpe.version ?? "", cpe.update ?? ""]
    .join(":")
    .replace(/:+$/, "");
}
