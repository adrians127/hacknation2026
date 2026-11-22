// JSONB stores object keys in its own order, so a stored value rarely stringifies like the input.
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([x], [y]) => x.localeCompare(y))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

/** Key-order-independent equality for JSON values. */
export function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
