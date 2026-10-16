import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False on the server and during hydration, true after. For output that depends on the browser's
 * clock or time zone (a day boundary, a local date): the server runs in UTC, so rendering it
 * there would not match the client.
 */
export const useHydrated = () => useSyncExternalStore(subscribe, () => true, () => false);
