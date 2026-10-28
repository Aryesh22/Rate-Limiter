import { describe, test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/server.js";

let time;
const now = () => time;

describe("rate limit modes", () => {
  beforeEach(() => {
    time = 1_000_000;
  });

  test("enforce is the default", async () => {
    const app = createApp({ now });
    for (let i = 0; i < 5; i++) await request(app).get("/api/basic").expect(200);
    await request(app).get("/api/basic").expect(429);
  });

  test("shadow allows everyone but logs who would be blocked", async (t) => {
    const log = t.mock.method(console, "log", () => {});
    const app = createApp({ now, mode: "shadow" });
    for (let i = 0; i < 7; i++) await request(app).get("/api/basic").expect(200);
    assert.equal(log.mock.callCount(), 2);
    assert.match(log.mock.calls[0].arguments[0], /\[shadow\] would block basic:/);
  });

  test("off allows everyone", async () => {
    const app = createApp({ now, mode: "off" });
    for (let i = 0; i < 20; i++) await request(app).get("/api/basic").expect(200);
  });
});
