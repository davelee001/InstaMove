class AppError extends Error {
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

function normalizeError(error) {
  if (error instanceof AppError) {
    return error;
  }

  if (error?.type === "entity.parse.failed") {
    return new AppError(400, "INVALID_JSON", "Request body must be valid JSON");
  }

  return new AppError(500, "INTERNAL_ERROR", "The request could not be completed");
}

function toErrorResponse(error, requestId) {
  const normalized = normalizeError(error);
  const body = {
    status: "error",
    code: normalized.code,
    message: normalized.message,
    requestId
  };

  if (normalized.details) {
    body.details = normalized.details;
  }

  return { statusCode: normalized.statusCode, body };
}

module.exports = { AppError, normalizeError, toErrorResponse };
