const crypto = require("crypto");
const { AppError } = require("./errors");

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
    const adminToken = process.env.INSTAMOVE_ADMIN_TOKEN;
    const paymentToken = process.env.INSTAMOVE_PAYMENT_TOKEN;

    if (!adminToken && !(requiredRole === "payment" && paymentToken)) {
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

module.exports = { authorize };
