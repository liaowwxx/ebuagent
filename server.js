import { createServer } from "node:http";
import { appendFile, mkdir, readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createRecommendationStream,
  modelConfigFromEnv,
  sseHeaders
} from "./src/recommendation-core.js";
import { createRateLimiter } from "./src/rate-limiter.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await loadLocalEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, "public");
const QR_SOURCE_DIR = path.join(__dirname, "mini_qrcode_export");
const PRODUCTS_PATH = path.join(PUBLIC_DIR, "data", "products.json");
const LOG_DIR = path.join(__dirname, "logs");
const CHAT_LOG_PATH = path.join(LOG_DIR, "chat-conversations.jsonl");
const products = JSON.parse(await readFile(PRODUCTS_PATH, "utf8"));

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

async function loadLocalEnv(filePath) {
  let text = "";
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (!key || process.env[key] !== undefined) continue;
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

async function readBody(req) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1024 * 32) {
      throw new Error("Request body is too large.");
    }
  }
  return body ? JSON.parse(body) : {};
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

async function pipeWebStreamToNode(webStream, res) {
  const reader = webStream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}

function requestClientContext(req) {
  return {
    ip:
      req.headers["cf-connecting-ip"] ||
      req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown",
    userAgent: req.headers["user-agent"] || "",
    referer: req.headers.referer || ""
  };
}

async function appendChatLog(entry) {
  await mkdir(LOG_DIR, { recursive: true });
  await appendFile(CHAT_LOG_PATH, `${JSON.stringify(entry)}\n`, "utf8");
}

async function handleRecommendStream(req, res, user = null) {
  try {
    const { message, sessionId } = await readBody(req);
    if (!String(message || "").trim()) {
      sendJson(res, 400, { error: "请输入你的需求。" });
      return;
    }

    res.writeHead(200, sseHeaders());
    const stream = await createRecommendationStream({
      message,
      products,
      config: modelConfigFromEnv(process.env),
      logContext: {
        requestId: crypto.randomUUID(),
        sessionId: String(sessionId || "").trim().slice(0, 80) || "unknown",
        user,
        client: requestClientContext(req)
      },
      onLog: appendChatLog
    });
    await pipeWebStreamToNode(stream, res);
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, 500, { error: error.message || "推荐服务暂时不可用。" });
      return;
    }
    res.end();
  }
}

function safeResolve(baseDir, requestPath) {
  const decoded = decodeURIComponent(requestPath);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(baseDir, normalized);
  if (!filePath.startsWith(baseDir)) return null;
  return filePath;
}

async function serveFile(req, res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes[ext] || "application/octet-stream";
  let fileStat;
  try {
    fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error("Not a file");
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const stream = createReadStream(filePath);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    }
    res.end("Not found");
  });

  res.writeHead(200, {
    "content-type": contentType,
    "content-length": fileStat.size,
    "cache-control": [".html", ".css", ".js", ".json"].includes(ext)
      ? "no-cache"
      : "public, max-age=3600"
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  stream.pipe(res);
}

// ---- Auth (Node.js) --------------------------------------------------------

const COOKIE_NAME = "auth_token";
const AUTH_ENABLED = !!(process.env.AUTH_USERNAME && process.env.AUTH_PASSWORD);

function parseCookieHeader(header) {
  const map = {};
  if (!header) return map;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const name = part.slice(0, idx).trim();
    const value = decodeURIComponent(part.slice(idx + 1).trim());
    if (name) map[name] = value;
  }
  return map;
}

function signTokenNode(payload, secret) {
  const data = JSON.stringify(payload);
  const sig = crypto.createHmac("sha256", secret).update(data).digest("hex");
  return Buffer.from(data).toString("base64") + "." + sig;
}

function verifyTokenNode(token, secret) {
  if (!token || !secret) return null;
  try {
    const dot = token.lastIndexOf(".");
    if (dot === -1) return null;
    const b64 = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const data = Buffer.from(b64, "base64").toString("utf8");
    const expected = crypto.createHmac("sha256", secret).update(data).digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(data);
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

const loginLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 60_000 });

function setCookieHeader(token) {
  const maxAge = 7 * 24 * 60 * 60;
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}

async function handleLogin(req, res) {
  const clientIp =
    req.headers["cf-connecting-ip"] ||
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "unknown";

  const limit = loginLimiter.check(clientIp);
  if (!limit.allowed) {
    res.writeHead(429, {
      "content-type": "application/json; charset=utf-8",
      "retry-after": String(limit.retryAfter)
    });
    res.end(
      JSON.stringify({
        error: `尝试次数过多，请 ${limit.retryAfter} 秒后再试。`
      })
    );
    return;
  }

  const { username, password } = await readBody(req);
  if (!username || !password) {
    sendJson(res, 400, { error: "请输入账号和密码。" });
    return;
  }
  if (username !== process.env.AUTH_USERNAME || password !== process.env.AUTH_PASSWORD) {
    sendJson(res, 401, { error: "账号或密码错误。" });
    return;
  }

  const token = signTokenNode(
    { username, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 },
    process.env.AUTH_SECRET
  );
  res.writeHead(200, {
    "content-type": "application/json; charset=utf-8",
    "set-cookie": setCookieHeader(token)
  });
  res.end(JSON.stringify({ ok: true }));
}

function handleCheck(req, res) {
  const cookies = parseCookieHeader(req.headers.cookie);
  const payload = verifyTokenNode(cookies[COOKIE_NAME], process.env.AUTH_SECRET);
  if (!payload) {
    sendJson(res, 401, { authenticated: false });
    return;
  }
  sendJson(res, 200, { authenticated: true, username: payload.username });
}

function getAuthPayload(req) {
  if (!AUTH_ENABLED) return null;
  const cookies = parseCookieHeader(req.headers.cookie);
  return verifyTokenNode(cookies[COOKIE_NAME], process.env.AUTH_SECRET);
}

function authGuard(req, res) {
  if (!AUTH_ENABLED) return true;
  if (!getAuthPayload(req)) {
    sendJson(res, 401, { error: "请先登录。" });
    return false;
  }
  return true;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  // Auth endpoints
  if (AUTH_ENABLED) {
    if (req.method === "POST" && url.pathname === "/api/login") {
      await handleLogin(req, res);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/check") {
      handleCheck(req, res);
      return;
    }
  }

  if (req.method === "POST" && url.pathname === "/api/recommend/stream") {
    if (!authGuard(req, res)) return;
    const payload = getAuthPayload(req);
    await handleRecommendStream(req, res, payload ? { username: payload.username || "" } : null);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    res.end("Method not allowed");
    return;
  }

  if (url.pathname.startsWith("/mini_qrcode_export/")) {
    const relative = url.pathname.replace("/mini_qrcode_export/", "");
    const localPublicFile = safeResolve(path.join(PUBLIC_DIR, "mini_qrcode_export"), relative);
    const sourceFile = safeResolve(QR_SOURCE_DIR, relative);
    await serveFile(req, res, localPublicFile || sourceFile);
    return;
  }

  const requestPath = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const filePath = safeResolve(PUBLIC_DIR, requestPath);
  if (!filePath) {
    res.writeHead(400);
    res.end("Bad request");
    return;
  }
  await serveFile(req, res, filePath);
});

server.listen(PORT, () => {
  console.log(`Shop agent is running at http://localhost:${PORT}`);
});
