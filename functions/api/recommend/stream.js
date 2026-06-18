import products from "../../../public/data/products.json";
import {
  badRequest,
  createRecommendationStream,
  modelConfigFromEnv,
  sseHeaders
} from "../../../src/recommendation-core.js";
import { COOKIE_NAME, parseCookies, verifyToken } from "../../../src/auth.js";

export async function onRequestPost({ request, env }) {
  if (env.AUTH_USERNAME && env.AUTH_PASSWORD) {
    const cookies = parseCookies(request.headers.get("Cookie") || "");
    const payload = await verifyToken(cookies[COOKIE_NAME], env.AUTH_SECRET);
    if (!payload) {
      return new Response(JSON.stringify({ error: "请先登录。" }), {
        status: 401,
        headers: { "content-type": "application/json; charset=utf-8" }
      });
    }
  }

  let body = {};
  try {
    body = await request.json();
  } catch {
    return badRequest("请求格式不正确。");
  }

  const message = String(body.message || "").trim();
  if (!message) return badRequest("请输入你的需求。");

  const stream = await createRecommendationStream({
    message,
    products,
    config: modelConfigFromEnv(env)
  });

  return new Response(stream, { headers: sseHeaders() });
}

export function onRequest() {
  return new Response("Method not allowed", { status: 405 });
}
