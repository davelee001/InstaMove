const crypto = require("crypto");
const { AppError } = require("./errors");

const MINIMUM_TOKEN_LENGTH = 24;

function isUsableToken(value) {
  return typeof value === "string" &&
    value.length >= MINIMUM_TOKEN_LENGTH &&
    !value.toLowerCase().startsWith("replace-with");
}

function getAuthConfiguration() {
  const adminToken = process.env.INSTAMOVE_ADMIN_TOKEN;
  const paymentToken = process.env.INSTAMOVE_PAYMENT_TOKEN;
  const adminConfigured = isUsableToken(adminToken);
  const paymentConfigured = isUsableToken(paymentToken);
  const rolesAreDistinct = !adminToken || !paymentToken || adminToken !== paymentToken;

  return {
    adminToken,
    paymentToken,
    adminConfigured,
    paymentConfigured,
    rolesAreDistinct,
    valid: adminConfigured && rolesAreDistinct && (paymentConfigured || adminConfigured)
  };
}

function matchesToken(presented, expected) {
  if (!presented || !expected) {
    return false;
  }

  const presentedBuffer = Buffer.from(presented);
  const expectedBuffer = Buffer.from(expected);
  return presentedBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(presentedBuffer, expectedBuffer);
}

function readBearerToken(header) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    return null;
  }
  return header.slice(7).trim() || null;
}

function authorize(requiredRole) {
  return (req, res, next) => {
    const configuration = getAuthConfiguration();
    const { adminToken, paymentToken } = configuration;

    if (!configuration.rolesAreDistinct) {
      return next(new AppError(503, "AUTH_MISCONFIGURED", "API authentication roles are misconfigured"));
    }

    const requiredTokenConfigured = requiredRole === "admin"
      ? configuration.adminConfigured
      : configuration.paymentConfigured || configuration.adminConfigured;
    if (!requiredTokenConfigured) {
      return next(new AppError(503, "AUTH_NOT_CONFIGURED", "API authentication is not configured"));
    }

    const presented = readBearerToken(req.get("authorization"));
    const isAdmin = matchesToken(presented, adminToken);
    const hasPaymentRole = matchesToken(presented, paymentToken);
    const isPayment = requiredRole === "payment" && hasPaymentRole;

    if (!isAdmin && !isPayment) {
      if (presented && hasPaymentRole) {
        return next(new AppError(403, "FORBIDDEN", "The token does not grant access to this operation"));
      }
      res.set("WWW-Authenticate", 'Bearer realm="InstaMove"');
      return next(new AppError(401, "UNAUTHORIZED", "A valid bearer token is required"));
    }

    req.auth = { role: isAdmin ? "admin" : "payment" };
    return next();
  };
}

module.exports = { authorize, getAuthConfiguration, isUsableToken };
