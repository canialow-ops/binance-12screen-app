const RISK_MIN = 0.05;
const RISK_MAX = 0.095;
const RISK_HARD = 0.1;

function riskPct(st, size) {
  return (size * st.mark) / st.baseBalance;
}

function floorSizeUnderCap(st, raw) {
  const q = 10000;
  const hi = (st.baseBalance * RISK_MAX) / st.mark;
  const hard = (st.baseBalance * 0.099) / st.mark;
  let n = Math.min(raw, hi, hard);
  n = Math.floor(n * q) / q;
  while (n > 0 && riskPct(st, n) >= RISK_HARD) n = (Math.round(n * q) - 1) / q;
  return n;
}

function clampSizeToBand(st, size) {
  const lo = (st.baseBalance * RISK_MIN) / st.mark;
  const hi = (st.baseBalance * RISK_MAX) / st.mark;
  return floorSizeUnderCap(st, Math.min(Math.max(size, lo), hi));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const wallet = 582142.85;
const mark = 77153.29;
const st = { mark, baseBalance: wallet, symbol: "BTCUSDT" };

for (const r of [0.05, 0.08, 0.095, 0.12, 0.2]) {
  const size = floorSizeUnderCap(st, (wallet * r) / mark);
  const pct = riskPct(st, size);
  assert(pct < RISK_HARD, "hard cap failed r=" + r + " pct=" + pct);
  assert(pct <= RISK_MAX + 1e-12, "op cap failed r=" + r + " pct=" + pct);
}

st.size = floorSizeUnderCap(st, (wallet * 0.095) / mark);
st.mark = mark * 1.08;
st.size = floorSizeUnderCap(st, st.size);
assert(riskPct(st, st.size) < RISK_HARD, "mark spike still under 10%");

const addTry = clampSizeToBand(st, st.size * 3);
assert(riskPct({ ...st, size: addTry }, addTry) < RISK_HARD, "add cannot breach 10%");

console.log("risk-cap ok", {
  seed95: riskPct({ ...st, mark }, floorSizeUnderCap({ mark, baseBalance: wallet }, (wallet * 0.095) / mark)),
  afterSpike: riskPct(st, st.size),
  addTry: riskPct({ ...st, size: addTry }, addTry),
});
