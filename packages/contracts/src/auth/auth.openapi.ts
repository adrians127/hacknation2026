import { registry } from "../../scripts/registry";
import {
  cookieAuth,
  errorResponse,
  unauthenticated,
  validationFailed,
} from "../common/common.openapi";
import { ChangePasswordBodySchema, LoginBodySchema, MeResponseSchema } from "./auth.schema";

const tags = ["Auth"];

const Me = registry.register("Me", MeResponseSchema);

registry.registerPath({
  method: "post",
  path: "/auth/login",
  operationId: "login",
  summary: "Sign in with email and password",
  description:
    "Sets two httpOnly cookies: `asi_access` (15 min JWT) and `asi_refresh` (7 days, path `/v1/auth`). Five failed attempts in a row lock the account for 15 minutes. Every failure (unknown email, wrong password, locked or deactivated account) returns the same 401.",
  tags,
  request: { body: { content: { "application/json": { schema: LoginBodySchema } } } },
  responses: {
    200: {
      description: "Signed in",
      content: { "application/json": { schema: Me } },
    },
    400: validationFailed,
    401: errorResponse("Invalid credentials (`INVALID_CREDENTIALS`)"),
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/refresh",
  operationId: "refreshSession",
  summary: "Rotate the refresh token and issue a new access token",
  description:
    "Reads the `asi_refresh` cookie. Presenting an already rotated refresh token revokes the whole session.",
  tags,
  responses: {
    204: { description: "New cookies set" },
    401: unauthenticated,
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/logout",
  operationId: "logout",
  summary: "Sign out",
  description: "Revokes the current session and clears both cookies. Always succeeds.",
  tags,
  responses: {
    204: { description: "Signed out" },
  },
});

registry.registerPath({
  method: "get",
  path: "/auth/me",
  operationId: "getMe",
  summary: "The signed-in user, their role and permissions",
  description: "Also works while `mustChangePassword` is true.",
  tags,
  security: cookieAuth,
  responses: {
    200: {
      description: "Current user",
      content: { "application/json": { schema: Me } },
    },
    401: unauthenticated,
  },
});

registry.registerPath({
  method: "post",
  path: "/auth/change-password",
  operationId: "changePassword",
  summary: "Change the signed-in user's password",
  description: "Signs out every other session of this user and clears `mustChangePassword`.",
  tags,
  security: cookieAuth,
  request: { body: { content: { "application/json": { schema: ChangePasswordBodySchema } } } },
  responses: {
    204: { description: "Password changed" },
    400: validationFailed,
    401: unauthenticated,
    403: errorResponse("Current password is wrong (`INVALID_CREDENTIALS`)"),
  },
});
