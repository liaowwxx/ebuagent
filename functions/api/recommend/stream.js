import products from "../../../public/data/products.json";
import {
  badRequest,
  createRecommendationStream,
  modelConfigFromEnv,
  sseHeaders
} from "../../../src/recommendation-core.js";

export async function onRequestPost({ request, env }) {
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
