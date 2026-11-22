import { z } from "zod";

import { env } from "~backend/config/env";
import { HttpError } from "~backend/lib/http-error";

const PAGE_SIZE = 200;
const REQUEST_TIMEOUT_MS = 20_000;
// Import deduplicates synchronously: thousands of findings take a while.
const IMPORT_TIMEOUT_MS = 300_000;

const IdSchema = z.number().int();
const DateSchema = z.string().nullish();

export const DojoProductSchema = z.object({
  id: IdSchema,
  name: z.string(),
  tags: z.array(z.string()).default([]),
  product_manager: IdSchema.nullish(),
  technical_contact: IdSchema.nullish(),
});

export const DojoUserSchema = z.object({ id: IdSchema, username: z.string() });

export const DojoFindingSchema = z.object({
  id: IdSchema,
  description: z.string().nullish(),
  unique_id_from_tool: z.string().nullish(),
  /** Location ids; resolved through the response's `prefetch.endpoints`. */
  endpoints: z.array(IdSchema).default([]),
  tags: z.array(z.string()).default([]),
  active: z.boolean(),
  verified: z.boolean(),
  false_p: z.boolean(),
  out_of_scope: z.boolean(),
  risk_accepted: z.boolean(),
  is_mitigated: z.boolean(),
  planned_remediation_date: DateSchema,
  sla_expiration_date: DateSchema,
  accepted_risks: z.array(z.object({ expiration_date: DateSchema })).default([]),
});

const DojoEndpointSchema = z.object({ location_value: z.string().nullish() });

const BucketSchema = z
  .object({ total: z.object({ total: z.number().int() }).partial().optional() })
  .optional();

/** Counts per bucket, as `statistics.delta.created.total.total`. */
const DojoImportResultSchema = z.object({
  test_id: IdSchema,
  statistics: z
    .object({
      after: z.object({ total: z.object({ total: z.number().int() }).partial().optional() }).optional(),
      delta: z
        .object({ created: BucketSchema, closed: BucketSchema, reactivated: BucketSchema, untouched: BucketSchema })
        .optional(),
    })
    .optional(),
});

export type DojoImportResult = z.infer<typeof DojoImportResultSchema>;

export type DojoProduct = z.infer<typeof DojoProductSchema>;
export type DojoUser = z.infer<typeof DojoUserSchema>;
export type DojoFindingFields = z.infer<typeof DojoFindingSchema>;

/** A finding with the URLs of its locations (`https://10.40.1.10`, `ssh://10.40.8.72:22`). */
export interface DojoFinding extends DojoFindingFields {
  locations: string[];
}

const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({
    count: z.number().int(),
    results: z.array(item),
    prefetch: z.object({ endpoints: z.record(z.string(), DojoEndpointSchema).optional() }).optional(),
  });

const unavailable = (message: string, cause?: unknown) =>
  new HttpError(502, message, { code: "DEFECTDOJO_UNAVAILABLE", cause });

/** Read-only DefectDojo API v2 client. Pages by offset: `next` links carry DefectDojo's own host. */
export class DefectDojoClient {
  private readonly baseUrl: string;

  constructor(
    url: string,
    private readonly token: string,
  ) {
    this.baseUrl = `${url.replace(/\/+$/, "")}/api/v2`;
  }

  private async send(
    path: string,
    init: { params?: Record<string, string | number>; form?: FormData; timeoutMs?: number } = {},
  ): Promise<Response> {
    const query = new URLSearchParams(
      Object.entries(init.params ?? {}).map(([k, v]) => [k, String(v)]),
    ).toString();
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}${query ? `?${query}` : ""}`, {
        method: init.form ? "POST" : "GET",
        headers: { Authorization: `Token ${this.token}`, Accept: "application/json" },
        body: init.form,
        signal: AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw unavailable(`DefectDojo did not answer (${path})`, error);
    }
    if (res.status === 401 || res.status === 403) {
      throw unavailable(`DefectDojo refused the API token (${path}: HTTP ${res.status})`);
    }
    return res;
  }

  private async get(path: string, params: Record<string, string | number>): Promise<unknown> {
    const res = await this.send(path, { params });
    if (!res.ok) throw unavailable(`DefectDojo answered HTTP ${res.status} (${path})`);
    try {
      return await res.json();
    } catch (error) {
      throw unavailable(`DefectDojo sent a response that is not JSON (${path})`, error);
    }
  }

  private async *pages<T extends z.ZodType>(
    path: string,
    item: T,
    params: Record<string, string | number> = {},
  ): AsyncGenerator<z.infer<ReturnType<typeof pageOf<T>>>> {
    const schema = pageOf(item);
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const parsed = schema.safeParse(
        await this.get(path, { ...params, limit: PAGE_SIZE, offset }),
      );
      if (!parsed.success) {
        throw unavailable(`DefectDojo returned an unexpected ${path} page: ${parsed.error.message}`);
      }
      yield parsed.data;
      if (offset + PAGE_SIZE >= parsed.data.count || parsed.data.results.length === 0) return;
    }
  }

  private async all<T extends z.ZodType>(path: string, item: T): Promise<z.infer<T>[]> {
    const items: z.infer<T>[] = [];
    for await (const page of this.pages(path, item)) items.push(...page.results);
    return items;
  }

  listProducts(): Promise<DojoProduct[]> {
    return this.all("/products/", DojoProductSchema);
  }

  listUsers(): Promise<DojoUser[]> {
    return this.all("/users/", DojoUserSchema);
  }

  /** `false` when the test was deleted in DefectDojo (a reimport into it would fail). */
  async testExists(id: number): Promise<boolean> {
    const res = await this.send(`/tests/${id}/`);
    if (res.status === 404) return false;
    if (!res.ok) throw unavailable(`DefectDojo answered HTTP ${res.status} (/tests/${id}/)`);
    return true;
  }

  /** `POST /import-scan/` or `/reimport-scan/`; DefectDojo deduplicates before it answers. */
  async uploadReport(kind: "import" | "reimport", form: FormData): Promise<DojoImportResult> {
    const path = `/${kind}-scan/`;
    const res = await this.send(path, { form, timeoutMs: IMPORT_TIMEOUT_MS });
    const text = await res.text();
    if (!res.ok) {
      throw unavailable(`DefectDojo rejected the report (${path}: HTTP ${res.status}): ${text.slice(0, 300)}`);
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw unavailable(`DefectDojo sent a response that is not JSON (${path})`, error);
    }
    const parsed = DojoImportResultSchema.safeParse(body);
    if (!parsed.success) throw unavailable(`DefectDojo returned an unexpected ${path} response`);
    return parsed.data;
  }

  async listFindings(productId: number): Promise<DojoFinding[]> {
    const findings: DojoFinding[] = [];
    const params = { test__engagement__product: productId, prefetch: "endpoints" };
    for await (const page of this.pages("/findings/", DojoFindingSchema, params)) {
      const endpoints = page.prefetch?.endpoints ?? {};
      for (const finding of page.results) {
        const locations = finding.endpoints.flatMap((id) => {
          const value = endpoints[String(id)]?.location_value;
          return value ? [value] : [];
        });
        findings.push({ ...finding, locations });
      }
    }
    return findings;
  }
}

/** The client for `DEFECTDOJO_URL`/`DEFECTDOJO_API_TOKEN`; 503 while they are unset. */
export function configuredClient(): DefectDojoClient {
  if (!env.DEFECTDOJO_URL || !env.DEFECTDOJO_API_TOKEN) {
    throw new HttpError(503, "DefectDojo is not configured (DEFECTDOJO_URL, DEFECTDOJO_API_TOKEN)", {
      code: "DEFECTDOJO_NOT_CONFIGURED",
    });
  }
  return new DefectDojoClient(env.DEFECTDOJO_URL, env.DEFECTDOJO_API_TOKEN);
}
