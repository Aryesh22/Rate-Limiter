# API Rate Limiter

A small Express service with two rate-limited endpoints, using a **sliding window log** algorithm.
Counters are stored **in memory** by default, or in **Redis** (with an atomic Lua script) so several server instances can share one limit.

| Endpoint | Method | Limit |
|---|---|---|
| `/api/basic` | GET | 5 requests / minute |
| `/api/premium` | GET | 10 requests / minute |

## Quick start

Requires Node.js 24+.

```bash
npm install
npm start                 # in-memory storage, http://localhost:3000
```

With Redis (optional):

```bash
brew install redis && brew services start redis   # or any Redis on localhost:6379
npm run start:redis
```

To use a different Redis, set `REDIS_URL` yourself, e.g. `REDIS_URL=redis://host:6379 npm start`.

Run the tests:

```bash
npm test                  # Redis tests are skipped automatically if Redis isn't running
```

## Try it

```bash
# 6 requests: 5 succeed, the 6th is rejected
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/api/basic; done

# See the 429 response with Retry-After
curl -i localhost:3000/api/basic

# Premium has its own counter
curl -i localhost:3000/api/premium

# Different API keys have their own limits
curl -i -H "X-API-Key: alice" localhost:3000/api/basic
```

**200 response**
```
HTTP/1.1 200 OK
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 4

{"message":"Hello from the basic endpoint"}
```

**429 response**
```
HTTP/1.1 429 Too Many Requests
X-RateLimit-Limit: 5
X-RateLimit-Remaining: 0
Retry-After: 42

{"error":"Too many requests","retryAfter":42}
```

## Assumptions

- **Client identity:** the `X-API-Key` header if present, otherwise the client IP address. Keys and IPs are namespaced (`key:` / `ip:`) so an API key can't collide with an IP.
- **Window:** a sliding 60-second window (the last 60 seconds from each request), not fixed clock minutes.
- **Rejected requests don't count** toward the limit, so a client that keeps retrying regains access once its old requests expire.
- **Retry-After** is in whole seconds, rounded up, minimum 1.
- **Per endpoint:** each endpoint has its own counter per client, so using up `/api/basic` doesn't affect `/api/premium`.
- **No proxy:** the IP is taken from the TCP connection. Behind a load balancer, Express's `trust proxy` setting would need to be enabled to read `X-Forwarded-For`.
- **Redis unavailable:** the service **fails closed** and returns `503 {"error":"Rate limiter unavailable"}`, rather than serving requests without protection.
- Unknown URLs return `404` with a JSON error.

## Approach

### Algorithm: sliding window log

For each client and endpoint, the service stores the timestamps of allowed requests. On each request:

1. Drop timestamps older than 60 seconds.
2. If fewer than `limit` remain, record the request and allow it (`200`).
3. Otherwise reject it (`429`) with `Retry-After = oldest timestamp + 60s − now`.

**Why not the alternatives?**

- **Fixed window** (reset every clock minute) is simpler, but allows bursts at the boundary: 5 requests at 0:59 plus 5 at 1:00 is 10 requests in two seconds. A test in this repo checks this burst is rejected.
- **Token bucket** is good for allowing bursts, but doesn't map exactly to "N requests per minute", and its Retry-After is less intuitive.
- **Sliding window counter** uses constant memory but is an approximation.
- The log stores at most `limit` timestamps per client (5 or 10), so its memory cost is tiny here, and it is exact.

### Concurrency

- **In memory:** Node.js runs JavaScript on a single thread. `check()` contains no `await`, so pruning, counting and recording run as one uninterrupted step. Two concurrent requests can never both read the same count.
- **Redis:** the remove / count / add steps run inside a single **Lua script**. Redis executes a script as one unit, without running other commands in between, so the guarantee holds even across multiple server instances. Each entry uses a random UUID as its sorted-set member, so two requests in the same millisecond are still counted separately. `PEXPIRE` removes idle clients' keys.
- Tests fire 50 simultaneous requests and assert that exactly 5 succeed, for both backends. Another test runs two app instances against the same Redis and checks that they share one limit.

### Storage trade-offs

| | In-memory | Redis |
|---|---|---|
| Setup | none | needs a Redis server |
| Survives a restart | no | yes |
| Shared across instances | no | yes |
| Cleanup of idle clients | not yet (see limitations) | `PEXPIRE` deletes idle keys |

## Project structure

```
src/server.js             Express app, routes, storage selection (REDIS_URL)
src/middleware.js         identifies the client, sets headers, returns 429
src/rateLimiter.js        in-memory sliding window log
src/redisRateLimiter.js   Redis sliding window log (Lua script)
test/rateLimiter.test.js  tests for both backends (node:test + supertest)
```

## Tests

`npm test` runs 10 tests against the in-memory limiter, plus the same 10 against Redis and a multi-instance test when Redis is running (21 in total). They cover:

- the 5 and 10 request limits
- the 200 and 429 response bodies and headers, including the exact Retry-After value
- separate counters per endpoint and per API key
- access returning after the window slides
- no burst at the window boundary
- 50 concurrent requests → exactly 5 allowed
- two server instances sharing one Redis limit

A fake clock is injected into the limiter, so "waiting 60 seconds" in tests is instant.

## Limitations and next steps

- **API keys aren't validated.** A client could send a new random key on each request to get a fresh limit. A real service would check keys against a store and reject unknown ones with `401`.
- In-memory mode keeps an entry for every client it has seen. A periodic cleanup of expired entries would bound memory.
- Limits are hard-coded. They could come from configuration per endpoint or per API-key tier.
- The timestamp comes from the app server's clock. With many servers, using Redis's own `TIME` inside the script avoids clock differences between machines.
- Fail-closed vs fail-open on Redis errors could be made configurable.
- For much larger limits (e.g. 10,000/min), a sliding window counter or GCRA would use constant memory per client instead of one timestamp per request.
