// Sliding window log rate limiter.
// For each key we store the timestamps (ms) of allowed requests in the last window.
export function createRateLimiter({ limit, windowMs, now = () => Date.now() }) {
  const hits = new Map();

  function check(key) {
    const currentTime = now();
    const windowStart = currentTime - windowMs;

    // Drop timestamps that have slid out of the window
    const timestamps = (hits.get(key) ?? []).filter((t) => t > windowStart);

    // Check and record happen together with no `await` in between,
    // so concurrent requests can't both see the same count (atomic in Node).
    if (timestamps.length < limit) {
      timestamps.push(currentTime);
      hits.set(key, timestamps);
      return {
        allowed: true,
        limit,
        remaining: limit - timestamps.length,
        retryAfterSeconds: 0,
      };
    }

    hits.set(key, timestamps);
    const oldest = timestamps[0];
    const retryAfterMs = oldest + windowMs - currentTime;
    return {
      allowed: false,
      limit,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  return { check };
}