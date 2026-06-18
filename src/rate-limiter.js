/**
 * Simple in-memory rate limiter — works in Cloudflare Workers and Node.js.
 *
 * Uses a fixed-window counter per key (typically IP address).
 * Lazy-cleans expired entries during check().
 */

function createRateLimiter({ maxAttempts = 5, windowMs = 60_000 } = {}) {
  const store = new Map();

  function check(key) {
    const now = Date.now();
    const entry = store.get(key);

    // First attempt or window expired → reset
    if (!entry || now >= entry.resetTime) {
      store.set(key, { count: 1, resetTime: now + windowMs });
      return { allowed: true };
    }

    entry.count += 1;

    if (entry.count > maxAttempts) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      return { allowed: false, retryAfter };
    }

    return { allowed: true };
  }

  return { check };
}

export { createRateLimiter };
