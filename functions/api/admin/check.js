import { verifyAdminRequest } from "../../../src/admin-auth.js";

export async function onRequestGet({ request, env }) {
  const admin = await verifyAdminRequest(request, env);
  if (!admin.ok) {
    return new Response(JSON.stringify({ authenticated: false, error: admin.error }), {
      status: admin.status,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }

  return new Response(JSON.stringify({ authenticated: true, username: admin.user.username }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export function onRequest() {
  return new Response("Method not allowed", { status: 405 });
}
