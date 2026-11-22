/** Tags as stored: trimmed, each once, in the order given. */
export function normalizeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()))];
}
