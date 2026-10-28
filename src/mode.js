export const MODES = ["enforce", "shadow", "off"];

export function withMode(limiter, { mode, limit }) {
  if (mode === "enforce") return limiter;

  async function check(key) {
    if (mode === "off") {
      return { allowed: true, limit, remaining: limit, retryAfterSeconds: 0 };
    }

    const result = await limiter.check(key);
    if (!result.allowed) {
      console.log(`[shadow] would block ${key} (retry in ${result.retryAfterSeconds}s)`);
    }
    return { ...result, allowed: true };
  }

  return { check };
}
