// worker.js — OSRS FlipTips (parchment cards, 60s live, freshness SLO)

// ---------------- config ----------------
const API = "https://prices.runescape.wiki/api/v1/osrs";
const UA = { "User-Agent": "OSRS FlipTips Worker / contact: bellhammer13@gmail.com" };
const CACHE_SEC = 60;             // end-to-end live ≤60s
const STALE_SEC = 120;            // show banner if older than 2m (SLO)
const PARCH_URL = "https://pub-11c7cdf2188f436292e816dfa21a2787.r2.dev/1D9828E7-C494-46B9-860D-10218C4E072A.png";

// in-memory warm cache (persists while worker is warm)
let MAP_CACHE = null;
let MAP_CACHE_TS = 0;

// ---------------- tiny helpers ----------------
const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
  status,
  headers: { "content-type": "application/json; charset=utf-8" }
});

const html = (str) => new Response(str, { headers: { "content-type": "text/html; charset=utf-8" } });

const safeNum = (x) => Number.isFinite(Number(x)) ? Number(x) : 0;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

async function getJSON(url) {
  const req = new Request(url, { headers: UA });
  const cache = caches.default;
  const hit = await cache.match(req);
  if (hit) return hit.json();
  const res = await fetch(req);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const body = await res.clone().json();
  await cache.put(req, new Response(JSON.stringify(body), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": `public, max-age=${CACHE_SEC}`
    }
  }));
  return body;
}

async function getMapping() {
  const now = Date.now();
  if (MAP_CACHE && now - MAP_CACHE_TS < CACHE_SEC * 1000) return MAP_CACHE;
  const data = await getJSON(`${API}/mapping`);
  const byId = new Map();
  for (const it of data) byId.set(it.id, it);
  MAP_CACHE = byId;
  MAP_CACHE_TS = now;
  return byId;
}

// ---------------- API builder ----------------
async function buildData(urlObj) {
  const filter = (urlObj.searchParams.get("filter") || "all").toLowerCase();
  const q = (urlObj.searchParams.get("q") || "").trim().toLowerCase();
  const page = clamp(parseInt(urlObj.searchParams.get("page") || "1", 10), 1, 1e9);
  const pageSize = clamp(parseInt(urlObj.searchParams.get("pageSize") || "25", 10), 1, 200);
  const [mappingById, latest, h1, h24] = await Promise.all([
    getMapping(),
    getJSON(`${API}/latest`),
    getJSON(`${API}/1h`),
    getJSON(`${API}/24h`)
  ]);
  const pulledAt = Date.now();
  const latestData = latest?.data || {};
  const h1Data = h1?.data || {};
  const h24Data = h24?.data || {};
  const rows = [];
  for (const idStr of Object.keys(latestData)) {
    const id = Number(idStr);
    const lm = latestData[idStr] || {};
    const m = mappingById.get(id);
    if (!m) continue;
    const instaSell = safeNum(lm.high);
    const instaBuy = safeNum(lm.low);
    if (!instaSell && !instaBuy) continue;
    const v1h = safeNum(h1Data[idStr]?.volume);
    const avgLow24 = safeNum(h24Data[idStr]?.avgLowPrice);
    const avgHigh24 = safeNum(h24Data[idStr]?.avgHighPrice);
    const avgMid24 = (avgLow24 && avgHigh24) ? Math.round((avgLow24 + avgHigh24) / 2) : 0;
    const sellAfterTax = Math.floor(instaSell * 0.99);
    const yieldAfterTax = sellAfterTax - instaBuy;
    const roiPct = instaBuy > 0 ? (yieldAfterTax / instaBuy) * 100 : 0;
    let icon = "";
    if (m.icon) icon = `https://oldschool.runescape.wiki/images/${encodeURIComponent(m.icon)}`;
    const name = m.name || `Item ${id}`;
    if (q && !name.toLowerCase().includes(q)) continue;
    rows.push({
      id,
      name,
      icon,
      geLimit: m.limit || 0,
      instaBuy,
      instaSell,
      yieldAfterTax,
      roiPct,
      avgMid24,
      vol1h: v1h,
      highAlch: m.highalch || 0
    });
  }
  let filtered = rows;
  switch (filter) {
    case "high value":
      filtered = rows.filter(r => r.instaSell >= 500000).sort((a, b) => b.instaSell - a.instaSell);
      break;
    case "high volume":
      filtered = rows.filter(r => r.vol1h > 0).sort((a, b) => b.vol1h - a.vol1h);
      break;
    case "high margin":
      filtered = rows.filter(r => r.roiPct > 0).sort((a, b) => b.roiPct - a.roiPct);
      break;
    case "flip tips":
      filtered = rows.filter(r => r.yieldAfterTax > 0).sort((a, b) => b.yieldAfterTax - a.yieldAfterTax);
      break;
    default:
      filtered = rows.sort((a, b) => b.yieldAfterTax - a.yieldAfterTax);
  }
  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);
  const ageMs = Date.now() - pulledAt;
  return { ok: true, total, page, pageSize, items, pulledAt, ageMs };
}

// --------------- Page ---------------
function pageHTML() {
  return `<!doctype html>
<html lang="en">
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<title>OSRS FlipTips</title>
<style>
:root{
  --bg:#12161a; --panel:#1b2127; --text:#e9eef3; --muted:#aab6c2;
  --good:#2fd479; --bad:#e25b5b; --ring:#3a444f;
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,Inter,Arial}
header{display:flex;align-items:center;gap:12px;padding:14px 16px 4px}
h1{font-size:28px;margin:0;font-weight:800}
.status{width:10px;height:10px;border-radius:50%;background:#22d160;box-shadow:0 0 0 3px rgba(34,209,96,.15)}
.bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;padding:8px 16px 14px}
select,input[type="text"],button{
  background:var(--panel);color:var(--text);border:1px solid var(--ring);border-radius:12px;padding:10px 12px;font-weight:600;outline:none
}
button{cursor:pointer}
.notice{display:none;margin:0 16px 8px;padding:10px 12px;border:1px solid #665e00;border-radius:12px;background:#332f00;color:#ffe27a;font-weight:700}
.notice.show{display:block}
.list{display:flex;flex-direction:column;gap:14px;padding:0 12px 40px}
.card{
  position:relative;width:min(92vw,720px);margin:0 auto;aspect-ratio:1/1;
  background:url("${PARCH_URL}") center/contain no-repeat;
  filter: drop-shadow(0 4px 10px rgba(0,0,0,.45));
}
.sheet{
  position:absolute;
  inset:10% 7.5% 12% 7.5%;
  display:flex;flex-direction:column;gap:10px;
}
.topline{display:flex;align-items:center;justify-content:space-between;gap:8px}
.title{font-weight:900;font-size:clamp(18px,4.2vw,26px);text-shadow:0 1px 0 #0007}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.chips{display:flex;gap:8px;flex-wrap:wrap}
.chip{background:transparent;border:2px solid #6d5639a8;border-radius:14px;padding:8px 12px;color:#2b2b2b;font-weight:800;background-color:#00000014}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
@media (max-width:520px){ .grid{grid-template-columns:1fr} }
.cell{background:transparent;border:2px solid #6d5639a8;border-radius:14px;padding:10px 12px;color:#2b2b2b}
h5{margin:0 0 6px 0;font-size:13px;font-weight:800;color:#3c3429}
.big{font-size:clamp(18px,5.6vw,28px);font-weight:900;color:#19140f;text-shadow:0 1px 0 #0001}
.good{color:var(--good)} .bad{color:var(--bad)}
.buttons{margin-top:auto;display:flex;gap:10px;flex-wrap:wrap}
.buttons a{text-decoration:none;color:#1d1b17;background:transparent;border:2px solid #6d5639a8;border-radius:14px;padding:10px 14px;font-weight:900}
.meta{font-size:12px;color:var(--muted)}
.icon{width:26px;height:26px;border-radius:4px;object-fit:cover;box-shadow:0 0 0 2px #0003}
</style>

<style>
/* overrides to correct parchment card shape and design */
.card{width:min(90vw,720px);aspect-ratio:1/1;background:url("https://pub-11c7cdf2188f436292e816dfa21a2787.r2.dev/1D9828E7-C494-46B9-860D-10218C4E072A.png") center/contain no-repeat;filter:drop-shadow(0 8px 20px rgba(0,0,0,.45));}
.sheet{inset:5% 5% 8% 5%;}
.cell{background:rgba(211,183,122,0.12);border:1px solid rgba(109,86,57,0.4);color:#fbf8f2;}
h5{color:#ead9b3;}
.big{color:#fbf8f2;}
</style>

<body>
<header>
  <div class="status"></div>
  <h1>OSRS FlipTips</h1>
</header>
<div class="bar">
  <label class="meta">Filter</label>
  <select id="filter">
    <option>All Items</option><option>High Value</option><option>High Volume</option><option>High Margin</option><option>Flip Tips</option>
  </select>
  <label class="meta">Per page</label>
  <select id="pageSize"><option>10</option><option selected>25</option><option>50</option></select>
  <button id="refresh">Refresh</button>
  <div class="meta" id="total">Total: —</div>
  <input id="search" type="text" placeholder="Search item..." style="flex:1;min-width:180px"/>
</div>
<div id="stale" class="notice">Live feed delayed—data older than 2 minutes. We’re on it.</div>
<div class="list" id="list"></div>
<script>
const UI = {
  list: document.getElementById("list"),
  total: document.getElementById("total"),
  filter: document.getElementById("filter"),
  pageSize: document.getElementById("pageSize"),
  refresh: document.getElementById("refresh"),
  search: document.getElementById("search"),
  stale: document.getElementById("stale")
};
let timer = null;
function gp(n){return (n==null||isNaN(n)) ? "—" : Number(n).toLocaleString("en-US");}
function pct(n){return (n==null||isNaN(n)) ? "—" : (Math.round(n*100)/100).toFixed(2)+"%";}
async function load(){
  const params = new URLSearchParams({
    filter: UI.filter.value.toLowerCase(),
    q: UI.search.value.trim(),
    page: "1",
    pageSize: UI.pageSize.value
  });
  const res = await fetch("/api/data?"+params.toString(), { headers: { "cache-control": "no-cache" }});
  if(!res.ok){
    UI.list.innerHTML = '<div class="meta">Error loading data: HTTP '+res.status+'</div>';
    return;
  }
  const data = await res.json();
  UI.total.textContent = "Total: " + data.total.toLocaleString("en-US");
  UI.stale.classList.toggle("show", (data.ageMs||0) > ${STALE_SEC * 1000});
  render(data.items || []);
}
function render(items){
  UI.list.innerHTML = items.map(it => {
    const ycls = it.yieldAfterTax > 0 ? "good" : it.yieldAfterTax < 0 ? "bad" : "";
    const roic = it.roiPct > 0 ? "good" : it.roiPct < 0 ? "bad" : "";
    const icon = it.icon ? '<img class="icon" loading="lazy" src="'+it.icon+'" alt=""/>' : '<span style="width:26px;height:26px;display:inline-block;background:#0003;border-radius:5px"></span>';
    const wikiLink = 'https://oldschool.runescape.wiki/w/Special:Lookup?type=item&id='+it.id;
    const cloudLink = 'https://prices.osrs.cloud/';
    const wikiPrice = 'https://prices.runescape.wiki/osrs/item/'+it.id;
    return `
    <div class="card">
      <div class="sheet">
        <div class="topline">
          <div class="row" style="gap:8px">${icon}<div class="title">${it.name}</div></div>
        </div>
        <div class="chips">
          <div class="chip">GE buy limit: ${gp(it.geLimit)}</div>
          <div class="chip">1h vol: ${gp(it.vol1h)}</div>
        </div>
        <div class="grid">
          <div class="cell"><h5>Instant Buy (you pay)</h5><div class="big">${gp(it.instaBuy)} gp</div></div>
          <div class="cell"><h5>Instant Sell (you receive)</h5><div class="big">${gp(it.instaSell)} gp</div></div>
          <div class="cell"><h5>Yield after tax</h5><div class="big ${ycls}">${it.yieldAfterTax>0?"+":""}${gp(it.yieldAfterTax)} gp</div></div>
          <div class="cell"><h5>ROI</h5><div class="big ${roic}">${pct(it.roiPct)}</div></div>
          <div class="cell"><h5>Avg buy (24h)</h5><div class="big">${gp(it.avgMid24 || 0)} gp</div></div>
          <div class="cell"><h5>High Alch</h5><div class="big">${gp(it.highAlch)} gp</div></div>
        </div>
        <div class="buttons">
          <a href="${wikiLink}" target="_blank" rel="noopener">Wiki</a>
          <a href="${wikiPrice}" target="_blank" rel="noopener">Wiki Price</a>
          <a href="${cloudLink}" target="_blank" rel="noopener">prices.osrs.cloud</a>
        </div>
      </div>
    </div>`;
  }).join("");
}
UI.refresh.addEventListener("click", load);
UI.filter.addEventListener("change", load);
UI.pageSize.addEventListener("change", load);
UI.search.addEventListener("input", () => { if (timer) clearTimeout(timer); timer = setTimeout(load, 350); });
load();
setInterval(load, 60000);
</script>
</body>
</html>`;
}

// --------------- Router ---------------
export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/data") {
        const data = await buildData(url);
        return json(data);
      }
      if (url.pathname === "/api/diag") {
        const [m, l, h1] = await Promise.allSettled([
          fetch(`${API}/mapping`, { headers: UA }),
          fetch(`${API}/latest`, { headers: UA }),
          fetch(`${API}/1h`, { headers: UA })
        ]);
        const ok = (r) => r.status === "fulfilled" && r.value.ok;
        return json({
          ok: ok(m) && ok(l) && ok(h1),
          mapping: m.status === "fulfilled" ? m.value.status : String(m.reason),
          latest: l.status === "fulfilled" ? l.value.status : String(l.reason),
          oneHour: h1.status === "fulfilled" ? h1.value.status : String(h1.reason),
          cacheSec: CACHE_SEC,
          staleBannerSec: STALE_SEC
        });
      }
      return html(pageHTML());
    } catch (err) {
      return new Response(String(err && err.stack || err), {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    }
  }
};
