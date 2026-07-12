import { verifyAdminRequest } from "../../../src/admin-auth.js";

const DEFAULT_PREFIX = "chat/";
const MAX_KEYS_PER_OPERATION = 10000;

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function cleanPrefix(value) {
  const prefix = String(value || DEFAULT_PREFIX).trim();
  if (!prefix) return "";
  if (prefix.includes("..") || prefix.startsWith("/")) return DEFAULT_PREFIX;
  return prefix.slice(0, 120);
}

function cleanKey(value) {
  const key = String(value || "").trim();
  if (!key || key.includes("..") || key.startsWith("/")) return "";
  return key.slice(0, 500);
}

function listComplete(result) {
  return Boolean(result.list_complete ?? result.listComplete);
}

async function collectKeys(namespace, { prefix, keys }) {
  if (Array.isArray(keys) && keys.length) {
    return [...new Set(keys.map(cleanKey).filter(Boolean))].slice(0, MAX_KEYS_PER_OPERATION);
  }

  const collected = [];
  let cursor = undefined;
  do {
    const result = await namespace.list({ prefix, cursor, limit: 1000 });
    for (const item of result.keys || []) {
      collected.push(item.name);
      if (collected.length >= MAX_KEYS_PER_OPERATION) return collected;
    }
    cursor = result.cursor;
    if (listComplete(result)) break;
  } while (cursor);

  return collected;
}

async function exportKeys(namespace, keys) {
  const lines = [];
  for (const key of keys) {
    const text = await namespace.get(key);
    let value = text;
    try {
      value = JSON.parse(text);
    } catch {
      // Keep non-JSON values as strings.
    }
    lines.push(JSON.stringify({ key, value }));
  }
  return `${lines.join("\n")}${lines.length ? "\n" : ""}`;
}

export async function onRequestGet({ request, env }) {
  const admin = await verifyAdminRequest(request, env);
  if (!admin.ok) return jsonResponse({ error: admin.error }, admin.status);
  if (!env.CHAT_LOGS?.list) return jsonResponse({ error: "未绑定 CHAT_LOGS KV。" }, 503);

  const url = new URL(request.url);
  const prefix = cleanPrefix(url.searchParams.get("prefix"));
  const cursor = url.searchParams.get("cursor") || undefined;
  const limit = Math.max(1, Math.min(1000, Number(url.searchParams.get("limit") || 100)));

  const result = await env.CHAT_LOGS.list({ prefix, cursor, limit });
  return jsonResponse({
    ok: true,
    prefix,
    keys: (result.keys || []).map((item) => ({
      name: item.name,
      metadata: item.metadata || null,
      expiration: item.expiration || null
    })),
    cursor: result.cursor || "",
    listComplete: listComplete(result)
  });
}

export async function onRequestPost({ request, env }) {
  const admin = await verifyAdminRequest(request, env);
  if (!admin.ok) return jsonResponse({ error: admin.error }, admin.status);
  if (!env.CHAT_LOGS?.list) return jsonResponse({ error: "未绑定 CHAT_LOGS KV。" }, 503);

  let body = {};
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "请求格式不正确。" }, 400);
  }

  const action = String(body.action || "").trim();
  const prefix = cleanPrefix(body.prefix);
  const keys = await collectKeys(env.CHAT_LOGS, { prefix, keys: body.keys });

  if (action === "export") {
    const content = await exportKeys(env.CHAT_LOGS, keys);
    const filename = `chat-logs-${new Date().toISOString().slice(0, 10)}.jsonl`;
    return new Response(content, {
      status: 200,
      headers: {
        "content-type": "application/x-ndjson; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "x-exported-count": String(keys.length)
      }
    });
  }

  if (action === "delete") {
    if (!Array.isArray(body.keys) && body.confirm !== "DELETE") {
      return jsonResponse({ error: "按前缀批量删除需要输入 DELETE 确认。" }, 400);
    }

    for (const key of keys) {
      await env.CHAT_LOGS.delete(key);
    }

    return jsonResponse({ ok: true, deletedCount: keys.length });
  }

  return jsonResponse({ error: "不支持的操作。" }, 400);
}

export function onRequest() {
  return new Response("Method not allowed", { status: 405 });
}
