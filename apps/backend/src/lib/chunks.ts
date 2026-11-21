/** Splits bulk writes: Postgres caps one statement at 65,535 bind parameters. */
export function* chunks<T>(items: readonly T[], size: number): Generator<T[]> {
  for (let start = 0; start < items.length; start += size) {
    yield items.slice(start, start + size);
  }
}
