export async function onRequestGet() {
  return new Response(JSON.stringify({ authenticated: true }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export function onRequest() {
  return new Response("Method not allowed", { status: 405 });
}
