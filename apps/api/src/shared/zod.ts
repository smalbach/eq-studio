import type { ZodType } from "zod";
import { Invalid } from "./errors.ts";

/** Parses a request part with a schema; a failure is a 422 that names every field. */
export function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new Invalid("The request is not valid", result.error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`));
}
