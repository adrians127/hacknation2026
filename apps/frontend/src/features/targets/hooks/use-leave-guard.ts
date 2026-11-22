import { useCallback } from "react";
import { useBeforeUnload, useBlocker } from "react-router";

/**
 * While `when` holds, in-app navigation away is blocked (render a confirmation while the
 * returned blocker is `blocked`) and closing or reloading the tab shows the browser's prompt.
 */
export function useLeaveGuard(when: boolean) {
  useBeforeUnload(
    useCallback(
      (event: BeforeUnloadEvent) => {
        if (when) event.preventDefault();
      },
      [when],
    ),
  );
  return useBlocker(
    ({ currentLocation, nextLocation }) => when && currentLocation.pathname !== nextLocation.pathname,
  );
}
