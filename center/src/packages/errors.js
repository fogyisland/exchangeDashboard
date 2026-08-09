export const ERROR_CODES = Object.freeze({
  PKG_INVALID_ZIP: 400,
  PKG_INVALID_MANIFEST: 400,
  PKG_NAME_CONFLICT: 409,
  PKG_REINSTALL_BLOCKED: 409,
  PKG_DOWNGRADE_NOT_ALLOWED: 409,
  PKG_DDL_FORBIDDEN: 400,
  PKG_SCHEMA_MISMATCH: 400,
  PKG_INSTALL_FAILED: 500,
  PKG_UNINSTALL_FAILED: 500,
  PKG_CONFIRM_REQUIRED: 400,
  PKG_NOT_FOUND: 404,
  PKG_METRIC_KEY_UNKNOWN: 400,
  PKG_METRIC_TYPE_MISMATCH: 400,
  PKG_TIMEOUT: 500
});

export class PkgError extends Error {
  constructor(code, message, httpStatus, details) {
    super(message);
    this.name = 'PkgError';
    this.code = code;
    this.httpStatus = httpStatus ?? 400;
    this.details = details ?? null;
  }
}