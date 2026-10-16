/**
 * Domain errors. Handlers throw these; the problem-details filter turns each into its HTTP
 * status, so no handler knows about HTTP.
 */
export class DomainError extends Error {
  constructor(message: string, readonly status: number, readonly title: string, readonly errors?: string[]) {
    super(message);
  }
}

export class NotFound extends DomainError {
  constructor(what: string) { super(`${what} not found`, 404, "Not Found"); }
}

export class Conflict extends DomainError {
  constructor(message: string) { super(message, 409, "Conflict"); }
}

export class Invalid extends DomainError {
  constructor(message: string, errors?: string[]) { super(message, 422, "Unprocessable Content", errors); }
}

export class Unreachable extends DomainError {
  constructor(message: string) { super(message, 502, "Bad Gateway"); }
}

export class Unauthorized extends DomainError {
  constructor(message = "Sign in, or send an API token") { super(message, 401, "Unauthorized"); }
}

export class Forbidden extends DomainError {
  constructor(message: string) { super(message, 403, "Forbidden"); }
}

export class TooManyRequests extends DomainError {
  constructor(message = "Too many attempts; wait a minute") { super(message, 429, "Too Many Requests"); }
}
