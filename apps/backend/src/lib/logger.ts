import type { IncomingMessage } from "node:http";

import { pino, type LoggerOptions } from "pino";
import { pinoHttp } from "pino-http";

import { env, isDevelopment } from "~backend/config/env";

// Locally: pretty one-liners to stdout + JSON to logs/dev.log. Elsewhere: JSON to stdout only.
const transport: LoggerOptions["transport"] = isDevelopment
  ? {
      targets: [
        {
          target: "pino-pretty",
          level: env.LOG_LEVEL,
          options: {
            destination: 1,
            colorize: true,
            translateTime: "SYS:standard",
            ignore: "req,res,responseTime",
          },
        },
        {
          target: "pino/file",
          level: env.LOG_LEVEL,
          options: { destination: "logs/dev.log", mkdir: true },
        },
      ],
    }
  : undefined;

// Express sets originalUrl; routers rewrite req.url to the part after their mount point.
const urlOf = (req: IncomingMessage & { originalUrl?: string }) => req.originalUrl ?? req.url;

export const logger = pino({
  level: env.LOG_LEVEL,
  transport,
  ...(isDevelopment && { base: null }),
  // Tokens and session cookies must never reach a log.
  redact: ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'],
});

export const requestLogger = pinoHttp({
  logger,
  ...(isDevelopment && {
    serializers: {
      req: (req: { id: unknown; method: string; url: string }) => ({
        id: req.id,
        method: req.method,
        url: req.url,
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    customSuccessMessage: (req, res, responseTime) =>
      `${req.method} ${urlOf(req)} ${res.statusCode} ${Math.round(responseTime)}ms`,
    customErrorMessage: (req, res, err) =>
      `${req.method} ${urlOf(req)} ${res.statusCode} ${err.message}`,
  }),
});
