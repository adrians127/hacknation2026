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
  CreateRoleBodySchema,
  DeleteRoleQuerySchema,
  RoleDetailResponseSchema,
  RoleListResponseSchema,
  RoleSchema,
  UpdateRoleBodySchema,
} from "./roles.schema";

const tags = ["Roles"];
const security = cookieAuth;
const Role = registry.register("Role", RoleSchema);
const roleResponse = {
  description: "The role",
  content: { "application/json": { schema: Role } },
};

registry.registerPath({
  method: "get",
  path: "/roles",
  operationId: "listRoles",
  summary: "List roles",
  description: "Requires `roles:read`. System roles first, then custom roles by name.",
  tags,
  security,
  responses: {
    200: {
      description: "All roles",
      content: { "application/json": { schema: RoleListResponseSchema } },
    },
    401: unauthenticated,
    403: forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/roles",
  operationId: "createRole",
  summary: "Create a custom role",
  description: "Requires `roles:create`. You can only grant permissions you hold yourself.",
  tags,
  security,
  request: { body: { content: { "application/json": { schema: CreateRoleBodySchema } } } },
  responses: {
    201: roleResponse,
    400: validationFailed,
    401: unauthenticated,
    403: errorResponse("Missing permission, or grants more than you hold"),
    409: errorResponse("Name already taken (`ROLE_NAME_TAKEN`)"),
  },
});

registry.registerPath({
  method: "get",
  path: "/roles/{id}",
  operationId: "getRole",
  summary: "Get a role with its users",
  description: "Requires `roles:read`.",
  tags,
  security,
  request: { params: IdParamsSchema },
  responses: {
    200: {
      description: "The role and the users who have it",
      content: { "application/json": { schema: RoleDetailResponseSchema } },
    },
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "patch",
  path: "/roles/{id}",
  operationId: "updateRole",
  summary: "Update a custom role",
  description:
    "Requires `roles:update`. System roles are read-only. You cannot edit your own role or grant permissions you do not hold.",
  tags,
  security,
  request: {
    params: IdParamsSchema,
    body: { content: { "application/json": { schema: UpdateRoleBodySchema } } },
  },
  responses: {
    200: roleResponse,
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    409: errorResponse("Name already taken (`ROLE_NAME_TAKEN`)"),
  },
});

registry.registerPath({
  method: "delete",
  path: "/roles/{id}",
  operationId: "deleteRole",
  summary: "Delete a custom role",
  description:
    "Requires `roles:delete`. If users still have the role, pass `reassignToRoleId` (also requires `users:update`): they move to that role and the role is deleted in one transaction.",
  tags,
  security,
  request: { params: IdParamsSchema, query: DeleteRoleQuerySchema },
  responses: {
    204: { description: "Role deleted" },
    401: unauthenticated,
    403: forbidden,
    404: notFound,
    409: errorResponse("Users still have this role (`ROLE_IN_USE`)"),
  },
});
