import type { Request, Response } from "express";

import type { IdParams } from "@hacknation/contracts/common/common.schema";
import type {
  CreateUserBody,
  UpdateUserBody,
  User,
  UserListResponse,
  UserWithTemporaryPasswordResponse,
} from "@hacknation/contracts/users/users.schema";

import { getAuth } from "~backend/lib/auth-context";
import { usersService } from "~backend/modules/users/users.service";

export const usersController = {
  list: async (_req: Request, res: Response<UserListResponse>) => {
    res.status(200).json({ items: await usersService.list() });
  },

  get: async (req: Request<IdParams>, res: Response<User>) => {
    res.status(200).json(await usersService.get(req.params.id));
  },

  create: async (
    req: Request<object, unknown, CreateUserBody>,
    res: Response<UserWithTemporaryPasswordResponse>,
  ) => {
    res.status(201).json(await usersService.create(getAuth(req), req.body));
  },

  update: async (req: Request<IdParams, unknown, UpdateUserBody>, res: Response<User>) => {
    res.status(200).json(await usersService.update(getAuth(req), req.params.id, req.body));
  },

  resetPassword: async (
    req: Request<IdParams>,
    res: Response<UserWithTemporaryPasswordResponse>,
  ) => {
    res.status(200).json(await usersService.resetPassword(getAuth(req), req.params.id));
  },

  deactivate: async (req: Request<IdParams>, res: Response<User>) => {
    res.status(200).json(await usersService.deactivate(getAuth(req), req.params.id));
  },

  reactivate: async (req: Request<IdParams>, res: Response<User>) => {
    res.status(200).json(await usersService.reactivate(getAuth(req), req.params.id));
  },
};
