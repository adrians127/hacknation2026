import { registry } from "../../scripts/registry";
import {
  cookieAuth,
  forbidden,
  notFound,
  unauthenticated,
  validationFailed,
} from "../common/common.openapi";
import { IdParamsSchema } from "../common/common.schema";
import {
  CreateRuleBodySchema,
  RuleListResponseSchema,
  RulePreviewBodySchema,
  RulePreviewResponseSchema,
  RuleSchema,
  UpdateRuleBodySchema,
} from "./rules.schema";

const tags = ["Rules"];
const security = cookieAuth;

const Rule = registry.register("Rule", RuleSchema);

const APPLIED = [
  "The rules are applied again right away: values the rule set where it no longer matches go back",
  "to `unreviewed` (or to the next matching rule), and it never overwrites a value a user set.",
].join(" ");

registry.registerPath({
  method: "get",
  path: "/rules",
  operationId: "listRules",
  summary: "List the rules",
  description: [
    "Requires `rules:read`. Every rule in order (the first matching rule sets a value), with what",
    "it holds now: hosts, services and vulnerabilities whose triage it set, and tags it added.",
  ].join(" "),
  tags,
  security,
  responses: {
    200: {
      description: "The rules",
      content: { "application/json": { schema: RuleListResponseSchema } },
    },
    401: unauthenticated,
    403: forbidden,
  },
});

registry.registerPath({
  method: "post",
  path: "/rules",
  operationId: "createRule",
  summary: "Create a rule",
  description: [
    "Requires `rules:create`. The rule goes last in the order and applies to every scan, past and",
    `future. ${APPLIED}`,
  ].join(" "),
  tags,
  security,
  request: { body: { content: { "application/json": { schema: CreateRuleBodySchema } } } },
  responses: {
    201: { description: "The rule", content: { "application/json": { schema: Rule } } },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
  },
});

registry.registerPath({
  method: "patch",
  path: "/rules/{id}",
  operationId: "updateRule",
  summary: "Change, enable, disable or move a rule",
  description: `Requires \`rules:update\`. ${APPLIED}`,
  tags,
  security,
  request: {
    params: IdParamsSchema,
    body: { content: { "application/json": { schema: UpdateRuleBodySchema } } },
  },
  responses: {
    200: { description: "The rule", content: { "application/json": { schema: Rule } } },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "delete",
  path: "/rules/{id}",
  operationId: "deleteRule",
  summary: "Delete a rule",
  description: [
    "Requires `rules:delete`. What the rule set goes back to `unreviewed` (or to the next matching",
    "rule) and the tags it added are removed; values users set stay.",
  ].join(" "),
  tags,
  security,
  request: { params: IdParamsSchema },
  responses: {
    204: { description: "Deleted" },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});

registry.registerPath({
  method: "post",
  path: "/rules/preview",
  operationId: "previewRule",
  summary: "What a rule would do now",
  description: [
    "Requires `rules:read`. Evaluates a rule definition without saving it: how many targets it",
    "matches, how many it would change, how many it leaves because a user (or an earlier rule) set",
    "them, and examples. Change rules are checked on the newest scan with results.",
  ].join(" "),
  tags,
  security,
  request: { body: { content: { "application/json": { schema: RulePreviewBodySchema } } } },
  responses: {
    200: {
      description: "The preview",
      content: { "application/json": { schema: RulePreviewResponseSchema } },
    },
    400: validationFailed,
    401: unauthenticated,
    403: forbidden,
    404: notFound,
  },
});
