import products from "../../../public/data/products.json";
import {
  badRequest,
  createRecommendationStream,
  modelConfigFromEnv,
  sseHeaders
} from "../../../src/recommendation-core.js";
import { COOKIE_NAME, parseCookies, verifyToken } from "../../../src/auth.js";

function fallbackId() {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function requestClientContext(request) {
  const forwardedFor = request.headers.get("X-Forwarded-For") || "";
  return {
    ip:
      request.headers.get("CF-Connecting-IP") ||
      forwardedFor.split(",")[0]?.trim() ||
      "unknown",
    userAgent: request.headers.get("User-Agent") || "",
    referer: request.headers.get("Referer") || "",
    country: request.headers.get("CF-IPCountry") || "",
    colo: request.cf?.colo || ""
  };
}

async function saveChatLog(env, entry) {
  if (env.CHAT_LOGS?.put) {
    const day = entry.startedAt.slice(0, 10);
    const key = `chat/${day}/${entry.sessionId}/${entry.requestId}.json`;
    await env.CHAT_LOGS.put(key, JSON.stringify(entry, null, 2), {
      metadata: {
        sessionId: entry.sessionId,
        status: entry.status,
        mode: entry.mode || "unknown",
        startedAt: entry.startedAt
      }
    });
    return;
  }

  console.log(JSON.stringify({ type: "chat_log", ...entry }));
}

export async function onRequestPost({ request, env }) {
  let user = null;
  if (env.AUTH_USERNAME && env.AUTH_PASSWORD) {
    const cookies = parseCookies(request.headers.get("Cookie") || "");
    const payload = await verifyToken(cookies[COOKIE_NAME], env.AUTH_SECRET);
    if (!payload) {
      return new Response(JSON.stringify({ error: "请先登录。" }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }
    user = { username: payload.username || "" };
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return badRequest("请求格式不正确。");
  }

  const message = String(body.message || "").trim();
  if (!message) return badRequest("请输入你的需求。");

  const sessionId = String(body.sessionId || "").trim().slice(0, 80) || "unknown";
  const requestId = globalThis.crypto?.randomUUID?.() || fallbackId();

  const stream = await createRecommendationStream({
    message,
    products,
    config: modelConfigFromEnv(env),
    logContext: {
      requestId,
      sessionId,
      user,
      client: requestClientContext(request)
    },
    onLog: (entry) => saveChatLog(env, entry)
  });

  return new Response(stream, { headers: sseHeaders() });
}

export function onRequest() {
  return new Response("Method not allowed", { status: 405 });
}
