import express from "express";
import Redis from "ioredis";
import { createRateLimiter } from "./rateLimiter.js";
import { createRedisRateLimiter } from "./redisRateLimiter.js";
import { rateLimit } from "./middleware.js";
import { MODES, withMode } from "./mode.js";

const WINDOW_MS = 60_000;

export function createApp({ redis, now, mode = "enforce" } = {}) {
  const makeLimiter = (limit) =>
    withMode(
      redis
        ? createRedisRateLimiter({ redis, limit, windowMs: WINDOW_MS, now })
        : createRateLimiter({ limit, windowMs: WINDOW_MS, now }),
      { mode, limit },
    );

  const app = express();

  app.get("/api/basic", rateLimit(makeLimiter(5), "basic"), (req, res) => {
    res.status(200).json({ message: "Hello from the basic endpoint" });
  });

  app.get("/api/premium", rateLimit(makeLimiter(10), "premium"), (req, res) => {
    res.status(200).json({ message: "Hello from the premium endpoint" });
  });

  app.use((req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.use((err, req, res, next) => {
    console.error(err);
    res.status(503).json({ error: "Rate limiter unavailable" });
  });

  return app;
}

if (import.meta.main) {
  const redis = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 })
    : undefined;
  const PORT = process.env.PORT ?? 3000;
  const mode = process.env.RATE_LIMIT_MODE ?? "enforce";
  if (!MODES.includes(mode)) {
    throw new Error(`RATE_LIMIT_MODE must be enforce, shadow or off (got "${mode}")`);
  }

  createApp({ redis, mode }).listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT} (storage: ${redis ? "redis" : "memory"}, mode: ${mode})`);
  });
}
