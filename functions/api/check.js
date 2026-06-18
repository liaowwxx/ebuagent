import { COOKIE_NAME, parseCookies, verifyToken } from "../../src/auth.js";

export async function onRequestGet({ request, env }) {
  // Auth is optional — if not configured, everyone is authenticated
  if (!env.AUTH_USERNAME || !env.AUTH_PASSWORD) {
    return new Response(JSON.stringify({ authenticated: true }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const payload = await verifyToken(cookies[COOKIE_NAME], env.AUTH_SECRET);

  if (!payload) {
    return new Response(JSON.stringify({ authenticated: false }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  return new Response(
    JSON.stringify({ authenticated: true, username: payload.username }),
    {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" }
    }
  );
}

export function onRequest() {
  return new Response("Method not allowed", { status: 405 });
}
