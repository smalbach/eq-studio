/** The endpoints of the active project; see `lib/project-store.ts`. */
import { getProject } from "@/lib/project-store";

export type { Endpoint, HttpMethod } from "@eq/runner-core";
export { useEndpoints } from "@/lib/project-store";

export function getEndpoints() {
  return getProject().endpoints;
}
