import {
  adminConfigFromEnv,
  signAdminToken,
  setAdminCookie
} from "../../../src/admin-auth.js";
import { createRateLimiter } from "../../../src/rate-limiter.js";

const loginLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 60_000 });

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers
    }
  });
}

export async function onRequestPost({ request, env }) {
  const config = adminConfigFromEnv(env);
  if (!config.configured) {
    return jsonResponse({ error: "管理员账号未配置。" }, 403);
  }

  const clientIp =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown";

  const limit = loginLimiter.check(clientIp);
  if (!limit.allowed) {
    return jsonResponse(
      { error: `尝试次数过多，请 ${limit.retryAfter} 秒后再试。` },
      429,
      { "retry-after": String(limit.retryAfter) }
    );
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "请求格式不正确。" }, 400);
  }

  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  if (username !== config.username || password !== config.password) {
    return jsonResponse({ error: "管理员账号或密码错误。" }, 401);
  }

  const token = await signAdminToken(username, config.secret);
  return jsonResponse(
    { ok: true },
    200,
    { "set-cookie": setAdminCookie(token) }
  );
}

export function onRequest() {
  return new Response("Method not allowed", { status: 405 });
}
