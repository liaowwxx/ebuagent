import { parseCookies, signToken, verifyToken } from "./auth.js";

export const ADMIN_COOKIE_NAME = "admin_token";

function envValue(env, lowerName, upperName) {
  return env?.[lowerName] || env?.[upperName] || "";
}

export function adminConfigFromEnv(env) {
  const username = envValue(env, "admin_username", "ADMIN_USERNAME");
  const password = envValue(env, "admin_password", "ADMIN_PASSWORD");
  const secret =
    envValue(env, "admin_secret", "ADMIN_SECRET") ||
    envValue(env, "AUTH_SECRET", "AUTH_SECRET") ||
    password;

  return {
    username,
    password,
    secret,
    configured: Boolean(username && password && secret)
  };
}

export function setAdminCookie(token) {
  const maxAge = 7 * 24 * 60 * 60;
  return `${ADMIN_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

export function clearAdminCookie() {
  return `${ADMIN_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export async function signAdminToken(username, secret) {
  return signToken({ username, admin: true, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 }, secret);
}

export async function verifyAdminRequest(request, env) {
  const config = adminConfigFromEnv(env);
  if (!config.configured) {
    return {
      ok: false,
      status: 403,
      error: "管理员页面需要配置 admin_username 和 admin_password。"
    };
  }

  const cookies = parseCookies(request.headers.get("Cookie") || "");
  const payload = await verifyToken(cookies[ADMIN_COOKIE_NAME], config.secret);
  if (!payload?.admin) {
    return { ok: false, status: 401, error: "请先登录管理员账号。" };
  }

  return { ok: true, user: { username: payload.username || "" }, config };
}
