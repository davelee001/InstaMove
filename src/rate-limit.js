const { AppError } = require("./errors");

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function createRateLimiter({ name, max, windowMs }) {
  const buckets = new Map();

  return (req, res, next) => {
    const now = Date.now();
    const key = `${name}:${req.ip}`;
    let bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    res.set("RateLimit-Limit", String(max));
    res.set("RateLimit-Remaining", String(remaining));
    res.set("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.set("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))));
      return next(new AppError(429, "RATE_LIMITED", "Too many requests; try again later"));
    }

    if (buckets.size > 10000) {
      for (const [bucketKey, value] of buckets) {
        if (value.resetAt <= now) buckets.delete(bucketKey);
      }
    }

    return next();
  };
}

function createPaymentRateLimiter() {
  return createRateLimiter({
    name: "payment",
    max: positiveInteger(process.env.PAYMENT_RATE_LIMIT, 10),
    windowMs: positiveInteger(process.env.RATE_LIMIT_WINDOW_MS, 60000)
  });
}

function createAdminRateLimiter() {
  return createRateLimiter({
    name: "admin",
    max: positiveInteger(process.env.ADMIN_RATE_LIMIT, 30),
    windowMs: positiveInteger(process.env.RATE_LIMIT_WINDOW_MS, 60000)
  });
}

module.exports = { createAdminRateLimiter, createPaymentRateLimiter, createRateLimiter };
