import { createHash } from "node:crypto";

/** mulberry32: a small seeded generator, so every run of the demo seed builds the same network. */
export function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number): number => min + Math.floor(next() * (max - min + 1)),
    chance: (probability: number): boolean => next() < probability,
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
  };
}

export type Random = ReturnType<typeof createRandom>;

/** A stable stand-in for a hash the worker would compute (host keys, bodies, certificates). */
export const fakeSha256 = (label: string): string =>
  createHash("sha256").update(label).digest("hex");

/** A stable signed 32-bit integer standing in for a favicon's MurmurHash3. */
export const fakeMmh3 = (label: string): number =>
  createHash("sha256").update(label).digest().readInt32BE(0);

/** Picks from a list by a host's fixed variant number, so both runs agree. */
export const byVariant = <T>(variant: number, items: readonly T[]): T => items[variant % items.length];
