/**
 * Version ordering for strings with no formal scheme (NVD CPE versions, PyPI, Packagist, apk).
 * Digits compare as numbers, words by kind: pre-release < release < post-release.
 */

export interface WordRanks {
  /** Before the release they qualify (1.0rc1 < 1.0), in this order. */
  pre: readonly string[];
  /** After it (9.6p1 > 9.6), in this order. */
  post: readonly string[];
  /** Same as no qualifier (1.0-final = 1.0). */
  release: readonly string[];
}

export const GENERIC_WORDS: WordRanks = {
  pre: [
    "dev",
    "snapshot",
    "alpha",
    "a",
    "beta",
    "b",
    "milestone",
    "m",
    "pre",
    "preview",
    "rc",
    "c",
    "cr",
  ],
  post: ["p", "pl", "patch", "post", "r", "rev", "sp", "update", "u", "git", "svn", "cvs", "hg"],
  release: ["final", "ga", "release", "stable"],
};

type Token =
  | { kind: "number"; value: string }
  | { kind: "pre"; rank: number; word: string }
  | { kind: "post"; rank: number; word: string };

const RELEASE_RANK = 0;

function tokenize(version: string, words: WordRanks): Token[] {
  const tokens: Token[] = [];
  const source = version.toLowerCase();
  for (const match of source.matchAll(/\d+|[a-z]+/g)) {
    const text = match[0];
    const end = match.index + text.length;
    if (/^\d/.test(text)) {
      tokens.push({ kind: "number", value: text.replace(/^0+(?=\d)/, "") });
      continue;
    }
    if (words.release.includes(text)) continue;
    const preRank = words.pre.indexOf(text);
    const postRank = words.post.indexOf(text);
    // A lone letter closing the version is a patch letter (OpenSSL 1.0.2k), not a pre-release.
    const followedByDigit = /\d/.test(source[end] ?? "");
    const afterDigit = match.index > 0 && /\d/.test(source[match.index - 1]);
    if (text.length === 1 && afterDigit && !followedByDigit) {
      tokens.push({ kind: "post", rank: words.post.length + text.charCodeAt(0), word: text });
    } else if (preRank !== -1) {
      tokens.push({ kind: "pre", rank: preRank, word: text });
    } else if (postRank !== -1) {
      tokens.push({ kind: "post", rank: postRank, word: text });
    } else {
      // Unknown words sort after the known post-release ones, alphabetically.
      tokens.push({ kind: "post", rank: words.post.length + 1000, word: text });
    }
  }
  return tokens;
}

function compareNumbers(a: string, b: string): number {
  return a.length === b.length ? a.localeCompare(b) : a.length - b.length;
}

/** Where a token sits relative to "nothing left": pre < (end) < post, numbers above all. */
function weight(token: Token | undefined): number {
  if (!token) return RELEASE_RANK;
  if (token.kind === "pre") return -1;
  if (token.kind === "post") return 1;
  return 2;
}

function compareTokens(a: Token, b: Token): number {
  if (a.kind === "number" && b.kind === "number") return compareNumbers(a.value, b.value);
  if (a.kind !== b.kind) return weight(a) - weight(b);
  if (a.kind === "number" || b.kind === "number") return 0;
  return a.rank - b.rank || a.word.localeCompare(b.word);
}

export function createComparator(words: WordRanks) {
  return (left: string, right: string): number => {
    const a = tokenize(left, words);
    const b = tokenize(right, words);
    for (let index = 0; index < Math.max(a.length, b.length); index++) {
      const x = a[index];
      const y = b[index];
      if (x && y) {
        const order = compareTokens(x, y);
        if (order !== 0) return Math.sign(order);
        continue;
      }
      // One version ran out: trailing zeros change nothing (1.0 = 1.0.0), then the first other
      // token decides (1.0.0rc1 < 1.0 < 1.0.1, 9.6 < 9.6p1).
      const longer = x ? a : b;
      const next = longer
        .slice(index)
        .find((token) => token.kind !== "number" || token.value !== "0");
      if (!next) return 0;
      const longerIsGreater = weight(next) > RELEASE_RANK ? 1 : -1;
      return x ? longerIsGreater : -longerIsGreater;
    }
    return 0;
  };
}

export const compareGeneric = createComparator(GENERIC_WORDS);
