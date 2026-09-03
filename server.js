require("dotenv").config();

const fs = require("fs");
const http = require("http");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-session-secret";
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_FILE = path.join(__dirname, "data.json");
const COOKIE_NAME = "wall_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const DEFAULT_SLOTS = [
  { id: 1, name: "NEEKO Bot #1", symbol: "BTCUSDT", interval: "1m", strategy: "TTM趋势识别", leverage: 8, initialBalance: 582142.85, side: "LONG", positionRatio: 0.56, exposure: 0.082 },
  { id: 2, name: "NEEKO Bot #2", symbol: "ETHUSDT", interval: "5m", strategy: "DQCNN风控降仓", leverage: 7, initialBalance: 829570.4, side: "SHORT", positionRatio: 0.44, exposure: 0.068 },
  { id: 3, name: "NEEKO Bot #3", symbol: "BNBUSDT", interval: "15m", strategy: "流动性吸收", leverage: 6, initialBalance: 1248880.18, side: "LONG", positionRatio: 0.41, exposure: 0.091 },
  { id: 4, name: "NEEKO Bot #4", symbol: "SOLUSDT", interval: "1h", strategy: "ATR波动率避险", leverage: 8, initialBalance: 612390.92, side: "LONG", positionRatio: 0.38, exposure: 0.075 },
  { id: 5, name: "NEEKO Bot #5", symbol: "XRPUSDT", interval: "15m", strategy: "Rekblock反转", leverage: 9, initialBalance: 1582104.35, side: "SHORT", positionRatio: 0.36, exposure: 0.086 },
  { id: 6, name: "NEEKO Bot #6", symbol: "DOGEUSDT", interval: "3m", strategy: "动态高频套利", leverage: 8, initialBalance: 739205.6, side: "LONG", positionRatio: 0.18, exposure: 0.059 },
  { id: 7, name: "NEEKO Bot #7", symbol: "ADAUSDT", interval: "1h", strategy: "时空分型突破", leverage: 7, initialBalance: 918412.05, side: "SHORT", positionRatio: 0.4, exposure: 0.078 },
  { id: 8, name: "NEEKO Bot #8", symbol: "BTCUSDT", interval: "5m", strategy: "极低风险网格", leverage: 5, initialBalance: 1352180.7, side: "LONG", positionRatio: 0.32, exposure: 0.053 },
  { id: 9, name: "NEEKO Bot #9", symbol: "ETHUSDT", interval: "15m", strategy: "TTM拐点捕捉", leverage: 7, initialBalance: 528809.25, side: "LONG", positionRatio: 0.46, exposure: 0.088 },
  { id: 10, name: "NEEKO Bot #10", symbol: "SOLUSDT", interval: "3m", strategy: "高频流动性吃单", leverage: 9, initialBalance: 864450.88, side: "SHORT", positionRatio: 0.34, exposure: 0.094 },
  { id: 11, name: "NEEKO Bot #11", symbol: "BNBUSDT", interval: "1h", strategy: "观察期避险", leverage: 6, initialBalance: 1125129.42, side: "LONG", positionRatio: 0.28, exposure: 0.061 },
  { id: 12, name: "NEEKO Bot #12", symbol: "BTCUSDT", interval: "15m", strategy: "趋势追踪", leverage: 8, initialBalance: 1480415.1, side: "LONG", positionRatio: 0.48, exposure: 0.08 },
];

function nicoTag(n) {
  return `nico${String(n).padStart(2, "0")}`;
}

function buildViewers() {
  const viewers = [];
  for (let i = 1; i <= 50; i += 1) {
    viewers.push({ username: nicoTag(i), password: nicoTag(51 - i) });
  }
  return viewers;
}

function defaultStore() {
  return {
    auth: { username: "admin", password: "123456" },
    viewers: buildViewers(),
    slots: DEFAULT_SLOTS.map((slot) => ({ ...slot })),
  };
}

function normalizeSlot(slot, fallback) {
  const leverage = Number(slot.leverage);
  const initialBalance = Number(slot.initialBalance);
  const positionRatio = Number(slot.positionRatio);
  const rawSide = String(slot.side || fallback.side || "LONG").toUpperCase();
  return {
    id: fallback.id,
    name: String(slot.name || fallback.name || `NEEKO Bot #${fallback.id}`),
    symbol: String(slot.symbol || fallback.symbol || "BTCUSDT").trim().toUpperCase(),
    leverage: Number.isFinite(leverage) && leverage > 0 ? leverage : Number(fallback.leverage) || 8,
    initialBalance:
      Number.isFinite(initialBalance) && initialBalance >= 500000
        ? initialBalance
        : Math.max(500000, Number(fallback.initialBalance) || 500000),
    side: rawSide === "SHORT" ? "SHORT" : "LONG",
    positionRatio:
      Number.isFinite(positionRatio) && positionRatio > 0
        ? Math.min(positionRatio, 1)
        : Number(fallback.positionRatio) || 0.4,
  };
}

function loadStore() {
  const fallback = defaultStore();
  try {
    const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    return {
      auth: {
        username: String(raw.auth?.username || fallback.auth.username),
        password: String(raw.auth?.password || fallback.auth.password),
      },
      viewers: buildViewers(),
      slots: fallback.slots.map((slot) => {
        const saved = (raw.slots || []).find((item) => Number(item.id) === slot.id) || {};
        return normalizeSlot(saved, slot);
      }),
    };
  } catch (_err) {
    return fallback;
  }
}

function saveStore() {
  store.viewers = buildViewers();
  if (process.env.VERCEL) return;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
  } catch (_err) {}
}

function verifyWallLogin(username, password) {
  const id = String(username || "").trim();
  const pass = String(password || "");
  if (!id || !pass) return null;
  const legacyUser = String(store.auth?.username || "");
  const legacyPass = String(store.auth?.password || "");
  if (legacyUser && safeEqual(id, legacyUser) && safeEqual(pass, legacyPass)) {
    return { id: legacyUser, kind: "legacy" };
  }
  const lower = id.toLowerCase();
  const match = /^nico(0[1-9]|[1-4][0-9]|50)$/.exec(lower);
  if (!match) return null;
  const n = Number(match[1]);
  const expectedUser = nicoTag(n);
  const expectedPass = nicoTag(51 - n);
  if (!safeEqual(lower, expectedUser) || !safeEqual(pass.toLowerCase(), expectedPass)) {
    return null;
  }
  return { id: expectedUser, kind: "viewer" };
}

const store = loadStore();
saveStore();

function parseCookies(req) {
  const header = req.headers.cookie || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch (_err) {
      out[key] = value;
    }
  }
  return out;
}

function signPayload(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function readSession(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token) return null;
  const [body, sig] = String(token).split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (_err) {
    return null;
  }
}

function requestIsHttps(req) {
  const xf = String(req.headers["x-forwarded-proto"] || "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  return Boolean(req.secure) || xf === "https";
}

function setSessionCookie(res, payload, req) {
  const token = signPayload({ ...payload, exp: Date.now() + SESSION_TTL_MS });
  const secure = requestIsHttps(req) ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax${secure}; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  );
}

function clearSessionCookie(res, req) {
  const secure = req && requestIsHttps(req) ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax${secure}; Max-Age=0`);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function requireRole(role) {
  return (req, res, next) => {
    const session = readSession(req);
    if (!session || session.role !== role) {
      return res.status(401).json({ error: "未登录或权限不足" });
    }
    req.session = session;
    return next();
  };
}

function publicSlots() {
  const MAJORS = new Set(["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT", "XRPUSDT", "DOGEUSDT", "ADAUSDT"]);
  return store.slots.map((slot, i) => {
    const fallback = DEFAULT_SLOTS[i] || DEFAULT_SLOTS[0];
    const symbol = MAJORS.has(String(slot.symbol || "").toUpperCase())
      ? String(slot.symbol).toUpperCase()
      : fallback.symbol;
    const balance = Number(slot.initialBalance);
    return {
      id: fallback.id,
      name: slot.name || fallback.name,
      symbol,
      interval: fallback.interval || "15m",
      strategy: fallback.strategy || "TTM趋势识别",
      leverage: slot.leverage || fallback.leverage,
      initialBalance: Number.isFinite(balance) && balance >= 500000 ? balance : Math.max(500000, Number(fallback.initialBalance) || 500000),
      side: slot.side || fallback.side,
      exposure: Math.min(0.095, Math.max(0.05, Number(fallback.exposure) || 0.07)),
    };
  });
}

let wss = { clients: new Set() };

function broadcastConfig() {
  const text = JSON.stringify({ type: "config", slots: publicSlots() });
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.authed) client.send(text);
  });
}

const app = express();
app.set("trust proxy", true);
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get(["/", "/index.html"], (_req, res) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

app.get("/login.html", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "login.html"));
});

app.get("/admin.html", (req, res) => {
  const session = readSession(req);
  if (session?.role === "customer") {
    return res.redirect("/");
  }
  res.sendFile(path.join(PUBLIC_DIR, "admin.html"));
});

app.use(express.static(PUBLIC_DIR, { index: false }));

app.post("/api/auth/login", (req, res) => {
  const username = String(req.body?.id || req.body?.username || "").trim() || "guest";
  setSessionCookie(res, { role: "customer", id: username, kind: "guest" }, req);
  res.json({ ok: true, role: "customer", id: username });
});

app.post("/api/auth/logout", (req, res) => {
  clearSessionCookie(res, req);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  const session = readSession(req);
  if (!session) return res.status(401).json({ error: "未登录" });
  res.json({ ok: true, role: session.role, id: session.id || "admin" });
});

app.get("/api/boot", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, slots: publicSlots() });
});

app.get("/api/fallback", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ ok: true, slots: publicSlots(), source: "fallback" });
});

app.get("/api/wall", (req, res) => {
  const session = readSession(req);
  if (!session || session.role !== "customer") {
    return res.json({ slots: publicSlots(), guest: true });
  }
  res.json({ slots: publicSlots() });
});

app.get("/api/marks", async (_req, res) => {
  try {
    const { data } = await axios.get("https://fapi.binance.com/fapi/v1/premiumIndex", { timeout: 2500 });
    const marks = {};
    for (const row of data || []) {
      if (row.symbol && row.markPrice) marks[row.symbol] = Number(row.markPrice);
    }
    res.json({ marks });
  } catch (_err) {
    res.json({ marks: {} });
  }
});

const KLINE_INTERVALS = new Set(["1m", "3m", "5m", "15m", "30m", "1h", "4h", "1w"]);

app.get("/api/klines", async (req, res) => {
  const symbol = String(req.query.symbol || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 20);
  const interval = String(req.query.interval || "1m");
  const limit = Math.min(200, Math.max(20, Number(req.query.limit) || 52));
  if (!symbol || !KLINE_INTERVALS.has(interval)) {
    return res.status(400).json({ error: "无效的交易对或周期", klines: [] });
  }
  try {
    const { data } = await axios.get("https://api.binance.com/api/v3/klines", {
      params: { symbol, interval, limit },
      timeout: 8000,
    });
    res.json({ klines: data || [], symbol, interval });
  } catch (_spotErr) {
    try {
      const { data } = await axios.get("https://fapi.binance.com/fapi/v1/klines", {
        params: { symbol, interval, limit },
        timeout: 8000,
      });
      res.json({ klines: data || [], symbol, interval });
    } catch (_err) {
      res.json({ klines: [], symbol, interval });
    }
  }
});

app.post("/api/admin/login", (req, res) => {
  const session = readSession(req);
  if (session?.role === "customer") {
    return res.status(403).json({ error: "只读账号无法访问管理后台" });
  }
  const password = String(req.body?.password || "");
  if (!safeEqual(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: "管理员密码错误" });
  }
  setSessionCookie(res, { role: "admin", id: "admin" }, req);
  res.json({ ok: true, role: "admin" });
});

app.get("/api/admin/config", requireRole("admin"), (_req, res) => {
  res.json({
    auth: { username: store.auth.username },
    viewers: store.viewers.length,
    slots: publicSlots(),
  });
});

app.post("/api/admin/auth", requireRole("admin"), (req, res) => {
  const username = String(req.body?.username || "").trim();
  const password = String(req.body?.password || "");
  if (!username) return res.status(400).json({ error: "账号不能为空" });
  store.auth.username = username;
  if (password) store.auth.password = password;
  saveStore();
  res.json({ ok: true, auth: { username: store.auth.username } });
});

app.post("/api/admin/slots", requireRole("admin"), (req, res) => {
  const incoming = Array.isArray(req.body?.slots) ? req.body.slots : [];
  for (const item of incoming) {
    const slot = store.slots.find((row) => row.id === Number(item.id));
    if (!slot) continue;
    Object.assign(slot, normalizeSlot({ ...slot, ...item }, slot));
  }
  saveStore();
  broadcastConfig();
  res.json({ ok: true, slots: publicSlots() });
});

app.post("/api/admin/slots/reset", requireRole("admin"), (_req, res) => {
  store.slots = DEFAULT_SLOTS.map((slot) => ({ ...slot }));
  saveStore();
  broadcastConfig();
  res.json({ ok: true, slots: publicSlots() });
});

if (!process.env.VERCEL) {
  const server = http.createServer(app);
  wss = new WebSocketServer({ server, path: "/ws" });
  wss.on("connection", (socket, req) => {
    const session = readSession(req);
    if (!session || session.role !== "customer") {
      socket.close(1008, "unauthorized");
      return;
    }
    socket.authed = true;
    socket.send(JSON.stringify({ type: "config", slots: publicSlots() }));
  });
  server.listen(PORT, () => {
    console.log(`尼龙虾 NEEKO 智能交易 已启动 端口 ${PORT}`);
    console.log("本机预览请使用当前访问地址（http 自动走 http/ws，https 自动走 https/wss）");
    console.log("生产域名示例  https://neekoquant.com");
  });
}

module.exports = app;
