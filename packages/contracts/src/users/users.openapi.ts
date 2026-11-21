import { registry } from "../../scripts/registry";
import {
  cookieAuth,
  errorResponse,
  forbidden,
  notFound,
  unauthenticated,
  validationFailed,
} from "../common/common.openapi";
import { IdParamsSchema } from "../common/common.schema";
import {
  CreateUserBodySchema,
  UpdateUserBodySchema,
  UserListResponseSchema,
  UserSchema,
  UserWithTemporaryPasswordResponseSchema,
} from "./users.schema";

const tags = ["Users"];
const security = cookieAuth;
const User = registry.register("User", UserSchema);
const userResponse = {
  description: "The user",
  content: { "application/json": { schema: User } },
};
const temporaryPasswordResponse = {
  description: "The user and a one-time temporary password",
  content: { "application/json": { schema: UserWithTemporaryPasswordResponseSchema } },
};

registry.registerPath({
  method: "get",
  path: "/users",
  operationId: "listUsers",
  summary: "List users",
  description: "Requires `users:read`.",
  tags,
  security,
  responses: {
    200: {
      description: "All users, active first, then by display name",
      content: { "application/json": { schema: UserListResponseSchema } },
    },
    401: unauthenticated,
    403: forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/users",
  operationId: "createUser",
  summary: "Create a user",
  description:
    "Requires `users:create`. The server generates a temporary password and returns it once; the user must change it at first sign-in. You can only assign a role whose permissions you hold yourself.",
  tags,
  security,
  request: { body: { content: { "application/json": { schema: CreateUserBodySchema } } } },
  responses: {
    201: temporaryPasswordResponse,
    400: validationFailed,
    401: unauthenticated,
    403: errorResponse("Missing permission, or the role grants more than you hold"),
    409: errorResponse("Email already taken (`EMAIL_TAKEN`)"),
  },
});

registry.registerPath({
  method: "get",
  path: "/users/{id}",
  operationId: "getUser",
  summary: "Get a user",
  description: "Requires `users:read`.",
  tags,
  security,
  request: { params: IdParamsSchema },
  responses: { 200: userResponse, 401: unauthenticated, 403: forbidden, 404: notFound },
});

registry.registerPath({
  method: "patch",
  path: "/users/{id}",
  operationId: "updateUser",
  summary: "Rename a user or change their role",
  description:
    "Requires `users:update`. You cannot change your own role, assign a role with permissions you do not hold, or take the admin role from the last active admin.",
  tags,
  security,
  request: {
    params: IdParamsSchema,
    body: { content: { "application/json": { schema: UpdateUserBodySchema } } },
  },
  responses: {
    200: userResponse,
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    409: errorResponse("Would leave no active admin (`LAST_ADMIN`)"),
  },
});

registry.registerPath({
  method: "post",
  path: "/users/{id}/reset-password",
  operationId: "resetUserPassword",
  summary: "Issue a new temporary password",
  description:
    "Requires `users:update`. Signs the user out everywhere, clears a lockout and forces a password change at next sign-in.",
  tags,
  security,
  request: { params: IdParamsSchema },
  responses: {
    200: temporaryPasswordResponse,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/users/{id}/deactivate",
  operationId: "deactivateUser",
  summary: "Deactivate a user",
  description:
    "Requires `users:delete`. Users are never hard-deleted. Signs the user out everywhere. You cannot deactivate yourself or the last active admin.",
  tags,
  security,
  request: { params: IdParamsSchema },
  responses: {
    200: userResponse,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    409: errorResponse("Would leave no active admin (`LAST_ADMIN`)"),
  },
});

registry.registerPath({
  method: "post",
  path: "/users/{id}/reactivate",
  operationId: "reactivateUser",
  summary: "Reactivate a user",
  description: "Requires `users:delete`.",
  tags,
  security,
  request: { params: IdParamsSchema },
  responses: { 200: userResponse, 401: unauthenticated, 403: forbidden, 404: notFound },
});
