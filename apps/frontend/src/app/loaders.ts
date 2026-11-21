import { redirect, type LoaderFunctionArgs } from "react-router";

import { queryClient } from "@/api/query-client";
import { isUnauthenticated } from "@/lib/api-error";
import { meQueryOptions } from "@/lib/auth/me-query";

const CHANGE_PASSWORD_PATH = "/app/change-password";

/** Protected layout: loads the user (refreshing the session if needed) or sends them to /login. */
export async function requireAuthLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  try {
    const me = await queryClient.ensureQueryData(meQueryOptions());
    if (me.mustChangePassword && url.pathname !== CHANGE_PASSWORD_PATH) {
      return redirect(CHANGE_PASSWORD_PATH);
    }
    return null;
  } catch (error) {
    if (!isUnauthenticated(error)) throw error;
    return redirect(`/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
  }
}

/** The login page: already signed in users go straight to the app. */
export async function guestLoader() {
  try {
    await queryClient.ensureQueryData(meQueryOptions());
    return redirect("/app");
  } catch {
    return null;
  }
}
