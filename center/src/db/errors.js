export class DbError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}
export class UniqueViolation extends DbError {
  constructor(message, details) { super("UNIQUE_VIOLATION", message, details); }
}
export class NotFound extends DbError {
  constructor(message, details) { super("NOT_FOUND", message, details); }
}
