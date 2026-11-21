import type { AuthContext } from "~backend/lib/auth-context";

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireAuth` / `requireSession` (middleware/authenticate.ts). */
      auth?: AuthContext;
    }
  }
}
