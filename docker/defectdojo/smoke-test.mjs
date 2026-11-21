#!/usr/bin/env node
/**
 * Smoke test for the local DefectDojo: checks the API token, then imports a sample
 * nmap XML and a sample informational finding through /api/v2/import-scan/, the same
 * path the backend integration will use. See docker/README.md#defectdojo.
 *
 * Run via `pnpm dojo:smoke`. Env: DD_URL, DD_API_TOKEN (defaults match docker-compose.yml).
 */

import { openAsBlob } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DD_URL = (process.env.DD_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const DD_API_TOKEN = process.env.DD_API_TOKEN ?? "943acbe9baff8da06895e4349f3d06ee293189e8";
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const PRODUCT_TYPE = "Attack Surface Intelligence";
const PRODUCT = "ASI smoke test";

async function api(path, init = {}) {
  const method = init.method ?? "GET";
  let res;
  try {
    res = await fetch(`${DD_URL}/api/v2${path}`, {
      ...init,
      headers: { Authorization: `Token ${DD_API_TOKEN}`, Accept: "application/json" },
    });
  } catch (error) {
    throw new Error(`${method} ${path}: cannot reach ${DD_URL} (is it up? pnpm dojo:up)`, { cause: error });
  }
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> HTTP ${res.status}: ${text.slice(0, 1000)}`);
  return JSON.parse(text);
}

async function importScan(scanType, fixture, engagementName) {
  const file = join(FIXTURES, fixture);
  const form = new FormData();
  form.set("scan_type", scanType);
  form.set("file", await openAsBlob(file), basename(file));
  form.set("product_type_name", PRODUCT_TYPE);
  form.set("product_name", PRODUCT);
  form.set("engagement_name", engagementName);
  form.set("auto_create_context", "true");
  form.set("minimum_severity", "Info");
  form.set("active", "true");
  form.set("verified", "false");
  form.set("close_old_findings", "false");

  const result = await api("/import-scan/", { method: "POST", body: form });
  const testId = result.test_id ?? result.test;
  const findings = await api(`/findings/?test=${testId}&limit=1`);
  console.log(`  ${scanType}: test #${testId}, ${findings.count} finding(s)`);
  return result;
}

async function main() {
  const profile = await api("/user_profile/");
  console.log(`Token OK, authenticated as '${profile.user.username}' at ${DD_URL}`);

  const engagement = `smoke-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  console.log(`Importing into ${PRODUCT_TYPE} / ${PRODUCT} / ${engagement}:`);
  await importScan("Nmap Scan", "nmap-sample.xml", engagement);
  const last = await importScan("Generic Findings Import", "generic-findings.json", engagement);

  console.log(`Done. Product: ${DD_URL}/product/${last.product_id}`);
}

main().catch((error) => {
  console.error(`Smoke test failed: ${error.message}`);
  process.exitCode = 1;
});
