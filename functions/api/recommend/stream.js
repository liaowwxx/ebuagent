import products from "../../../public/data/products.json";
import {
  badRequest,
  createRecommendationStream,
  modelConfigFromEnv,
  sseHeaders
} from "../../../src/recommendation-core.js";
import {
  applyLogEvent,
  chatLogKey,
  chatLogMetadata,
  pendingEventPrefix
} from "../../../src/log-events.js";

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
    await mergePendingEvents(env, entry);
    const key = chatLogKey(entry);
    await env.CHAT_LOGS.put(key, JSON.stringify(entry, null, 2), {
      metadata: chatLogMetadata(entry)
    });
    return;
  }

  console.log(JSON.stringify({ type: "chat_log", ...entry }));
}

async function mergePendingEvents(env, entry) {
  if (!env.CHAT_LOGS?.list) return;
  const prefix = pendingEventPrefix(entry);
  const list = await env.CHAT_LOGS.list({ prefix, limit: 100 });

  for (const item of list.keys || []) {
    const event = await env.CHAT_LOGS.get(item.name, "json");
    if (event) applyLogEvent(entry, event);
  }
}

export async function onRequestPost({ request, env }) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return badRequest("请求格式不正确。");
  }

  const message = String(body.message || "").trim();
  if (!message) return badRequest("请输入你的需求。");

  const history = Array.isArray(body.history) ? body.history : [];
  const sessionId = String(body.sessionId || "").trim().slice(0, 80) || "unknown";
  const requestId = globalThis.crypto?.randomUUID?.() || fallbackId();

  const stream = await createRecommendationStream({
    message,
    history,
    products,
    config: modelConfigFromEnv(env),
    logContext: {
      requestId,
      sessionId,
      user: null,
      client: requestClientContext(request)
    },
    onLog: (entry) => saveChatLog(env, entry)
  });

  return new Response(stream, { headers: sseHeaders() });
}

export function onRequest() {
  return new Response("Method not allowed", { status: 405 });
}
