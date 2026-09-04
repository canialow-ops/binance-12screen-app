(function () {
  let analysisOn = false;
  let timer = 0;
  let newsTimer = 0;
  const assets = Object.create(null);
  const LIVE = new Set(["BTC", "ETH", "SOL", "BNB", "SPX", "NDX", "DJI", "NVDA", "TSLA", "VIX", "WTI", "XAU", "XAG", "US10Y", "US2Y", "US30Y", "DXY"]);
  let liveFear = false;
  let liveNews = false;
  let bookBids = [];
  let bookAsks = [];
  let binanceWs = null;
  let quoteTimer = 0;
  let fngTimer = 0;
  let realNewsTimer = 0;
  const CRYPTO_PAIR = { BTC: "BTCUSDT", ETH: "ETHUSDT", SOL: "SOLUSDT", BNB: "BNBUSDT" };

  function axApi(path) {
    return window.NEEKO_ORIGIN ? NEEKO_ORIGIN.apiUrl(path) : path;
  }
  let fear = 58;
  const rvi = { WTI: [], XAU: [], XAG: [] };
  const heatKeys = [
    ["US EQUITIES", 0.42], ["EU EQUITIES", 0.18], ["APAC", -0.11], ["EM FX", -0.07],
    ["USD CASH", 0.22], ["RATES", -0.16], ["COMMODITIES", 0.09], ["CRYPTO BETA", 0.31],
  ];
  const deliveries = [
    { code: "CLZ6", name: "WTI DEC", left: 18 * 86400 + 36112 },
    { code: "GCG6", name: "GOLD FEB", left: 42 * 86400 + 11880 },
    { code: "SIH6", name: "SILVER MAR", left: 67 * 86400 + 5400 },
    { code: "HGZ5", name: "COPPER", left: 9 * 86400 + 2200 },
    { code: "NGX5", name: "NATGAS", left: 4 * 86400 + 910 },
  ];
  const flowBuf = [];
  const pieEq = [0.46, 0.22, 0.18, 0.14];
  const pieCr = [0.41, 0.27, 0.19, 0.13];

  function seed(key, px, vol) {
    const bars = [];
    let p = px;
    const now = Math.floor(Date.now() / 1000);
    for (let i = 72; i >= 0; i -= 1) {
      const o = p;
      p = p * (1 + (Math.random() - 0.48) * vol);
      const h = Math.max(o, p) * (1 + Math.random() * vol * 0.4);
      const l = Math.min(o, p) * (1 - Math.random() * vol * 0.4);
      bars.push({ t: now - i * 60, o, h, l, c: p });
    }
    assets[key] = { px, prev: px, bars, vol };
  }

  function tickAsset(key) {
    const a = assets[key];
    if (!a) return;
    if (LIVE.has(key) && a.live) return;
    a.prev = a.px;
    a.px = Math.max(0.0001, a.px * (1 + (Math.random() - 0.49) * a.vol * 0.55));
    const last = a.bars[a.bars.length - 1];
    last.h = Math.max(last.h, a.px, last.o);
    last.l = Math.min(last.l, a.px, last.o);
    last.c = a.px;
    if (Math.random() < 0.12) {
      a.bars.push({ t: last.t + 60, o: a.px, h: a.px, l: a.px, c: a.px });
      if (a.bars.length > 90) a.bars.shift();
    }
  }

  function fmt(n, d) {
    const x = Number(n);
    if (!(x > 0) && x !== 0) return "—";
    return x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function chg(a) {
    if (a && Number.isFinite(a.chg24)) return a.chg24;
    return ((a.px - a.prev) / a.prev) * 100;
  }

  function applyLive(key, px, chg24, bars) {
    const a = assets[key];
    if (!a || !(Number(px) > 0)) return;
    a.live = true;
    a.prev = a.px;
    a.px = Number(px);
    if (Number.isFinite(chg24)) a.chg24 = chg24;
    if (Array.isArray(bars) && bars.length) {
      a.bars = bars.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c }));
    } else if (a.bars.length) {
      const last = a.bars[a.bars.length - 1];
      last.c = a.px;
      last.h = Math.max(last.h, a.px);
      last.l = Math.min(last.l, a.px);
    }
  }

  function upsertKline(key, bar, closed) {
    const a = assets[key];
    if (!a || !bar) return;
    a.live = true;
    const last = a.bars[a.bars.length - 1];
    if (!last || bar.t > last.t) {
      a.bars.push(bar);
      if (a.bars.length > 90) a.bars.shift();
    } else {
      last.o = bar.o;
      last.h = bar.h;
      last.l = bar.l;
      last.c = bar.c;
    }
    if (closed || true) {
      a.prev = a.px;
      a.px = bar.c;
    }
  }

  function drawCandles(canvas, bars) {
    if (!canvas || !bars.length) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.clientWidth || 120;
    const h = canvas.clientHeight || 28;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#050a12";
    ctx.fillRect(0, 0, w, h);
    let mn = Infinity;
    let mx = -Infinity;
    for (const b of bars) {
      mn = Math.min(mn, b.l);
      mx = Math.max(mx, b.h);
    }
    const pad = (mx - mn) * 0.04 || 0.0001;
    mn -= pad;
    mx += pad;
    const span = mx - mn || 1;
    const n = bars.length;
    const bw = Math.max(1, (w - 2) / n - 0.35);
    bars.forEach((b, i) => {
      const x = 1 + (i + 0.5) * ((w - 2) / n);
      const yO = ((mx - b.o) / span) * (h - 2) + 1;
      const yC = ((mx - b.c) / span) * (h - 2) + 1;
      const yH = ((mx - b.h) / span) * (h - 2) + 1;
      const yL = ((mx - b.l) / span) * (h - 2) + 1;
      const bull = b.c >= b.o;
      ctx.strokeStyle = bull ? "#34d399" : "#f43f5e";
      ctx.fillStyle = bull ? "#34d399" : "#f43f5e";
      ctx.beginPath();
      ctx.moveTo(x, yH);
      ctx.lineTo(x, yL);
      ctx.stroke();
      ctx.fillRect(x - bw / 2, Math.min(yO, yC), bw, Math.max(1, Math.abs(yC - yO)));
    });
  }

  function drawSpark(canvas, series, color) {
    if (!canvas || !series.length) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.clientWidth || 80;
    const h = canvas.clientHeight || 16;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#050a12";
    ctx.fillRect(0, 0, w, h);
    const mn = Math.min(...series);
    const mx = Math.max(...series);
    const span = mx - mn || 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    series.forEach((v, i) => {
      const x = (i / (series.length - 1)) * w;
      const y = h - ((v - mn) / span) * (h - 2) - 1;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function drawPie(canvas, parts, colors) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const s = canvas.width;
    ctx.clearRect(0, 0, s, s);
    const cx = s / 2;
    const cy = s / 2;
    const r = s * 0.42;
    let a = -Math.PI / 2;
    const sum = parts.reduce((x, y) => x + y, 0) || 1;
    parts.forEach((p, i) => {
      const slice = (p / sum) * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, a, a + slice);
      ctx.closePath();
      ctx.fillStyle = colors[i];
      ctx.fill();
      a += slice;
    });
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = "#050a12";
    ctx.fill();
  }

  function tileHtml(id, label) {
    return `<div class="ax-tile" data-ax="${id}">
      <div class="ax-sym">${label}</div>
      <div class="ax-px" data-px>—</div>
      <div class="ax-chg" data-chg>—</div>
      <canvas class="ax-cv" data-cv></canvas>
      <div class="ax-bar"><i></i></div>
    </div>`;
  }

  function paintTile(id, digits) {
    const root = document.querySelector(`[data-ax="${id}"]`);
    const a = assets[id];
    if (!root || !a) return;
    const px = root.querySelector("[data-px]");
    const cg = root.querySelector("[data-chg]");
    const cv = root.querySelector("[data-cv]");
    const d = chg(a);
    px.textContent = fmt(a.px, digits);
    px.classList.remove("tick");
    void px.offsetWidth;
    px.classList.add("tick");
    cg.textContent = `${d >= 0 ? "+" : ""}${d.toFixed(2)}%`;
    cg.className = "ax-chg " + (d >= 0 ? "up" : "down");
    drawCandles(cv, a.bars);
  }

  function syncCryptoFromBots() {
    ["BTC", "ETH", "SOL", "BNB"].forEach((k) => {
      const store = window.globalSymbolMap && window.globalSymbolMap[k];
      if (!store || !(Number(store.price) > 0) || !assets[k]) return;
      assets[k].prev = assets[k].px;
      assets[k].px = store.price;
      const last = assets[k].bars[assets[k].bars.length - 1];
      last.c = store.price;
      last.h = Math.max(last.h, store.price);
      last.l = Math.min(last.l, store.price);
    });
  }

  function renderBooks() {
    const box = document.getElementById("ax-books");
    if (!box) return;
    if (bookBids.length && bookAsks.length) {
      let html = `<div class="ax-sym">BTC L2 BOOK · BINANCE LIVE</div>`;
      const asks = bookAsks.slice(0, 8).reverse();
      asks.forEach((row) => {
        html += `<div class="ax-book-row" style="color:#fb7185"><span>${fmt(Number(row[0]), 1)}</span><span>${Number(row[1]).toFixed(3)}</span></div>`;
      });
      const mid = (Number(bookBids[0][0]) + Number(bookAsks[0][0])) / 2;
      html += `<div class="ax-book-row" style="color:#67e8f9;font-weight:700"><span>MID ${fmt(mid, 1)}</span><span>LIVE</span></div>`;
      bookBids.slice(0, 8).forEach((row) => {
        html += `<div class="ax-book-row" style="color:#4ade80"><span>${fmt(Number(row[0]), 1)}</span><span>${Number(row[1]).toFixed(3)}</span></div>`;
      });
      box.innerHTML = html;
      return;
    }
    if (!assets.BTC) return;
    const mid = assets.BTC.px;
    let html = `<div class="ax-sym">BTC L2 BOOK</div>`;
    for (let i = 5; i >= 1; i -= 1) {
      html += `<div class="ax-book-row" style="color:#fb7185"><span>${fmt(mid * (1 + i * 0.00028), 1)}</span><span>${(0.8 * i).toFixed(3)}</span></div>`;
    }
    html += `<div class="ax-book-row" style="color:#67e8f9;font-weight:700"><span>MID ${fmt(mid, 1)}</span><span>LIVE</span></div>`;
    for (let i = 1; i <= 5; i += 1) {
      html += `<div class="ax-book-row" style="color:#4ade80"><span>${fmt(mid * (1 - i * 0.00028), 1)}</span><span>${(0.7 * i).toFixed(3)}</span></div>`;
    }
    box.innerHTML = html;
  }

  function renderFear() {
    const el = document.getElementById("ax-fg");
    if (!el) return;
    if (!liveFear) fear = Math.max(8, Math.min(92, fear + (Math.random() - 0.48) * 1.8));
    const label = fear < 25 ? "EXT FEAR" : fear < 45 ? "FEAR" : fear < 55 ? "NEUTRAL" : fear < 75 ? "GREED" : "EXT GREED";
    const col = fear < 45 ? "#f43f5e" : fear > 55 ? "#34d399" : "#fbbf24";
    el.innerHTML = `<div class="ax-sym">FEAR &amp; GREED${liveFear ? " · LIVE" : ""}</div>
      <div class="ax-px" style="color:${col};font-size:16px">${fear.toFixed(0)}</div>
      <div class="ax-chg" style="color:${col}">${label}</div>
      <div class="ax-bar"><i style="width:${fear}%"></i></div>`;
  }

  function renderHeat() {
    const box = document.getElementById("ax-heat");
    if (!box) return;
    box.innerHTML = heatKeys.map((row) => {
      row[1] = Math.max(-0.55, Math.min(0.65, row[1] + (Math.random() - 0.5) * 0.05));
      const v = row[1];
      const bg = v >= 0
        ? `rgba(16,185,129,${0.2 + Math.min(0.6, v)})`
        : `rgba(244,63,94,${0.2 + Math.min(0.6, -v)})`;
      const c = v >= 0 ? "#6ee7b7" : "#fda4af";
      return `<div class="ax-cell" style="background:${bg}"><span class="ax-sym">${row[0]}</span>
        <span class="n" style="color:${c}">${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%</span></div>`;
    }).join("");
  }

  function renderRvi() {
    const box = document.getElementById("ax-cmd-rvi");
    if (!box) return;
    ["WTI", "XAU", "XAG"].forEach((k) => {
      const arr = rvi[k];
      arr.push(40 + Math.random() * 40);
      if (arr.length > 40) arr.shift();
    });
    box.innerHTML = ["WTI", "XAU", "XAG"].map((k) => {
      const last = rvi[k][rvi[k].length - 1];
      const vol = (assets[k].vol * 1000 + Math.random() * 2).toFixed(2);
      return `<div class="ax-chip">${k} RVI ${last.toFixed(1)} · VOL ${vol}
        <canvas class="ax-spark" data-spark="${k}"></canvas></div>`;
    }).join("");
    ["WTI", "XAU", "XAG"].forEach((k) => {
      const cv = box.querySelector(`[data-spark="${k}"]`);
      drawSpark(cv, rvi[k], k === "WTI" ? "#fbbf24" : k === "XAU" ? "#fde68a" : "#94a3b8");
    });
  }

  function renderDeliv() {
    const box = document.getElementById("ax-cmd-deliv");
    if (!box) return;
    box.innerHTML = deliveries.map((d) => {
      d.left = Math.max(0, d.left - 1);
      const dd = Math.floor(d.left / 86400);
      const hh = Math.floor((d.left % 86400) / 3600);
      const mm = Math.floor((d.left % 3600) / 60);
      const ss = Math.floor(d.left % 60);
      const pad = (n) => String(n).padStart(2, "0");
      return `<div class="ax-chip">${d.code} ${d.name}<b class="ax-px tick">${pad(dd)}d ${pad(hh)}:${pad(mm)}:${pad(ss)}</b></div>`;
    }).join("");
  }

  function renderFlows() {
    const names = [
      ["US", "SPX FUT"], ["US", "UST 10Y"], ["EU", "SX5E"], ["EU", "BUND"],
      ["CN", "CSI300"], ["CN", "CNH"], ["JP", "NKY"], ["JP", "JGB"],
    ];
    const pick = names[Math.floor(Math.random() * names.length)];
    const amt = (Math.random() * 1.8 + 0.1) * (Math.random() > 0.45 ? 1 : -1);
    flowBuf.unshift({ t: new Date().toISOString().slice(11, 19), c: pick[0], n: pick[1], a: amt });
    if (flowBuf.length > 14) flowBuf.pop();
    const box = document.getElementById("ax-flow-ticks");
    if (!box) return;
    box.innerHTML = `<div class="ax-sym" style="display:block;margin-bottom:2px">CROSS-BORDER TICKS · US/EU/CN/JP</div>` +
      flowBuf.map((r) => {
        const col = r.a >= 0 ? "#4ade80" : "#fb7185";
        const dir = r.a >= 0 ? "IN" : "OUT";
        return `<div class="${r.a >= 0 ? "flash-up" : "flash-down"}"><span>${r.t}</span><span>${r.c} ${r.n}</span>
          <span style="color:${col}">${dir} ${Math.abs(r.a).toFixed(2)}bn</span>
          <span style="color:${col}">${r.a >= 0 ? "▲" : "▼"} ${((Math.random() * 0.4) + 0.05).toFixed(2)}%</span></div>`;
      }).join("");
  }

  function renderPies() {
    for (let i = 0; i < pieEq.length; i += 1) pieEq[i] = Math.max(0.08, pieEq[i] + (Math.random() - 0.5) * 0.02);
    for (let i = 0; i < pieCr.length; i += 1) pieCr[i] = Math.max(0.08, pieCr[i] + (Math.random() - 0.5) * 0.02);
    drawPie(document.getElementById("ax-pie-eq"), pieEq, ["#22d3ee", "#34d399", "#fbbf24", "#64748b"]);
    drawPie(document.getElementById("ax-pie-cr"), pieCr, ["#f59e0b", "#a78bfa", "#22c55e", "#f43f5e"]);
    const eqLeg = document.getElementById("ax-pie-eq-leg");
    const crLeg = document.getElementById("ax-pie-cr-leg");
    if (eqLeg) {
      eqLeg.innerHTML = `<b style="color:#67e8f9">US EQ ALLOC</b><br>MEGA ${(pieEq[0] * 100).toFixed(0)}%<br>CYCLICAL ${(pieEq[1] * 100).toFixed(0)}%<br>DEFENSIVE ${(pieEq[2] * 100).toFixed(0)}%<br>CASH ${(pieEq[3] * 100).toFixed(0)}%`;
    }
    if (crLeg) {
      crLeg.innerHTML = `<b style="color:#fde68a">CRYPTO ALLOC</b><br>BTC ${(pieCr[0] * 100).toFixed(0)}%<br>ETH ${(pieCr[1] * 100).toFixed(0)}%<br>SOL ${(pieCr[2] * 100).toFixed(0)}%<br>ALTS ${(pieCr[3] * 100).toFixed(0)}%`;
    }
  }

  function junkLine() {
    const hex = () => Math.random().toString(16).slice(2, 8).toUpperCase();
    return `α=${(Math.random() * 2 - 1).toFixed(3)} β=${(Math.random() * 2).toFixed(3)} γ=${hex()} λ=${(Math.random() * 99).toFixed(2)} Θ=${hex()}  ∇P ${hex()}  RV ${hex()}`;
  }

  function renderNoise() {
    const box = document.getElementById("ax-noise");
    if (!box) return;
    let html = "";
    for (let i = 0; i < 18; i += 1) {
      html += `<b style="left:${Math.random() * 92}%;top:${Math.random() * 94}%;color:${Math.random() > 0.5 ? "rgba(52,211,153,0.35)" : "rgba(244,63,94,0.32)"}">${junkLine()}</b>`;
    }
    box.innerHTML = html;
    const cj = document.getElementById("ax-crypto-junk");
    if (cj) cj.textContent = junkLine() + "  " + junkLine();
  }

  function newsKind(title) {
    const t = String(title || "");
    const bear = /war|crash|ban|inflation|selloff|downgrade|recession|layoff|tumble|plunge/i.test(t);
    const bull = /rally|surge|beat|record|approval|jump|gain|ease|cut rates/i.test(t);
    if (bear && !bull) return "bear";
    if (bull && !bear) return "bull";
    return "neu";
  }

  function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function formatNewsTime(dateStr) {
    const dt = dateStr ? new Date(dateStr) : new Date();
    if (Number.isNaN(dt.getTime())) return "--:--:--";
    return dt.toLocaleTimeString("en-GB", { hour12: false });
  }

  function newsKey(it) {
    return String(it.url || "") + "|" + String(it.title || "").slice(0, 96);
  }

  let newsKeys = new Set();

  function renderNewsFeed(items) {
    const ul = document.getElementById("ax-news");
    if (!ul) return;
    const incoming = (items || []).slice(0, 24);
    const prev = newsKeys;
    const next = new Set();
    ul.innerHTML = "";
    incoming.forEach((it, idx) => {
      const k = newsKey(it);
      next.add(k);
      const t = String(it.title || "");
      const src = String(it.source || "WIRE").slice(0, 32);
      const url = String(it.url || "").trim();
      const kind = newsKind(t);
      const li = document.createElement("li");
      if (prev.size && !prev.has(k) && idx < 6) li.className = kind === "bear" ? "flash-down" : "flash-up";
      const live = url
        ? `<a class="ax-chg up ax-live" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">LIVE</a>`
        : `<span class="ax-chg up">LIVE</span>`;
      li.innerHTML = `<span class="ax-news-ts">${formatNewsTime(it.date)}</span>
        <span class="ax-news-hd" title="${escapeHtml(t)}">[${escapeHtml(src)}] ${escapeHtml(t)}</span>
        ${live}`;
      ul.appendChild(li);
    });
    newsKeys = next;
    ul.scrollTop = 0;
  }

  async function pollNews() {
    try {
      const res = await fetch(axApi("/api/market/news"));
      const json = await res.json();
      const items = json.items || [];
      if (!items.length) return;
      liveNews = true;
      renderNewsFeed(items);
    } catch (_err) {}
  }

  function layoutEq() {
    document.getElementById("ax-eq-body").innerHTML =
      `<div class="ax-row">${tileHtml("SPX", "S&P 500")}${tileHtml("NDX", "NASDAQ")}${tileHtml("DJI", "DOW")}</div>
       <div class="ax-row" style="grid-template-columns:1fr 1fr 1fr">${tileHtml("NVDA", "NVDA")}${tileHtml("TSLA", "TSLA")}${tileHtml("VIX", "VIX")}</div>
       <div class="ax-viz ax-eq-viz">
         <div class="ax-viz-cell"><div class="ax-sym">SECTOR MOMENTUM RADAR · 11 GICS</div><canvas id="ax-radar"></canvas></div>
         <div class="ax-viz-cell"><div class="ax-sym">SPX BREADTH · ADVANCE / DECLINE</div><canvas id="ax-breadth"></canvas></div>
       </div>`;
  }

  function layoutCmd() {
    document.getElementById("ax-cmd-row").innerHTML =
      tileHtml("WTI", "WTI CRUDE") + tileHtml("XAU", "GOLD XAU") + tileHtml("XAG", "SILVER XAG");
  }

  function layoutCrypto() {
    document.getElementById("ax-crypto-charts").innerHTML =
      `<div class="ax-row" style="grid-template-columns:1fr 1fr">${tileHtml("BTC", "BTC")}${tileHtml("ETH", "ETH")}${tileHtml("SOL", "SOL")}${tileHtml("BNB", "BNB")}</div>`;
  }

  function layoutMacro() {
    document.getElementById("ax-macro-body").innerHTML =
      `<div class="ax-row" style="grid-template-columns:1fr 1fr 1fr">
        ${tileHtml("US10Y", "US 10Y")}${tileHtml("DXY", "DXY")}${tileHtml("US2Y", "US 2Y")}
      </div>
      <div class="ax-row" style="grid-template-columns:1fr 1fr 1fr">
        ${tileHtml("US30Y", "US 30Y")}${tileHtml("FED", "FED FUNDS")}${tileHtml("MOVE", "MOVE IDX")}
      </div>
      <div class="ax-viz ax-macro-viz">
        <div class="ax-viz-cell"><div class="ax-sym">UST YIELD CURVE 2Y/5Y/10Y/30Y</div><canvas id="ax-curve"></canvas></div>
        <div class="ax-viz-cell"><div class="ax-sym">FED ECB BOJ PBOC · HIKE/CUT + BS</div><canvas id="ax-cbars"></canvas></div>
      </div>`;
  }

  const sectors = [0.72, 0.61, 0.44, 0.81, 0.33, 0.55, 0.28, 0.66, 0.49, 0.38, 0.58];
  const ivSurf = Array.from({ length: 6 }, () => Array.from({ length: 5 }, () => 20 + Math.random() * 40));
  let bdi = 1820;
  let inv = 432;
  let sentOn = 0.62;
  const funding = [0.012, 0.008, 0.021, 0.004];
  const liq = [1.2, 0.8, 2.1, 0.4, 1.6, 0.9];
  const chainA = [];
  const chainH = [];
  const yields = [3.91, 4.08, 4.29, 4.54];
  const cbHike = [0.22, 0.08, 0.41, 0.12];
  const cbCut = [0.61, 0.54, 0.18, 0.33];
  const xflow = [1.2, -0.4, 0.7, -0.9, 0.3, 0.5];
  const darkPts = [];

  function prepCanvas(id) {
    const cv = document.getElementById(id);
    if (!cv) return null;
    const host = cv.parentElement;
    const w = Math.max(48, (host.clientWidth || 120) - 4);
    const h = Math.max(58, (host.clientHeight || 80) - 12);
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.floor(w * dpr);
    cv.height = Math.floor(h * dpr);
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#050a12";
    ctx.fillRect(0, 0, w, h);
    ctx.font = "8px ui-monospace, Consolas, sans-serif";
    return { ctx, w, h };
  }

  function jitter(arr, mag, lo, hi) {
    for (let i = 0; i < arr.length; i += 1) {
      const v = arr[i] + (Math.random() - 0.5) * mag;
      arr[i] = Math.max(lo, Math.min(hi, v));
    }
  }

  function drawIvSurface() {
    const g = prepCanvas("ax-ivsurf");
    if (!g) return;
    const { ctx, w, h } = g;
    const rows = ivSurf.length;
    const cols = ivSurf[0].length;
    const bw = (w - 8) / cols;
    const bh = (h - 10) / rows;
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        ivSurf[r][c] = Math.max(12, Math.min(68, ivSurf[r][c] + (Math.random() - 0.5) * 2.2));
        const v = ivSurf[r][c];
        const t = (v - 12) / 56;
        ctx.fillStyle = `rgb(${Math.floor(40 + t * 200)},${Math.floor(180 - t * 90)},${Math.floor(80 + (1 - t) * 80)})`;
        const barH = bh * 0.82 * (0.35 + t);
        ctx.fillRect(4 + c * bw + 1, 8 + (r + 1) * bh - barH, bw - 3, barH);
      }
    }
    ctx.fillStyle = "#64748b";
    ctx.fillText("Δ 80 90 ATM 110 120", 4, 9);
  }

  function drawPcr() {
    const g = prepCanvas("ax-pcr");
    if (!g) return;
    const { ctx, w, h } = g;
    const names = ["WTI", "XAU", "XAG", "HG", "NG"];
    const gap = w / names.length;
    names.forEach((n, i) => {
      const put = 0.35 + Math.random() * 0.5;
      const call = 0.35 + Math.random() * 0.5;
      const x = 8 + i * gap;
      const mid = h * 0.55;
      ctx.fillStyle = "#f43f5e";
      ctx.fillRect(x, mid - put * (h * 0.4), 7, put * (h * 0.4));
      ctx.fillStyle = "#34d399";
      ctx.fillRect(x + 8, mid, 7, call * (h * 0.38));
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(n, x, h - 2);
    });
  }

  function drawBdi() {
    const g = prepCanvas("ax-bdi");
    if (!g) return;
    const { ctx, w, h } = g;
    bdi = Math.max(1400, Math.min(2400, bdi + (Math.random() - 0.48) * 28));
    inv = Math.max(350, Math.min(520, inv + (Math.random() - 0.5) * 4));
    const mid = w * 0.5;
    const b = ((bdi - 1400) / 1000) * (mid - 12);
    const iv = ((inv - 350) / 170) * (mid - 12);
    ctx.fillStyle = "#22d3ee";
    ctx.fillRect(mid - b, 10, b, 16);
    ctx.fillStyle = "#f59e0b";
    ctx.fillRect(mid, 10, iv, 16);
    ctx.fillStyle = "#64748b";
    ctx.fillText("BDI " + bdi.toFixed(0), 4, 22);
    ctx.fillText("INV " + inv.toFixed(1) + "mb", mid + 4, 22);
    ctx.fillStyle = "#334155";
    ctx.fillRect(mid, 8, 1, h - 14);
    ctx.fillStyle = "#4ade80";
    ctx.fillRect(8, 36, (bdi / 2400) * (w - 16), 10);
    ctx.fillStyle = "#fb7185";
    ctx.fillRect(8, 50, (inv / 520) * (w - 16), 10);
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("BALTIC DRY  vs  CRUDE STOCKS", 8, h - 4);
  }

  function drawRadar() {
    const g = prepCanvas("ax-radar");
    if (!g) return;
    const { ctx, w, h } = g;
    jitter(sectors, 0.06, 0.12, 0.98);
    const labels = ["XLK", "XLF", "XLE", "XLV", "XLY", "XLP", "XLI", "XLB", "XLRE", "XLU", "XLC"];
    const n = sectors.length;
    const cx = w * 0.42;
    const cy = h * 0.52;
    const R = Math.min(cx, cy) - 8;
    ctx.strokeStyle = "#1e293b";
    for (let ring = 1; ring <= 3; ring += 1) {
      ctx.beginPath();
      for (let i = 0; i <= n; i += 1) {
        const a = -Math.PI / 2 + (i % n) * (Math.PI * 2 / n);
        const r = R * (ring / 3);
        const x = cx + Math.cos(a) * r;
        const y = cy + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.fillStyle = "rgba(34,211,238,0.28)";
    ctx.strokeStyle = "#22d3ee";
    sectors.forEach((v, i) => {
      const a = -Math.PI / 2 + i * (Math.PI * 2 / n);
      const x = cx + Math.cos(a) * R * v;
      const y = cy + Math.sin(a) * R * v;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#94a3b8";
    labels.forEach((lb, i) => {
      const a = -Math.PI / 2 + i * (Math.PI * 2 / n);
      ctx.fillText(lb, cx + Math.cos(a) * (R + 6) - 8, cy + Math.sin(a) * (R + 6) + 3);
    });
  }

  function drawBreadth() {
    const g = prepCanvas("ax-breadth");
    if (!g) return;
    const { ctx, w, h } = g;
    const mid = h * 0.55;
    const n = 18;
    const bw = (w - 8) / n;
    for (let i = 0; i < n; i += 1) {
      const up = 20 + Math.random() * 80;
      const dn = 20 + Math.random() * 80;
      ctx.fillStyle = "#34d399";
      ctx.fillRect(4 + i * bw, mid - up * 0.35, bw - 1.5, up * 0.35);
      ctx.fillStyle = "#f43f5e";
      ctx.fillRect(4 + i * bw, mid, bw - 1.5, dn * 0.32);
    }
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText("ADV " + (280 + Math.floor(Math.random() * 120)) + " / DEC " + (160 + Math.floor(Math.random() * 140)), 4, 10);
  }

  function drawFedWatch() {
    const g = prepCanvas("ax-fedwatch");
    if (!g) return;
    const { ctx, w, h } = g;
    const rows = [
      ["HOLD 4.25-4.50", 0.18 + Math.random() * 0.08],
      ["CUT 25bp", 0.52 + Math.random() * 0.1],
      ["CUT 50bp", 0.16 + Math.random() * 0.08],
      ["HIKE 25bp", 0.06 + Math.random() * 0.05],
    ];
    const rowH = (h - 14) / rows.length;
    rows.forEach((r, i) => {
      const y = 12 + i * rowH;
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(4, y, w - 8, rowH - 4);
      const t = r[1];
      ctx.fillStyle = t > 0.4 ? "#34d399" : t > 0.15 ? "#fbbf24" : "#f43f5e";
      ctx.fillRect(4, y, (w - 8) * t, rowH - 4);
      ctx.fillStyle = "#e2e8f0";
      ctx.fillText(r[0] + "  " + (t * 100).toFixed(1) + "%", 8, y + 10);
    });
  }

  function drawSentiment() {
    const g = prepCanvas("ax-sentpolar");
    if (!g) return;
    const { ctx, w, h } = g;
    sentOn = Math.max(0.15, Math.min(0.88, sentOn + (Math.random() - 0.5) * 0.05));
    const cx = w * 0.5;
    const cy = h * 0.58;
    const R = Math.min(w, h) * 0.38;
    ctx.strokeStyle = "#1e293b";
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI, 2 * Math.PI);
    ctx.stroke();
    const a = Math.PI + sentOn * Math.PI;
    ctx.strokeStyle = sentOn > 0.5 ? "#34d399" : "#f43f5e";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI, a);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * (R - 4), cy + Math.sin(a) * (R - 4));
    ctx.strokeStyle = "#e2e8f0";
    ctx.stroke();
    ctx.fillStyle = sentOn > 0.5 ? "#6ee7b7" : "#fda4af";
    ctx.fillText(sentOn > 0.5 ? "RISK-ON" : "RISK-OFF", 6, 10);
    ctx.fillText((sentOn * 100).toFixed(0) + "  SENT", 6, 20);
  }

  function drawLiq() {
    const g = prepCanvas("ax-liq");
    if (!g) return;
    const { ctx, w, h } = g;
    const labs = ["1x", "5x", "10x", "25x", "50x", "100x"];
    jitter(liq, 0.15, 0.2, 3.2);
    const rowH = (h - 12) / labs.length;
    labs.forEach((lb, i) => {
      const y = 12 + i * rowH;
      const t = liq[i] / 3.2;
      ctx.fillStyle = `rgba(244,63,94,${0.25 + t * 0.7})`;
      ctx.fillRect(22, y, (w - 28) * t, rowH - 3);
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(lb, 2, y + 8);
    });
  }

  function drawFund() {
    const g = prepCanvas("ax-fund");
    if (!g) return;
    const { ctx, w, h } = g;
    jitter(funding, 0.004, -0.02, 0.04);
    const names = ["BTC", "ETH", "SOL", "BNB"];
    const mid = h * 0.55;
    const bw = (w - 10) / names.length;
    names.forEach((n, i) => {
      const v = funding[i];
      const bh = Math.abs(v) / 0.04 * (h * 0.4);
      ctx.fillStyle = v >= 0 ? "#34d399" : "#f43f5e";
      if (v >= 0) ctx.fillRect(6 + i * bw, mid - bh, bw - 6, bh);
      else ctx.fillRect(6 + i * bw, mid, bw - 6, bh);
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(n, 6 + i * bw, h - 3);
      ctx.fillText((v * 100).toFixed(3) + "%", 6 + i * bw, 10);
    });
  }

  function drawOnchain() {
    const g = prepCanvas("ax-onchain");
    if (!g) return;
    const { ctx, w, h } = g;
    chainA.push(0.5 + Math.random() * 0.5);
    chainH.push(0.4 + Math.random() * 0.55);
    if (chainA.length > 24) chainA.shift();
    if (chainH.length > 24) chainH.shift();
    const cx = w * 0.48;
    const cy = h * 0.55;
    const R = Math.min(w, h) * 0.36;
    const n = chainA.length;
    function polar(series, color) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      series.forEach((v, i) => {
        const a = -Math.PI / 2 + i * (Math.PI * 2 / Math.max(n, 1));
        const x = cx + Math.cos(a) * R * v;
        const y = cy + Math.sin(a) * R * v;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.stroke();
    }
    polar(chainA, "#22d3ee");
    polar(chainH, "#fbbf24");
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("ADDR CYAN · HASH AMBER", 4, 10);
  }

  function drawCurve() {
    const g = prepCanvas("ax-curve");
    if (!g) return;
    const { ctx, w, h } = g;
    yields[0] = Math.max(3.4, Math.min(4.4, yields[0] + (Math.random() - 0.5) * 0.02));
    yields[1] = Math.max(3.6, Math.min(4.6, yields[1] + (Math.random() - 0.5) * 0.02));
    yields[2] = Math.max(3.8, Math.min(4.8, yields[2] + (Math.random() - 0.5) * 0.02));
    yields[3] = Math.max(4.0, Math.min(5.0, yields[3] + (Math.random() - 0.5) * 0.02));
    const xs = [0.12, 0.36, 0.62, 0.88];
    const mn = 3.2;
    const mx = 5.1;
    ctx.strokeStyle = "#22d3ee";
    ctx.beginPath();
    xs.forEach((t, i) => {
      const x = t * w;
      const y = h - 10 - ((yields[i] - mn) / (mx - mn)) * (h - 20);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
      ctx.fillStyle = "#fde68a";
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.stroke();
    ctx.fillStyle = "#94a3b8";
    ["2Y", "5Y", "10Y", "30Y"].forEach((lb, i) => ctx.fillText(lb + " " + yields[i].toFixed(2), xs[i] * w - 10, h - 2));
  }

  function drawCbars() {
    const g = prepCanvas("ax-cbars");
    if (!g) return;
    const { ctx, w, h } = g;
    jitter(cbHike, 0.03, 0.04, 0.7);
    jitter(cbCut, 0.03, 0.08, 0.8);
    const names = ["FED", "ECB", "BOJ", "PBOC"];
    const bw = (w - 8) / names.length;
    names.forEach((n, i) => {
      const x = 6 + i * bw;
      ctx.fillStyle = "#f43f5e";
      ctx.fillRect(x, h - 12 - cbHike[i] * (h - 24), 7, cbHike[i] * (h - 24));
      ctx.fillStyle = "#34d399";
      ctx.fillRect(x + 9, h - 12 - cbCut[i] * (h - 24), 7, cbCut[i] * (h - 24));
      ctx.fillStyle = "#22d3ee";
      ctx.fillRect(x + 18, h - 12 - (0.3 + Math.random() * 0.5) * (h - 28), 5, (0.3 + Math.random() * 0.5) * (h - 28));
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(n, x, h - 2);
    });
    ctx.fillStyle = "#64748b";
    ctx.fillText("HIKE RED · CUT GRN · BS CYAN", 4, 10);
  }

  function drawXborder() {
    const g = prepCanvas("ax-xborder");
    if (!g) return;
    const { ctx, w, h } = g;
    jitter(xflow, 0.12, -1.6, 1.8);
    const names = ["US", "EU", "CN", "JP", "UK", "EM"];
    const mid = w * 0.42;
    const rowH = (h - 14) / names.length;
    names.forEach((n, i) => {
      const y = 12 + i * rowH;
      const v = xflow[i];
      const mag = Math.abs(v) / 1.8 * (mid - 8);
      ctx.fillStyle = v >= 0 ? "#34d399" : "#f43f5e";
      if (v >= 0) ctx.fillRect(mid, y, mag, rowH - 3);
      else ctx.fillRect(mid - mag, y, mag, rowH - 3);
      ctx.fillStyle = "#94a3b8";
      ctx.fillText(n, 3, y + 8);
    });
    ctx.fillStyle = "#334155";
    ctx.fillRect(mid, 8, 1, h - 12);
  }

  function drawHft() {
    const g = prepCanvas("ax-hft");
    if (!g) return;
    const { ctx, w, h } = g;
    if (darkPts.length > 40) darkPts.shift();
    darkPts.push({
      x: 0.1 + Math.random() * 0.8,
      y: 0.15 + Math.random() * 0.7,
      s: 2 + Math.random() * 5,
      c: Math.random() > 0.5,
    });
    darkPts.forEach((p) => {
      ctx.fillStyle = p.c ? "rgba(34,211,238,0.75)" : "rgba(251,191,36,0.75)";
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * (h - 16) + 8, p.s, 0, Math.PI * 2);
      ctx.fill();
    });
    const bars = [0.22, 0.31, 0.18, 0.41, 0.27, 0.36];
    bars.forEach((b, i) => {
      ctx.fillStyle = "rgba(244,63,94,0.45)";
      ctx.fillRect(4 + i * ((w - 8) / bars.length), h - 4 - b * 28, 8, b * 28);
    });
    ctx.fillStyle = "#94a3b8";
    ctx.fillText("DARK POOL CYAN · HFT AMBER · LIQ BARS", 4, 10);
  }

  function renderDenseViz() {
    drawIvSurface();
    drawPcr();
    drawBdi();
    drawRadar();
    drawBreadth();
    drawFedWatch();
    drawSentiment();
    drawLiq();
    drawFund();
    drawOnchain();
    drawCurve();
    drawCbars();
    drawXborder();
    drawHft();
  }

  function pulse() {
    if (!analysisOn) return;
    Object.keys(assets).forEach((k) => {
      if (LIVE.has(k) && assets[k].live) return;
      tickAsset(k);
    });
    if (!binanceWs) syncCryptoFromBots();
    paintTile("WTI", 2);
    paintTile("XAU", 1);
    paintTile("XAG", 3);
    paintTile("SPX", 2);
    paintTile("NDX", 2);
    paintTile("DJI", 2);
    paintTile("NVDA", 2);
    paintTile("TSLA", 2);
    paintTile("VIX", 2);
    paintTile("BTC", 1);
    paintTile("ETH", 2);
    paintTile("SOL", 2);
    paintTile("BNB", 2);
    paintTile("US10Y", 3);
    paintTile("DXY", 2);
    paintTile("US2Y", 3);
    paintTile("US30Y", 3);
    paintTile("FED", 3);
    paintTile("MOVE", 2);
    renderBooks();
    renderFear();
    renderHeat();
    renderRvi();
    renderDeliv();
    renderFlows();
    renderPies();
    renderNoise();
    renderDenseViz();
  }

  function pairToKey(sym) {
    const s = String(sym || "").toUpperCase();
    if (s.startsWith("BTC")) return "BTC";
    if (s.startsWith("ETH")) return "ETH";
    if (s.startsWith("SOL")) return "SOL";
    if (s.startsWith("BNB")) return "BNB";
    return "";
  }

  async function loadCryptoKlines() {
    await Promise.all(
      Object.entries(CRYPTO_PAIR).map(async ([key, pair]) => {
        try {
          const res = await fetch(axApi(`/api/klines?symbol=${pair}&interval=1m&limit=80`));
          const json = await res.json();
          const rows = json.klines || [];
          const bars = rows.map((row) => ({
            t: Math.floor(Number(row[0]) / 1000),
            o: Number(row[1]),
            h: Number(row[2]),
            l: Number(row[3]),
            c: Number(row[4]),
          })).filter((b) => b.c > 0);
          if (bars.length) applyLive(key, bars[bars.length - 1].c, assets[key].chg24, bars);
        } catch (_err) {}
      })
    );
  }

  function connectBinance() {
    if (binanceWs) return;
    const streams = [
      "btcusdt@ticker", "ethusdt@ticker", "solusdt@ticker", "bnbusdt@ticker",
      "btcusdt@depth20@100ms",
      "btcusdt@kline_1m", "ethusdt@kline_1m", "solusdt@kline_1m", "bnbusdt@kline_1m",
    ].join("/");
    try {
      const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
      binanceWs = ws;
      ws.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (_e) { return; }
        const payload = msg.data || msg;
        const stream = String(msg.stream || "");
        if (stream.indexOf("@ticker") !== -1 && payload.c) {
          const key = pairToKey(payload.s);
          if (key) applyLive(key, Number(payload.c), Number(payload.P));
        } else if (stream.indexOf("@kline") !== -1 && payload.k) {
          const k = payload.k;
          const key = pairToKey(k.s);
          if (!key) return;
          upsertKline(key, {
            t: Math.floor(Number(k.t) / 1000),
            o: Number(k.o),
            h: Number(k.h),
            l: Number(k.l),
            c: Number(k.c),
          }, k.x);
        } else if (stream.indexOf("depth") !== -1) {
          if (payload.bids) bookBids = payload.bids;
          if (payload.asks) bookAsks = payload.asks;
        }
      };
      ws.onclose = () => {
        if (binanceWs === ws) binanceWs = null;
        if (analysisOn) setTimeout(connectBinance, 2500);
      };
      ws.onerror = () => {};
    } catch (_err) {}
  }

  async function pollQuotes() {
    try {
      const res = await fetch(axApi("/api/market/quotes"));
      const json = await res.json();
      const quotes = json.quotes || {};
      Object.keys(quotes).forEach((key) => {
        const q = quotes[key];
        if (!q || !(q.px > 0)) return;
        applyLive(key, q.px, q.chg, q.bars);
      });
    } catch (_err) {}
  }

  async function pollFng() {
    try {
      const res = await fetch(axApi("/api/market/fng"));
      const json = await res.json();
      if (json && json.value > 0) {
        fear = json.value;
        liveFear = true;
      }
    } catch (_err) {}
  }

  async function pollDepthFallback() {
    if (bookBids.length) return;
    try {
      const res = await fetch(axApi("/api/market/depth"));
      const json = await res.json();
      if (json.bids && json.bids.length) {
        bookBids = json.bids;
        bookAsks = json.asks || [];
      }
    } catch (_err) {}
  }

  function startLiveFeeds() {
    loadCryptoKlines();
    connectBinance();
    pollQuotes();
    pollFng();
    pollNews();
    pollDepthFallback();
    if (!quoteTimer) quoteTimer = setInterval(pollQuotes, 15000);
    if (!fngTimer) fngTimer = setInterval(pollFng, 120000);
    if (!realNewsTimer) realNewsTimer = setInterval(pollNews, 40000);
  }

  function stopLiveFeeds() {
    if (binanceWs) {
      try { binanceWs.onclose = null; binanceWs.close(); } catch (_e) {}
      binanceWs = null;
    }
    if (quoteTimer) { clearInterval(quoteTimer); quoteTimer = 0; }
    if (fngTimer) { clearInterval(fngTimer); fngTimer = 0; }
    if (realNewsTimer) { clearInterval(realNewsTimer); realNewsTimer = 0; }
  }

  function openDesk() {
    if (analysisOn) return;
    analysisOn = true;
    window.__NEEKO_ANALYSIS_ON = true;
    document.body.classList.add("analysis-on");
    document.body.classList.remove("bsc-on");
    document.getElementById("analysis").setAttribute("aria-hidden", "false");
    const btn = document.getElementById("analysis-toggle");
    if (btn) {
      btn.classList.add("active", "is-on");
      btn.setAttribute("aria-pressed", "true");
      btn.textContent = "ANALYSIS";
    }
    const robots = document.getElementById("robots-toggle");
    if (robots) {
      robots.classList.remove("is-on");
      robots.setAttribute("aria-pressed", "false");
    }
    const bsc = document.getElementById("bsc-toggle");
    if (bsc) {
      bsc.classList.remove("is-on");
      bsc.setAttribute("aria-pressed", "false");
    }
    startLiveFeeds();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        pulse();
        if (!timer) timer = setInterval(pulse, 280);
      });
    });
  }

  function closeDesk() {
    if (!analysisOn) return;
    analysisOn = false;
    window.__NEEKO_ANALYSIS_ON = false;
    document.body.classList.remove("analysis-on");
    document.getElementById("analysis").setAttribute("aria-hidden", "true");
    const btn = document.getElementById("analysis-toggle");
    if (btn) {
      btn.classList.remove("active", "is-on");
      btn.setAttribute("aria-pressed", "false");
      btn.textContent = "ANALYSIS";
    }
    const robots = document.getElementById("robots-toggle");
    if (robots && !document.body.classList.contains("bsc-on")) {
      robots.classList.add("is-on");
      robots.setAttribute("aria-pressed", "true");
    }
    stopLiveFeeds();
    if (timer) { clearInterval(timer); timer = 0; }
    if (newsTimer) { clearInterval(newsTimer); newsTimer = 0; }
  }

  seed("WTI", 78.42, 0.004);
  seed("XAU", 2348.6, 0.0022);
  seed("XAG", 27.84, 0.0045);
  seed("SPX", 5624.18, 0.0018);
  seed("NDX", 19840.2, 0.0024);
  seed("DJI", 41128.5, 0.0016);
  seed("NVDA", 128.42, 0.006);
  seed("TSLA", 248.16, 0.007);
  seed("VIX", 16.84, 0.012);
  seed("BTC", 78000, 0.003);
  seed("ETH", 2410, 0.0035);
  seed("SOL", 101, 0.005);
  seed("BNB", 713, 0.003);
  seed("US10Y", 4.286, 0.0012);
  seed("DXY", 104.22, 0.001);
  seed("US2Y", 3.912, 0.0014);
  seed("US30Y", 4.541, 0.0011);
  seed("FED", 4.33, 0.0006);
  seed("MOVE", 98.4, 0.008);

  layoutCmd();
  layoutEq();
  layoutCrypto();
  layoutMacro();
  renderHeat();
  renderRvi();
  renderDeliv();
  renderFlows();
  renderPies();

  document.getElementById("analysis-toggle").addEventListener("click", () => {
    if (!analysisOn) openDesk();
  });
  const robotsBtn = document.getElementById("robots-toggle");
  if (robotsBtn) {
    robotsBtn.addEventListener("click", () => {
      if (analysisOn) closeDesk();
    });
  }
  const back = document.getElementById("analysis-back");
  if (back) {
    back.addEventListener("click", closeDesk);
  }

  window.NEEKO_ANALYSIS = { open: openDesk, close: closeDesk };
  window.__NEEKO_SHOW_VIEW = (next) => {
    if (next === "analysis") openDesk();
    else closeDesk();
  };
  openDesk();
})();
