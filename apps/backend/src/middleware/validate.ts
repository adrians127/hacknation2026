import type { RequestHandler } from "express";
import type { ZodType } from "zod";

export interface RequestSchemas {
  params?: ZodType;
  query?: ZodType;
  body?: ZodType;
}

/**
 * Validates params/query/body against `@subsurf/contracts` schemas. A mismatch
 * throws a `ZodError`, which the error handler turns into a 400.
 *
 * `parse` without reassigning: Express 5 makes `req.query` read-only, so schema
 * transforms (e.g. `.trim()`) never reach the handler.
 */
export function validate(schemas: RequestSchemas): RequestHandler {
  return (req, _res, next) => {
    if (schemas.params) schemas.params.parse(req.params);
    if (schemas.query) schemas.query.parse(req.query);
    if (schemas.body) schemas.body.parse(req.body);
    next();
  };
}
