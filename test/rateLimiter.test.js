import { describe, test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import Redis from "ioredis";
import { createApp } from "../src/server.js";

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379/15";

const redis = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, retryStrategy: () => null });
const redisAvailable = await redis.connect().then(() => true, () => false);
after(() => redis.disconnect());

let time;
const now = () => time;

for (const storage of ["memory", "redis"]) {
  describe(`rate limiter (${storage})`, { skip: storage === "redis" && !redisAvailable && "Redis not running" }, () => {
    let app;

    beforeEach(async () => {
      time = 1_000_000;
      if (storage === "redis") await redis.flushdb();
      app = createApp({ redis: storage === "redis" ? redis : undefined, now });
    });

    test("allows 5 requests to /api/basic, then returns 429", async () => {
      for (let i = 0; i < 5; i++) {
        await request(app).get("/api/basic").expect(200);
      }
      await request(app).get("/api/basic").expect(429);
    });

    test("allows 10 requests to /api/premium, then returns 429", async () => {
      for (let i = 0; i < 10; i++) {
        await request(app).get("/api/premium").expect(200);
      }
      await request(app).get("/api/premium").expect(429);
    });

    test("200 response has a JSON body and rate limit headers", async () => {
      const res = await request(app).get("/api/basic").expect(200);
      assert.equal(res.body.message, "Hello from the basic endpoint");
      assert.equal(res.headers["x-ratelimit-limit"], "5");
      assert.equal(res.headers["x-ratelimit-remaining"], "4");
    });

    test("429 response has a JSON error and correct Retry-After", async () => {
      for (let i = 0; i < 5; i++) await request(app).get("/api/basic");
      time += 20_000;
      const res = await request(app).get("/api/basic").expect(429);
      assert.equal(res.headers["retry-after"], "40");
      assert.equal(res.body.error, "Too many requests");
      assert.equal(res.body.retryAfter, 40);
    });

    test("basic and premium are counted separately", async () => {
      for (let i = 0; i < 5; i++) await request(app).get("/api/basic");
      await request(app).get("/api/basic").expect(429);
      await request(app).get("/api/premium").expect(200);
    });

    test("different API keys have separate limits", async () => {
      for (let i = 0; i < 5; i++) await request(app).get("/api/basic").set("X-API-Key", "alice");
      await request(app).get("/api/basic").set("X-API-Key", "alice").expect(429);
      await request(app).get("/api/basic").set("X-API-Key", "bob").expect(200);
    });

    test("access comes back after the window slides", async () => {
      for (let i = 0; i < 5; i++) await request(app).get("/api/basic");
      await request(app).get("/api/basic").expect(429);
      time += 60_000;
      await request(app).get("/api/basic").expect(200);
    });

    test("no burst at the window boundary (unlike a fixed window)", async () => {
      time = 59_000;
      for (let i = 0; i < 5; i++) await request(app).get("/api/basic").expect(200);
      time = 61_000;
      await request(app).get("/api/basic").expect(429);
    });

    test("50 concurrent requests -> exactly 5 succeed", async () => {
      const responses = await Promise.all(
        Array.from({ length: 50 }, () => request(app).get("/api/basic")),
      );
      const ok = responses.filter((r) => r.status === 200).length;
      const limited = responses.filter((r) => r.status === 429).length;
      assert.equal(ok, 5);
      assert.equal(limited, 45);
    });

    test("unknown URL returns 404", async () => {
      await request(app).get("/hello").expect(404);
    });
  });
}

describe("multiple server instances (redis)", { skip: !redisAvailable && "Redis not running" }, () => {
  test("two servers sharing Redis share one limit", async () => {
    time = 1_000_000;
    await redis.flushdb();
    const server1 = createApp({ redis, now });
    const server2 = createApp({ redis, now });

    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) => request(i % 2 ? server1 : server2).get("/api/basic")),
    );
    assert.equal(responses.filter((r) => r.status === 200).length, 5);
  });
});
