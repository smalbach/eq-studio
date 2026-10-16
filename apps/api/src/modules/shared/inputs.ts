/** Request schemas shared by more than one module. */
import { z } from "zod";

const localized = z.union([z.string(), z.object({ es: z.string(), en: z.string() })]);

export const environmentInput = z.object({
  key: z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9._-]*$/i, "letters, digits, dot, dash and underscore").optional(),
  name: z.string().min(1).max(200),
  baseUrl: z.url({ protocol: /^https?$/ }),
  specUrl: z.string().max(2000).optional(),
  seeded: z.boolean().optional(),
  writesAllowed: z.boolean().optional(),
  enforceLatency: z.boolean().optional(),
  authEnabled: z.boolean().optional(),
  description: localized.optional(),
});
export type EnvironmentInput = z.infer<typeof environmentInput>;

export const specSource = z.union([
  z.object({ url: z.url({ protocol: /^https?$/ }), headers: z.record(z.string(), z.string()).optional() }),
  z.object({ document: z.union([z.string().min(2), z.record(z.string(), z.unknown())]) }),
]);
