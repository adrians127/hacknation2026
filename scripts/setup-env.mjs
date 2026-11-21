#!/usr/bin/env node
// `pnpm project:setup`: creates every `.env` from its `.env*.example`. When the `.env` already
// exists, it only appends the keys the example has and the `.env` lacks (with their comments),
// so re-running after a pull picks up new variables. Existing values are never changed: a real
// `.env` may hold secrets. `--force` replaces the file instead, keeping the old one as `<name>.bak`.

import { appendFileSync, copyFileSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".turbo",
  "dist",
  "build",
  "out",
  ".next",
  "coverage",
]);

// Repo root, `apps/*`, `packages/*`, `docker/`, `apps/workers/*` all fit.
const MAX_DEPTH = 3;

const KEY_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;
// A commented-out key counts as present: someone disabled it on purpose.
const COMMENTED_KEY_LINE = /^\s*#\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

const force = process.argv.includes("--force");

function isEnvExample(name) {
  return name.startsWith(".env") && name.endsWith(".example");
}

function findEnvExamples(dir, depth = 0) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (depth >= MAX_DEPTH || SKIP_DIRS.has(entry.name)) continue;
      found.push(...findEnvExamples(join(dir, entry.name), depth + 1));
    } else if (entry.isFile() && isEnvExample(entry.name)) {
      found.push(join(dir, entry.name));
    }
  }
  return found;
}

function presentKeys(text) {
  const keys = new Set();
  for (const line of text.split(/\r?\n/)) {
    const match = KEY_LINE.exec(line) ?? COMMENTED_KEY_LINE.exec(line);
    if (match) keys.add(match[1]);
  }
  return keys;
}

/** The example's keys missing from `existing`, each with the comment lines right above it. */
function missingEntries(exampleText, existing) {
  const lines = exampleText.split(/\r?\n/);
  const entries = [];
  lines.forEach((line, index) => {
    const match = KEY_LINE.exec(line);
    if (!match || existing.has(match[1])) return;
    let start = index;
    while (start > 0 && lines[start - 1].trimStart().startsWith("#")) start--;
    entries.push({ key: match[1], lines: lines.slice(start, index + 1) });
  });
  return entries;
}

function appendMissing(source, target) {
  const current = readFileSync(target, "utf8");
  const entries = missingEntries(readFileSync(source, "utf8"), presentKeys(current));
  if (entries.length === 0) return [];

  // A blank line before each commented entry keeps the example's grouping.
  const body = entries
    .map(({ lines }, i) => (i > 0 && lines.length > 1 ? `\n${lines.join("\n")}` : lines.join("\n")))
    .join("\n");
  const separator = current === "" || current.endsWith("\n") ? "\n" : "\n\n";
  appendFileSync(target, `${separator}# Added by pnpm project:setup (new in .env.example)\n${body}\n`);
  return entries;
}

// Values the examples ship as `your-…`, which only a human can fill in.
function placeholderKeys(lines) {
  return lines
    .map((line) => /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?your-/.exec(line)?.[1])
    .filter(Boolean);
}

const examples = findEnvExamples(REPO_ROOT).toSorted();

if (examples.length === 0) {
  console.log("No .env*.example files found — nothing to do.");
  process.exit(0);
}

const placeholders = [];
let changed = false;

for (const source of examples) {
  const target = source.slice(0, -".example".length);
  const shown = relative(REPO_ROOT, target);

  if (!existsSync(target)) {
    copyFileSync(source, target);
    console.log(`  created   ${shown}`);
    placeholders.push({ shown, keys: placeholderKeys(readFileSync(target, "utf8").split("\n")) });
    changed = true;
  } else if (force) {
    copyFileSync(target, `${target}.bak`);
    copyFileSync(source, target);
    console.log(`  overwrote ${shown} (backup: ${shown}.bak)`);
    placeholders.push({ shown, keys: placeholderKeys(readFileSync(target, "utf8").split("\n")) });
    changed = true;
  } else {
    const added = appendMissing(source, target);
    if (added.length === 0) {
      console.log(`  ok        ${shown} (no missing variables)`);
      continue;
    }
    console.log(`  updated   ${shown}: added ${added.map((e) => e.key).join(", ")}`);
    placeholders.push({ shown, keys: placeholderKeys(added.flatMap((e) => e.lines)) });
    changed = true;
  }
}

const needsFilling = placeholders.filter((p) => p.keys.length > 0);
if (needsFilling.length > 0) {
  console.log("\n⚠️  Placeholder values to fill in before `pnpm dev`:");
  for (const { shown, keys } of needsFilling) console.log(`  ${shown}: ${keys.join(", ")}`);
}

if (changed) console.log("\nNext: pnpm db:up && pnpm dev");
