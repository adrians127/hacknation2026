import { useSuspenseQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

/** The signed-in user. Loaded by the protected layout's loader before anything renders. */
export const meQueryOptions = () =>
  api.queryOptions("get", "/auth/me", {}, { staleTime: 5 * 60_000, retry: false });

export const meQueryKey = () => meQueryOptions().queryKey;

/** Only inside the protected layout, where the loader guarantees the data. */
export function useMe() {
  return useSuspenseQuery(meQueryOptions()).data;
}
