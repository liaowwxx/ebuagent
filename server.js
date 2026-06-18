import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createRecommendationStream,
  modelConfigFromEnv,
  sseHeaders
} from "./src/recommendation-core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await loadLocalEnv(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 4173);
const PUBLIC_DIR = path.join(__dirname, "public");
const QR_SOURCE_DIR = path.join(__dirname, "mini_qrcode_export");
const PRODUCTS_PATH = path.join(PUBLIC_DIR, "data", "products.json");
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

async function handleRecommendStream(req, res) {
  try {
    const { message } = await readBody(req);
    if (!String(message || "").trim()) {
      sendJson(res, 400, { error: "请输入你的需求。" });
      return;
    }

    res.writeHead(200, sseHeaders());
    const stream = await createRecommendationStream({
      message,
      products,
      config: modelConfigFromEnv(process.env)
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

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "POST" && url.pathname === "/api/recommend/stream") {
    await handleRecommendStream(req, res);
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
