import { signToken, setAuthCookie } from "../../src/auth.js";
import { createRateLimiter } from "../../src/rate-limiter.js";

const loginLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 60_000 });

export async function onRequestPost({ request, env }) {
  const clientIp =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown";

  // Rate limit check before processing
  const limit = loginLimiter.check(clientIp);
  if (!limit.allowed) {
    return new Response(
      JSON.stringify({
        error: `尝试次数过多，请 ${limit.retryAfter} 秒后再试。`
      }),
      {
        status: 429,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "retry-after": String(limit.retryAfter)
        }
      }
    );
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "请求格式不正确。" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  const username = String(body.username || "").trim();
  const password = String(body.password || "");

  if (!username || !password) {
    return new Response(JSON.stringify({ error: "请输入账号和密码。" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  if (username !== env.AUTH_USERNAME || password !== env.AUTH_PASSWORD) {
    return new Response(JSON.stringify({ error: "账号或密码错误。" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  const token = await signToken(
    { username, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 },
    env.AUTH_SECRET
  );

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "set-cookie": setAuthCookie(token)
    }
  });
}

export function onRequest() {
  return new Response("Method not allowed", { status: 405 });
}
