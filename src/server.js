import express from "express";
import { createRateLimiter } from "./rateLimiter.js";
import { rateLimit } from "./middleware.js";

const WINDOW_MS = 60_000;

const basicLimiter = createRateLimiter({ limit: 5, windowMs: WINDOW_MS });
const premiumLimiter = createRateLimiter({ limit: 10, windowMs: WINDOW_MS });

const app = express();

app.get("/api/basic", rateLimit(basicLimiter, "basic"), (req, res) => {
  res.status(200).json({ message: "Hello from the basic endpoint" });
});

app.get("/api/premium", rateLimit(premiumLimiter, "premium"), (req, res) => {
  res.status(200).json({ message: "Hello from the premium endpoint" });
});

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
