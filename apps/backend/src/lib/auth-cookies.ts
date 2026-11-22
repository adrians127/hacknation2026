import type { CookieOptions, Response } from "express";

import { env } from "~backend/config/env";
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_MS } from "~backend/lib/tokens";

export const ACCESS_COOKIE = "subsurf_access";
export const REFRESH_COOKIE = "subsurf_refresh";

// Only the refresh/logout endpoints ever see the refresh token.
const REFRESH_COOKIE_PATH = "/v1/auth";

// Secure in production unless COOKIE_SECURE=false: browsers drop Secure cookies sent over plain
// http to anything but localhost, so a lab install opened by IP could not sign in.
const base: CookieOptions = {
  httpOnly: true,
  secure: env.COOKIE_SECURE ?? env.NODE_ENV === "production",
};
const accessOptions: CookieOptions = { ...base, sameSite: "lax", path: "/" };
const refreshOptions: CookieOptions = { ...base, sameSite: "strict", path: REFRESH_COOKIE_PATH };

export function setAccessCookie(res: Response, accessToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, {
    ...accessOptions,
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
}

export function setRefreshCookie(res: Response, refreshToken: string): void {
  res.cookie(REFRESH_COOKIE, refreshToken, { ...refreshOptions, maxAge: REFRESH_TOKEN_TTL_MS });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, accessOptions);
  res.clearCookie(REFRESH_COOKIE, refreshOptions);
}

/** A cookie value, or undefined when absent (cookie-parser types them as `any`). */
export function readCookie(cookies: unknown, name: string): string | undefined {
  if (typeof cookies !== "object" || cookies === null) return undefined;
  const value: unknown = Reflect.get(cookies, name);
  return typeof value === "string" && value !== "" ? value : undefined;
}
