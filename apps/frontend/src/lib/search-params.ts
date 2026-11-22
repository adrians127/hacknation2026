/** A 1-based page number from the URL; anything else is the first page. */
export function parsePage(raw: string | null): number {
  const page = Number(raw);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

/** A URL parameter as the schema's type, or `undefined` when it is absent or not one of its values. */
export function parseOr<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  raw: string | null,
): T | undefined {
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}
