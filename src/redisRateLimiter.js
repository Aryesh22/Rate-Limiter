import { randomUUID } from "node:crypto";

const SLIDING_WINDOW_SCRIPT = `
local key = KEYS[1]
local limit = tonumber(ARGV[1])
local windowMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local member = ARGV[4]

redis.call("ZREMRANGEBYSCORE", key, "-inf", now - windowMs)
local count = redis.call("ZCARD", key)

if count < limit then
  redis.call("ZADD", key, now, member)
  redis.call("PEXPIRE", key, windowMs)
  return {1, limit - count - 1, 0}
end

local oldest = redis.call("ZRANGE", key, 0, 0, "WITHSCORES")
return {0, 0, tonumber(oldest[2]) + windowMs - now}
`;

export function createRedisRateLimiter({ redis, limit, windowMs, now = () => Date.now() }) {
  if (!redis.slidingWindow) {
    redis.defineCommand("slidingWindow", { numberOfKeys: 1, lua: SLIDING_WINDOW_SCRIPT });
  }

  async function check(key) {
    const [allowed, remaining, retryAfterMs] = await redis.slidingWindow(
      `ratelimit:${key}`,
      limit,
      windowMs,
      now(),
      randomUUID(),
    );

    return {
      allowed: allowed === 1,
      limit,
      remaining,
      retryAfterSeconds: allowed === 1 ? 0 : Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  return { check };
}
