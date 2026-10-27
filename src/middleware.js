// Express middleware that applies a rate limiter to one route.
// Clients are identified by the X-API-Key header if sent, otherwise by IP address.
export function rateLimit(limiter, routeName) {
  return async (req, res, next) => {
    const apiKey = req.get("X-API-Key");
    const clientId = apiKey ? `key:${apiKey}` : `ip:${req.ip}`;
    const key = `${routeName}:${clientId}`;

    const result = await limiter.check(key);

    res.set("X-RateLimit-Limit", String(result.limit));
    res.set("X-RateLimit-Remaining", String(result.remaining));

    if (!result.allowed) {
      res.set("Retry-After", String(result.retryAfterSeconds));
      return res.status(429).json({
        error: "Too many requests",
        retryAfter: result.retryAfterSeconds,
      });
    }

    next();
  };
}
