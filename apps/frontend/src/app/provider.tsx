import { QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useEffect, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { toast } from "sonner";

import { setSessionExpiredHandler } from "@/api/client";
import { queryClient } from "@/api/query-client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { meQueryKey } from "@/lib/auth/me-query";

/** Sends a user whose session died mid-use back to the login page, then back here after sign-in. */
function SessionExpiryRedirect() {
  const navigate = useNavigate();
  const { t } = useTranslation("auth");

  useEffect(() => {
    setSessionExpiredHandler(() => {
      // No cached user means nobody was signed in (e.g. the login page itself): nothing to do.
      if (!queryClient.getQueryData(meQueryKey())) return;
      queryClient.clear();
      toast.info(t("sessionExpired"));
      const here = `${window.location.pathname}${window.location.search}`;
      void navigate(`/login?redirectTo=${encodeURIComponent(here)}`, { replace: true });
    });
  }, [navigate, t]);

  return null;
}

export function AppProvider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={200}>
        <SessionExpiryRedirect />
        {children}
        <Toaster position="top-center" />
      </TooltipProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
