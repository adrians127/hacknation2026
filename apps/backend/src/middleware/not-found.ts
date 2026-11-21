import type { Request, Response } from "express";

import type { ErrorResponse } from "@subsurf/contracts/common/common.schema";

/** Terminal 404 for unmatched routes; separate from the error handler because it is not an error. */
export function notFound(req: Request, res: Response<ErrorResponse>): void {
  res.status(404).json({
    error: { message: `Cannot ${req.method} ${req.originalUrl}`, status: 404 },
  });
}
