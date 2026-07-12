import {
  applyLogEvent,
  chatLogKey,
  chatLogMetadata,
  normalizeClientLogEvent,
  pendingEventKey
} from "../../src/log-events.js";

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

async function saveFeedbackEvent(env, event) {
  if (!env.CHAT_LOGS?.put) return { stored: "console" };

  const key = chatLogKey(event);
  const existing = await env.CHAT_LOGS.get(key, "json");

  if (!existing) {
    const eventKey = pendingEventKey(event);
    await env.CHAT_LOGS.put(eventKey, JSON.stringify(event, null, 2), {
      metadata: {
        schemaVersion: String(event.schemaVersion || 1),
        sessionId: event.sessionId,
        requestId: event.requestId,
        eventType: event.eventType,
        startedAt: event.startedAt,
        createdAt: event.createdAt
      }
    });
    return { stored: "pending", key: eventKey };
  }

  applyLogEvent(existing, event);
  await env.CHAT_LOGS.put(key, JSON.stringify(existing, null, 2), {
    metadata: chatLogMetadata(existing)
  });
  return { stored: "chat", key };
}

export async function onRequestPost({ request, env }) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "请求格式不正确。" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  try {
    const event = normalizeClientLogEvent(body, {
      user: null,
      client: requestClientContext(request)
    });
    const result = await saveFeedbackEvent(env, event);

    if (!env.CHAT_LOGS?.put) {
      console.log(JSON.stringify({ type: "feedback_event", ...event }));
    }

    return new Response(JSON.stringify({ ok: true, stored: result.stored }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message || "反馈保存失败。" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
}

export function onRequest() {
  return new Response("Method not allowed", { status: 405 });
}
