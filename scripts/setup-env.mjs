#!/usr/bin/env node
/**
 * Bootstraps local env files: finds every `.env*.example` in the repo and copies
 * it to the same path without the `.example` suffix.
 *
 * Existing files are NEVER clobbered by default — a real `.env` holds secrets
 * the example only has placeholders for (JWT secrets, encryption keys), so a
 * blind copy would silently break a working setup. Pass `--force` to overwrite
 * anyway; the previous file is saved alongside as `<name>.bak` first.
 *
 * Run via `pnpm project:setup`.
 */

import { copyFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Directories never worth walking into. */
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

/** How deep to look: repo root, `apps/*`, `packages/*`, `docker/`, `apps/workers/*` all fit. */
const MAX_DEPTH = 3;

const force = process.argv.includes("--force");

/** Matches `.env.example`, `.env.test.example`, … */
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

/** Placeholder values the examples ship with, which only a human can fill in. */
function placeholderKeys(filePath) {
  return readFileSync(filePath, "utf8")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#") && line.includes("="))
    .filter((line) => /=\s*"?your-/.test(line))
    .map((line) => line.slice(0, line.indexOf("=")).trim());
}

const examples = findEnvExamples(REPO_ROOT).sort();

if (examples.length === 0) {
  console.log("No .env*.example files found — nothing to do.");
  process.exit(0);
}

const created = [];
const skipped = [];
const overwritten = [];

for (const source of examples) {
  const target = source.slice(0, -".example".length);
  const shown = relative(REPO_ROOT, target);

  if (existsSync(target)) {
    if (!force) {
      skipped.push(shown);
      continue;
    }
    copyFileSync(target, `${target}.bak`);
    copyFileSync(source, target);
    overwritten.push(shown);
    continue;
  }

  copyFileSync(source, target);
  created.push({ shown, placeholders: placeholderKeys(target) });
}

for (const { shown } of created) console.log(`  created   ${shown}`);
for (const shown of overwritten) console.log(`  overwrote ${shown} (backup: ${shown}.bak)`);
for (const shown of skipped) console.log(`  skipped   ${shown} (already exists)`);

if (skipped.length > 0 && !force) {
  console.log("\nExisting files were left untouched. Re-run with --force to replace them");
  console.log("(the current file is backed up to <name>.bak first).");
}

const needsFilling = created.filter((f) => f.placeholders.length > 0);
if (needsFilling.length > 0) {
  console.log("\n⚠️  These copies still have placeholder values — fill them in before `pnpm dev`:");
  for (const { shown, placeholders } of needsFilling) {
    console.log(`  ${shown}: ${placeholders.join(", ")}`);
  }
}

if (created.length > 0 || overwritten.length > 0) {
  console.log("\nNext: pnpm db:up && pnpm dev");
}
