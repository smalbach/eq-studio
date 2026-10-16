import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from "@nestjs/common";
import { ZodError } from "zod";
import { DomainError } from "./errors.ts";

/** Every error as `application/problem+json` (RFC 9457) — the API holds itself to the shape it
 * checks other APIs against. */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<{ status(code: number): { type(value: string): { send(body: string): void } } }>();
    const problem = toProblem(error);
    response.status(problem.status).type("application/problem+json").send(JSON.stringify(problem));
  }
}

export function toProblem(error: unknown): { type: string; title: string; status: number; detail: string; errors?: string[] } {
  if (error instanceof DomainError) return { type: "about:blank", title: error.title, status: error.status, detail: error.message, ...(error.errors ? { errors: error.errors } : {}) };
  if (error instanceof ZodError) return { type: "about:blank", title: "Unprocessable Content", status: 422, detail: "The request body is not valid", errors: error.issues.map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`) };
  if (error instanceof HttpException) {
    const status = error.getStatus();
    return { type: "about:blank", title: error.name.replace(/Exception$/, "").replace(/([a-z])([A-Z])/g, "$1 $2") || "Error", status, detail: error.message };
  }
  console.error(error);
  return { type: "about:blank", title: "Internal Server Error", status: 500, detail: "Unexpected error" };
}
