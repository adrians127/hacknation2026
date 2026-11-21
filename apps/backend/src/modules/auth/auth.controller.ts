import type { Request, Response } from "express";

import type {
  ChangePasswordBody,
  LoginBody,
  MeResponse,
} from "@subsurf/contracts/auth/auth.schema";

import {
  clearAuthCookies,
  readCookie,
  REFRESH_COOKIE,
  setAccessCookie,
  setRefreshCookie,
} from "~backend/lib/auth-cookies";
import { getAuth } from "~backend/lib/auth-context";
import { authService, type IssuedTokens, toMe } from "~backend/modules/auth/auth.service";

function setTokenCookies(res: Response, tokens: IssuedTokens): void {
  setAccessCookie(res, tokens.accessToken);
  if (tokens.refreshToken) setRefreshCookie(res, tokens.refreshToken);
}

export const authController = {
  login: async (req: Request<object, MeResponse, LoginBody>, res: Response<MeResponse>) => {
    const { me, tokens } = await authService.login(req.body, req.get("user-agent"));
    setTokenCookies(res, tokens);
    res.status(200).json(me);
  },

  refresh: async (req: Request, res: Response) => {
    try {
      setTokenCookies(res, await authService.refresh(readCookie(req.cookies, REFRESH_COOKIE)));
    } catch (error) {
      // A dead refresh cookie only causes repeated failures; drop both.
      clearAuthCookies(res);
      throw error;
    }
    res.status(204).end();
  },

  logout: async (req: Request, res: Response) => {
    await authService.logout(readCookie(req.cookies, REFRESH_COOKIE));
    clearAuthCookies(res);
    res.status(204).end();
  },

  me: (req: Request, res: Response<MeResponse>) => {
    const auth = getAuth(req);
    res.status(200).json(toMe({ ...auth.user, role: auth.role }));
  },

  changePassword: async (req: Request<object, unknown, ChangePasswordBody>, res: Response) => {
    await authService.changePassword(getAuth(req), req.body);
    res.status(204).end();
  },
};
