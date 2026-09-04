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

let wss = { clients: new Set() };

function broadcastJson(payload) {
  const text = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === 1 && client.authed) client.send(text);
  });
}

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

function requireLoggedIn(req, res, next) {
  const session = readSession(req);
  if (!session) {
    return res.status(401).json({ error: "未登录" });
  }
  req.session = session;
  return next();
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

function broadcastConfig() {
  broadcastJson({ type: "config", slots: publicSlots() });
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

const YAHOO_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const YAHOO_MAP = {
  SPX: "^GSPC",
  NDX: "^IXIC",
  DJI: "^DJI",
  NVDA: "NVDA",
  TSLA: "TSLA",
  VIX: "^VIX",
  XAU: "GC=F",
  WTI: "CL=F",
  XAG: "SI=F",
  US10Y: "^TNX",
  US2Y: "^IRX",
  US30Y: "^TYX",
  DXY: "DX-Y.NYB",
};
let quoteCache = { at: 0, quotes: {} };
let newsCache = { at: 0, items: [] };
let fngCache = { at: 0, value: 0, label: "" };

async function fetchYahooChart(ysym) {
  const { data } = await axios.get(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ysym)}`, {
    params: { interval: "5m", range: "1d", includePrePost: "false" },
    timeout: 8000,
    headers: { "User-Agent": YAHOO_UA, Accept: "application/json" },
  });
  const result = data?.chart?.result?.[0];
  if (!result) return null;
  const meta = result.meta || {};
  const px = Number(meta.regularMarketPrice);
  const prev = Number(meta.chartPreviousClose || meta.previousClose);
  const chg = prev > 0 && px > 0 ? ((px - prev) / prev) * 100 : 0;
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const bars = [];
  for (let i = 0; i < ts.length; i += 1) {
    const c = Number(q.close?.[i]);
    if (!(c > 0)) continue;
    const o = Number(q.open?.[i]) || c;
    const h = Number(q.high?.[i]) || c;
    const l = Number(q.low?.[i]) || c;
    bars.push({ t: ts[i], o, h, l, c });
  }
  return { px, prev, chg, bars: bars.slice(-80) };
}

function decodeXmlText(raw) {
  let s = String(raw || "");
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1");
  s = s.replace(/<[^>]+>/g, "");
  s = s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
  return s.replace(/\s+/g, " ").trim();
}

function splitPublisher(title, fallback) {
  const m = String(title || "").match(/^(.*)\s[-–—]\s+(.{2,48})$/);
  if (m && m[1].trim().length > 16) {
    return { title: m[1].trim(), source: m[2].trim() };
  }
  return { title: String(title || "").trim(), source: fallback };
}

function parseRssItems(xml, source) {
  const items = [];
  const text = String(xml || "");
  const blocks = text.match(/<item[\s\S]*?<\/item>/gi) || text.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  for (const block of blocks) {
    if (items.length >= 16) break;
    const rawTitle =
      (block.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i) ||
        block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ||
        [])[1] || "";
    const decoded = decodeXmlText(rawTitle);
    if (!decoded) continue;
    const split = splitPublisher(decoded, source);
    const linkRaw =
      (block.match(/<link[^>]*href=["']([^"']+)["']/i) ||
        block.match(/<link>([\s\S]*?)<\/link>/i) ||
        block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i) ||
        [])[1] || "";
    const url = decodeXmlText(linkRaw);
    const date =
      (block.match(/<pubDate>([\s\S]*?)<\/pubDate>/i) ||
        block.match(/<published>([\s\S]*?)<\/published>/i) ||
        block.match(/<updated>([\s\S]*?)<\/updated>/i) ||
        block.match(/<dc:date>([\s\S]*?)<\/dc:date>/i) ||
        [])[1] || "";
    items.push({
      title: split.title,
      source: split.source || source,
      date: decodeXmlText(date),
      url,
    });
  }
  return items;
}

const NEWS_FEEDS = [
  { url: "https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en", source: "Google" },
  { url: "https://news.google.com/rss/search?q=Federal+Reserve+OR+FOMC+OR+%22interest+rate%22&hl=en-US&gl=US&ceid=US:en", source: "Fed" },
  { url: "https://news.google.com/rss/search?q=bitcoin+OR+ethereum+OR+crypto+when:1d&hl=en-US&gl=US&ceid=US:en", source: "Crypto" },
  { url: "https://news.google.com/rss/search?q=oil+OR+gold+OR+WTI+OR+crude&hl=en-US&gl=US&ceid=US:en", source: "Macro" },
  { url: "https://www.coindesk.com/arc/outboundfeeds/rss/", source: "CoinDesk" },
  { url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", source: "CNBC" },
  { url: "https://cointelegraph.com/rss", source: "Cointelegraph" },
];

async function refreshNewsCache(force) {
  if (!force && Date.now() - newsCache.at < 25000 && newsCache.items.length) {
    return newsCache.items;
  }
  const bag = [];
  await Promise.all(
    NEWS_FEEDS.map(async (feed) => {
      try {
        const { data } = await axios.get(feed.url, {
          timeout: 9000,
          headers: { "User-Agent": YAHOO_UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
          responseType: "text",
        });
        bag.push(...parseRssItems(data, feed.source));
      } catch (_err) {}
    })
  );
  const seen = new Set();
  const merged = [];
  for (const row of bag) {
    const key = String(row.title || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .slice(0, 90);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const ts = Date.parse(row.date);
    merged.push({ ...row, ts: Number.isFinite(ts) ? ts : 0 });
  }
  merged.sort((a, b) => b.ts - a.ts);
  const items = merged.slice(0, 30).map(({ ts, ...rest }) => rest);
  if (items.length) newsCache = { at: Date.now(), items };
  return newsCache.items;
}

app.get("/api/market/quotes", async (_req, res) => {
  if (Date.now() - quoteCache.at < 12000 && quoteCache.quotes && Object.keys(quoteCache.quotes).length) {
    return res.json({ ok: true, cached: true, quotes: quoteCache.quotes });
  }
  const quotes = {};
  await Promise.all(
    Object.entries(YAHOO_MAP).map(async ([key, ysym]) => {
      try {
        quotes[key] = await fetchYahooChart(ysym);
      } catch (_err) {
        quotes[key] = null;
      }
    })
  );
  quoteCache = { at: Date.now(), quotes };
  res.json({ ok: true, quotes });
});

app.get("/api/market/fng", async (_req, res) => {
  if (Date.now() - fngCache.at < 60000 && fngCache.value > 0) {
    return res.json({ ok: true, cached: true, value: fngCache.value, label: fngCache.label });
  }
  try {
    const { data } = await axios.get("https://api.alternative.me/fng/", { timeout: 6000 });
    const row = (data && data.data && data.data[0]) || {};
    fngCache = { at: Date.now(), value: Number(row.value) || 0, label: String(row.value_classification || "") };
    res.json({ ok: true, value: fngCache.value, label: fngCache.label });
  } catch (_err) {
    res.json({ ok: false, value: fngCache.value, label: fngCache.label });
  }
});

app.get("/api/market/news", async (_req, res) => {
  const items = await refreshNewsCache(false);
  res.json({ ok: true, items: items || [] });
});

app.get("/api/market/depth", async (_req, res) => {
  try {
    const { data } = await axios.get("https://api.binance.com/api/v3/depth", {
      params: { symbol: "BTCUSDT", limit: 10 },
      timeout: 5000,
    });
    res.json({ ok: true, bids: data.bids || [], asks: data.asks || [] });
  } catch (_err) {
    res.json({ ok: false, bids: [], asks: [] });
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
    refreshNewsCache(true).catch(() => {});
    setInterval(() => {
      refreshNewsCache(true).catch(() => {});
    }, 40000);
  });
}

module.exports = app;
