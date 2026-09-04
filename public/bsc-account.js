(function () {
  const COUNT = 60;
  const ICO_EYE = '<svg class="bsc-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 8s2.4-4.2 6.5-4.2S14.5 8 14.5 8s-2.4 4.2-6.5 4.2S1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="1.8"/></svg>';
  const ICO_GIFT = '<svg class="bsc-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><rect x="2.4" y="7.2" width="11.2" height="7.2" rx="1.1"/><path d="M2.4 7.2h11.2V6.1A1.2 1.2 0 0 0 12.4 4.9H3.6A1.2 1.2 0 0 0 2.4 6.1v1.1Z"/><path d="M8 4.9v9.5"/><path d="M8 4.9c0-1.5 1.1-2.5 2.3-2.5.9 0 1.4.7 1.4 1.5 0 1.1-1.4 1.8-3.7 1"/><path d="M8 4.9c0-1.5-1.1-2.5-2.3-2.5-.9 0-1.4.7-1.4 1.5 0 1.1 1.4 1.8 3.7 1"/></svg>';
  const ICO_SWAP = '<svg class="bsc-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4.2 6.2H13L10.4 3.6"/><path d="M11.8 9.8H3L5.6 12.4"/></svg>';
  const ICO_DOC = '<svg class="bsc-ico" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"><path d="M4.6 2.4h5.6L13 5.2v8.4H4.6z"/><path d="M10.2 2.4V5.2H13"/><circle cx="7.1" cy="10.4" r="2.1"/><path d="M7.1 9.4v2M6.3 10c.2-.3.5-.4.8-.4.5 0 .8.3.8.6s-.4.5-1 .6c-.5.1-.9.3-.9.7s.4.7 1 .7c.3 0 .6-.1.8-.4"/></svg>';

  function formatCryptoNumber(num) {
    if (window.NEEKO_BOTS && typeof window.NEEKO_BOTS.format === "function") {
      return window.NEEKO_BOTS.format(num);
    }
    if (num === undefined || num === null) return "0.00";
    const val = parseFloat(num);
    if (!Number.isFinite(val)) return "0.00";
    return val.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function signedMoney(n) {
    const x = Number(n) || 0;
    const abs = formatCryptoNumber(Math.abs(x));
    if (x > 0) return `+$${abs}`;
    if (x < 0) return `-$${abs}`;
    return `$${abs}`;
  }

  function emptySnap(id) {
    return { id, margin: 0, upnl: 0, wallet: 0, daily: 0, dailyPct: 0, usd: 1 };
  }

  function readSnap(slot) {
    const api = window.NEEKO_BOTS;
    if (!api || typeof api.snapshot !== "function") return emptySnap(slot);
    const botId = typeof api.botIdOfSlot === "function" ? api.botIdOfSlot(slot) : slot;
    const last = typeof api.last === "function" ? api.last(botId) : null;
    if (last && Date.now() - last.at < 2500) return last;
    return api.snapshot(botId) || emptySnap(botId);
  }

  function cardHtml() {
    return `<article class="bsc-card">
      <div class="bsc-tabs">
        <span>总览</span><span class="on">合约</span><span>现货</span><span>资金</span>
      </div>
      <div class="bsc-sub">
        <span class="bsc-chip">U本位合约</span>
        <span class="dim">币本位合约</span>
      </div>
      <div class="bsc-row3">
        <div class="bsc-row3-l">
          <span class="bsc-dash">保证金余额</span>
          <button type="button" class="bsc-ico-btn" data-eye aria-label="隐藏">${ICO_EYE}</button>
        </div>
        <div class="bsc-row3-r">
          <span aria-hidden="true">${ICO_GIFT}</span>
          <span aria-hidden="true">${ICO_SWAP}</span>
          <span aria-hidden="true">${ICO_DOC}</span>
        </div>
      </div>
      <div class="bsc-amt"><b data-amt>0.00</b><span class="u">USDT</span><span class="tri">▼</span></div>
      <div class="bsc-fiat" data-fiat>≈ $0.00</div>
      <div class="bsc-today">
        <span class="bsc-dash">今日已实现盈亏</span>
        <span class="val" data-realized>$0.00 (+0.00%)</span>
        <span class="chev" aria-hidden="true">›</span>
      </div>
      <div class="bsc-cols">
        <div>
          <div class="lab bsc-dash" style="display:inline-block">钱包余额 (USDT)</div>
          <b data-wallet>0.00</b>
          <div class="sub" data-wallet-fiat>≈ $0.00</div>
        </div>
        <div>
          <div class="lab bsc-dash" style="display:inline-block">未实现盈亏 (USDT)</div>
          <b data-upnl>0.00</b>
          <div class="sub" data-upnl-fiat>≈ $0.00</div>
        </div>
      </div>
      <div class="bsc-btns">
        <button type="button" class="go">交易</button>
        <button type="button" class="alt">兑换</button>
        <button type="button" class="alt">划转</button>
      </div>
      <div class="bsc-sync">Syncing...</div>
    </article>`;
  }

  function paint(el, st) {
    const margin = Number(st.margin) || 0;
    const wallet = Number(st.wallet) || 0;
    const upnl = Number(st.upnl) || 0;
    const daily = Number(st.daily) || 0;
    const usd = Number(st.usd) > 0 ? Number(st.usd) : 1;
    const dailyPct = Number.isFinite(st.dailyPct) ? st.dailyPct : 0;
    el.querySelector("[data-amt]").textContent = st.totalText || formatCryptoNumber(margin);
    el.querySelector("[data-fiat]").textContent = `≈ $${formatCryptoNumber(margin * usd)}`;
    const realEl = el.querySelector("[data-realized]");
    const signPct = dailyPct >= 0 ? "+" : "";
    realEl.textContent = `${signedMoney(daily)} (${signPct}${formatCryptoNumber(dailyPct)}%)`;
    realEl.className = "val " + (daily >= 0 ? "up" : "down");
    el.querySelector("[data-wallet]").textContent = formatCryptoNumber(wallet);
    el.querySelector("[data-wallet-fiat]").textContent = `≈ $${formatCryptoNumber(wallet * usd)}`;
    el.querySelector("[data-upnl]").textContent = formatCryptoNumber(upnl);
    el.querySelector("[data-upnl-fiat]").textContent = `≈ ${upnl >= 0 ? "" : "-"}$${formatCryptoNumber(Math.abs(upnl * usd))}`;
  }

  let built = false;
  const nodes = [];
  function ensureCards() {
    const host = document.getElementById("bsc-wall");
    if (!host || built) return;
    const box = document.createDocumentFragment();
    for (let i = 0; i < COUNT; i += 1) {
      const wrap = document.createElement("div");
      wrap.innerHTML = cardHtml();
      const el = wrap.firstElementChild;
      el.querySelector("[data-eye]").addEventListener("click", () => el.classList.toggle("masked"));
      box.appendChild(el);
      nodes.push(el);
    }
    host.appendChild(box);
    built = true;
    paintAll();
  }

  function paintAll() {
    nodes.forEach((el, i) => {
      if (el.classList.contains("reloading")) return;
      paint(el, readSnap(i + 1));
    });
  }

  let tickTimer = 0;
  function startTick() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      if (!document.body.classList.contains("bsc-on")) return;
      paintAll();
    }, 280);
  }

  function setNav(mode) {
    const a = document.getElementById("analysis-toggle");
    const r = document.getElementById("robots-toggle");
    const b = document.getElementById("bsc-toggle");
    if (a) {
      a.classList.toggle("is-on", mode === "analysis");
      a.classList.toggle("active", mode === "analysis");
      a.setAttribute("aria-pressed", mode === "analysis" ? "true" : "false");
    }
    if (r) {
      r.classList.toggle("is-on", mode === "robots");
      r.setAttribute("aria-pressed", mode === "robots" ? "true" : "false");
    }
    if (b) {
      b.classList.toggle("is-on", mode === "bsc");
      b.setAttribute("aria-pressed", mode === "bsc" ? "true" : "false");
    }
  }

  function showView(mode) {
    if (mode === "analysis") {
      document.body.classList.remove("bsc-on");
      if (window.NEEKO_ANALYSIS) window.NEEKO_ANALYSIS.open();
      setNav("analysis");
      return;
    }
    if (mode === "bsc") {
      document.body.classList.add("bsc-on");
      if (window.NEEKO_ANALYSIS) window.NEEKO_ANALYSIS.close();
      ensureCards();
      paintAll();
      startTick();
      setNav("bsc");
      return;
    }
    if (window.NEEKO_ANALYSIS) window.NEEKO_ANALYSIS.close();
    document.body.classList.remove("bsc-on");
    setNav("robots");
  }

  window.__NEEKO_SHOW_VIEW = showView;
  window.addEventListener("neeko-bots-group", () => {
    if (document.body.classList.contains("bsc-on")) paintAll();
  });
  function slotOfBotId(id) {
    return ((Number(id) - 1) % COUNT) + 1;
  }
  window.addEventListener("neeko-bots-reload", (ev) => {
    (ev.detail?.ids || []).forEach((id) => {
      const el = nodes[slotOfBotId(id) - 1];
      if (el) el.classList.add("reloading");
    });
  });
  window.addEventListener("neeko-bots-reload-done", (ev) => {
    (ev.detail?.ids || []).forEach((id) => {
      const slot = slotOfBotId(id);
      const el = nodes[slot - 1];
      if (!el) return;
      el.classList.remove("reloading");
      paint(el, readSnap(slot));
    });
  });

  document.getElementById("analysis-toggle")?.addEventListener("click", () => showView("analysis"));
  document.getElementById("robots-toggle")?.addEventListener("click", () => showView("robots"));
  document.getElementById("bsc-toggle")?.addEventListener("click", () => showView("bsc"));
})();
