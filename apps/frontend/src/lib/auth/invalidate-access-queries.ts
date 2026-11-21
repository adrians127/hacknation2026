import type { QueryClient } from "@tanstack/react-query";

// Users show their role, roles show their user count, and /auth/me holds the caller's own
// permissions: any user or role change can affect all of them.
const ACCESS_PATHS = ["/users", "/users/{id}", "/roles", "/roles/{id}", "/auth/me"] as const;

export function invalidateAccessQueries(queryClient: QueryClient): Promise<void[]> {
  return Promise.all(
    ACCESS_PATHS.map((path) => queryClient.invalidateQueries({ queryKey: ["get", path] })),
  );
}
