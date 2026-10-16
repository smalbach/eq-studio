import { useCallback, useEffect, useState } from "react";
import { routeFromParams, routeToSearch, type Route } from "@/lib/routes";

export type { Route, Section } from "@/lib/routes";

type HistoryState = { eqRoute?: true; depth?: number };

/**
 * The route plus `navigate` and `back`. `back` goes back in the browser history when the
 * current screen was reached from inside the app, so "Volver" and the browser button agree;
 * on a screen opened directly from a link it replaces the URL with `fallback` instead of
 * leaving the app.
 */
export function useRoute(initial: Route) {
  const [route, setRoute] = useState<Route>(initial);
  useEffect(() => {
    const onPop = () => setRoute(routeFromParams(new URLSearchParams(window.location.search)));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = useCallback((next: Route, options: { replace?: boolean } = {}) => {
    const url = `${window.location.pathname}${routeToSearch(next)}`;
    const depth = ((window.history.state as HistoryState | null)?.depth ?? 0) + (options.replace ? 0 : 1);
    const state: HistoryState = { eqRoute: true, depth };
    if (options.replace) window.history.replaceState(state, "", url);
    else window.history.pushState(state, "", url);
    setRoute(next);
    if (!next.run) window.scrollTo({ top: 0 });
  }, []);
  const back = useCallback((fallback: Route) => {
    if (((window.history.state as HistoryState | null)?.depth ?? 0) > 0) window.history.back();
    else navigate(fallback, { replace: true });
  }, [navigate]);
  return { route, navigate, back };
}
