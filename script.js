/* ============================================================
   BITCOIN 16:00 FIX ANALYZER
   ------------------------------------------------------------
   Reference fix:    Previous day's 16:00 New York time
   Auto-refresh:     Spot every 5s, history every 5 minutes
   Charts:           1) 24h spot    2) intraday delta vs fix
   Price APIs:       Multi-provider fallback chain (5 sources)
   ============================================================ */

// ------------------------------------------------------------
// CONFIG
// ------------------------------------------------------------
const CONFIG = {
  REFRESH_INTERVAL: 5000,           // ms — spot refresh
  MARKET_DATA_TTL: 5 * 60 * 1000,   // ms — history cache
  CHART_MAX_POINTS: 80,
  LEVELS_PERCENT: [0.25, 0.50, 0.75, 1.00],
  FIX_HOUR_NY: 16,
  API_TIMEOUT: 4000,                // ms — per-API timeout
};

// ------------------------------------------------------------
// STATE
// ------------------------------------------------------------
const state = {
  currentPrice: 0,
  previousPrice: 0,
  change24h: 0,
  fixPrice: 0,
  fixTimestamp: 0,
  chartData: [],
  levels: [],
  spotChart: null,
  deltaChart: null,
  spotChartReady: false,
  marketCache: { data: [], timestamp: 0 },
  activeApi: "—",                   // name of the API that last succeeded
  apiFailCount: 0,                  // consecutive failures of the primary API
};

// ------------------------------------------------------------
// FORMATTERS
// ------------------------------------------------------------
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatUSD(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  return usdFormatter.format(value);
}

function formatPercent(value, decimals = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const sign = value >= 0 ? "+" : "";
  return `${sign}${value.toFixed(decimals)}%`;
}

// ------------------------------------------------------------
// DATE / TIME
// ------------------------------------------------------------
function updateDateTime() {
  const now = new Date();
  const formatted = now.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZone: "America/New_York",
  });
  const el = document.getElementById("datetime");
  if (el) el.textContent = `${formatted} NY`;
}

/** UNIX timestamp (sec) of the previous day's 16:00 New York time. */
function getPreviousFixTimestamp() {
  const now = new Date();
  const nyString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const utcString = now.toLocaleString("en-US", { timeZone: "UTC" });
  const offsetMs = new Date(utcString).getTime() - new Date(nyString).getTime();

  const nyNow = new Date(nyString);
  nyNow.setDate(nyNow.getDate() - 1);
  nyNow.setHours(CONFIG.FIX_HOUR_NY, 0, 0, 0);

  const utcTs = nyNow.getTime() + offsetMs;
  return Math.floor(utcTs / 1000);
}

// ------------------------------------------------------------
// API PROVIDERS — MULTI-SOURCE FALLBACK CHAIN
// ------------------------------------------------------------
/**
 * Each provider is an async function that returns
 * { price: number, change24h: number, source: string } or throws.
 */

/** Provider 1 — Coinbase (CORS-enabled public spot endpoint) */
async function fetchFromCoinbase() {
  const res = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot", {
    signal: AbortSignal.timeout(CONFIG.API_TIMEOUT),
  });
  if (!res.ok) throw new Error(`Coinbase HTTP ${res.status}`);
  const data = await res.json();
  const price = parseFloat(data?.data?.amount);
  if (!price || Number.isNaN(price)) throw new Error("Coinbase: invalid price");
  // Coinbase spot does not return 24h change; compute from history later.
  return { price, change24h: null, source: "Coinbase" };
}

/** Provider 2 — CoinGecko (already used, kept as fallback) */
async function fetchFromCoinGecko() {
  const res = await fetch(
    "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true",
    { signal: AbortSignal.timeout(CONFIG.API_TIMEOUT) }
  );
  if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
  const data = await res.json();
  const price = data?.bitcoin?.usd;
  const change = data?.bitcoin?.usd_24h_change ?? 0;
  if (!price) throw new Error("CoinGecko: invalid price");
  return { price, change24h: change, source: "CoinGecko" };
}

/** Provider 3 — CoinMarketCap Keyless Public API */
async function fetchFromCoinMarketCap() {
  const res = await fetch(
    "https://pro-api.coinmarketcap.com/public-api/v1/simple/price?ids=1&convert=USD",
    { signal: AbortSignal.timeout(CONFIG.API_TIMEOUT) }
  );
  if (!res.ok) throw new Error(`CMC HTTP ${res.status}`);
  const data = await res.json();
  const price = data?.data?.[0]?.price;
  if (!price || Number.isNaN(price)) throw new Error("CMC: invalid price");
  return { price, change24h: null, source: "CoinMarketCap" };
}

/** Provider 4 — WhiteBIT public ticker */
async function fetchFromWhiteBIT() {
  const res = await fetch("https://whitebit.com/api/v4/public/ticker", {
    signal: AbortSignal.timeout(CONFIG.API_TIMEOUT),
  });
  if (!res.ok) throw new Error(`WhiteBIT HTTP ${res.status}`);
  const data = await res.json();
  const entry = data?.BTC_USDT;
  if (!entry?.last_price) throw new Error("WhiteBIT: invalid ticker");
  const price = parseFloat(entry.last_price);
  const change = parseFloat(entry.change) || 0;
  return { price, change24h: change, source: "WhiteBIT" };
}

/** Provider 5 — Binance via public CORS proxy (last resort) */
async function fetchFromBinanceViaProxy() {
  const target = "https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT";
  const proxied = `https://corsproxy.io/?${encodeURIComponent(target)}`;
  const res = await fetch(proxied, {
    signal: AbortSignal.timeout(CONFIG.API_TIMEOUT + 2000),
  });
  if (!res.ok) throw new Error(`Binance proxy HTTP ${res.status}`);
  const data = await res.json();
  const price = parseFloat(data?.lastPrice);
  const change = parseFloat(data?.priceChangePercent) || 0;
  if (!price || Number.isNaN(price)) throw new Error("Binance: invalid price");
  return { price, change24h: change, source: "Binance (proxy)" };
}

/**
 * The ordered list of providers. The first one that succeeds wins.
 * Order reflects reliability + CORS-friendliness for browsers.
 */
const PRICE_PROVIDERS = [
  { name: "Coinbase",         fn: fetchFromCoinbase },
  { name: "CoinGecko",        fn: fetchFromCoinGecko },
  { name: "CoinMarketCap",    fn: fetchFromCoinMarketCap },
  { name: "WhiteBIT",         fn: fetchFromWhiteBIT },
  { name: "Binance (proxy)",  fn: fetchFromBinanceViaProxy },
];

/**
 * Try every provider in order until one succeeds.
 * Returns { price, change24h, source } or null if all fail.
 */
async function fetchPriceWithFallback() {
  for (const provider of PRICE_PROVIDERS) {
    try {
      const result = await provider.fn();
      if (result && result.price) {
        state.activeApi = result.source;
        state.apiFailCount = 0;
        return result;
      }
    } catch (err) {
      // Silent fail — try the next provider.
      console.warn(`[price] ${provider.name} failed: ${err.message}`);
      state.apiFailCount++;
    }
  }

  // All providers failed — keep the last known price.
  console.error("[price] All providers failed.");
  const last = state.currentPrice || state.previousPrice || 0;
  return { price: last, change24h: state.change24h, source: "cached" };
}

/**
 * Convenience wrapper kept for API compatibility with the rest of the code.
 */
async function fetchCurrentPrice() {
  return fetchPriceWithFallback();
}

// ------------------------------------------------------------
// API — MARKET HISTORY (for charts and fix extraction)
// ------------------------------------------------------------
async function fetchMarketHistory(force = false) {
  const now = Date.now();
  const cached = state.marketCache;

  if (!force && cached.data.length && now - cached.timestamp < CONFIG.MARKET_DATA_TTL) {
    return cached.data;
  }

  // Try CoinGecko first (it returns a reliable 2-day series).
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=2",
      { signal: AbortSignal.timeout(10000) }
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.prices) && data.prices.length) {
        cached.data = data.prices;
        cached.timestamp = now;
        return cached.data;
      }
    }
  } catch (err) {
    console.warn("[history] CoinGecko failed:", err.message);
  }

  // Fallback: CoinCap (public, CORS-friendly historical series).
  try {
    const res = await fetch(
      "https://api.coincap.io/v2/assets/bitcoin/history?interval=h1",
      { signal: AbortSignal.timeout(10000) }
    );
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.data) && data.data.length) {
        // Convert CoinCap shape { time, priceUsd } → [[timestampMs, price], …]
        const series = data.data
          .map((p) => [Number(p.time), parseFloat(p.priceUsd)])
          .sort((a, b) => a[0] - b[0]);
        cached.data = series;
        cached.timestamp = now;
        return cached.data;
      }
    }
  } catch (err) {
    console.warn("[history] CoinCap failed:", err.message);
  }

  return cached.data;
}

// ------------------------------------------------------------
// FIX EXTRACTION
// ------------------------------------------------------------
function extractFixFromHistory(history) {
  if (!Array.isArray(history) || !history.length) return null;

  const fixTs = getPreviousFixTimestamp();
  let closest = null;
  let minDiff = Infinity;

  for (const point of history) {
    const tsSec = point[0] / 1000;
    const diff = Math.abs(tsSec - fixTs);
    if (diff < minDiff) {
      minDiff = diff;
      closest = point;
    }
  }

  if (!closest) return null;
  return { price: closest[1], timestamp: closest[0], approximate: minDiff > 1800 };
}

// ------------------------------------------------------------
// LEVELS
// ------------------------------------------------------------
function buildLevels(fixPrice) {
  if (!fixPrice) return [];
  const levels = [];

  [...CONFIG.LEVELS_PERCENT].reverse().forEach((pct) => {
    levels.push({
      label: `+${pct.toFixed(2)}%`,
      percent: pct,
      price: fixPrice * (1 + pct / 100),
      type: "positive",
    });
  });

  levels.push({ label: "FIX", percent: 0, price: fixPrice, type: "fix" });

  CONFIG.LEVELS_PERCENT.forEach((pct) => {
    levels.push({
      label: `-${pct.toFixed(2)}%`,
      percent: -pct,
      price: fixPrice * (1 - pct / 100),
      type: "negative",
    });
  });

  return levels;
}

function renderLevels() {
  const container = document.getElementById("levels-container");
  if (!container) return;

  if (!state.levels.length) {
    container.innerHTML = `<div class="level-item fix"><span class="level-label">Loading levels…</span><span class="level-price">—</span></div>`;
    return;
  }

  const spot = state.currentPrice;
  const sorted = [...state.levels].sort((a, b) => b.price - a.price);

  container.innerHTML = sorted
    .map((lvl) => {
      const reached =
        lvl.type !== "fix" &&
        spot > 0 &&
        ((lvl.type === "positive" && spot >= lvl.price) ||
          (lvl.type === "negative" && spot <= lvl.price));

      return `
        <div class="level-item ${lvl.type} ${reached ? "reached" : ""}">
          <span class="level-label">${lvl.label}</span>
          <span class="level-price">${formatUSD(lvl.price)}</span>
        </div>
      `;
    })
    .join("");
}

// ------------------------------------------------------------
// STATS
// ------------------------------------------------------------
function computeStatsFromHistory(history) {
  if (!Array.isArray(history) || history.length < 2) return null;

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recent = history.filter((p) => p[0] >= oneDayAgo);
  const source = recent.length > 1 ? recent : history;

  const prices = source.map((p) => p[1]);
  const average = prices.reduce((a, b) => a + b, 0) / prices.length;
  const max = Math.max(...prices);
  const min = Math.min(...prices);

  return { average, range: max - min };
}

function updateStats() {
  const stats = computeStatsFromHistory(state.chartData);
  if (!stats) return;

  const avgEl = document.getElementById("stat-average");
  const rangeEl = document.getElementById("stat-range");

  if (avgEl) avgEl.textContent = formatUSD(stats.average);
  if (rangeEl) rangeEl.textContent = formatUSD(stats.range);

  updateDifference();
}

function updateDifference() {
  const el = document.getElementById("stat-difference");
  if (!el) return;

  if (!state.fixPrice || !state.currentPrice) {
    el.textContent = "—";
    el.style.color = "";
    return;
  }

  const diff = state.currentPrice - state.fixPrice;
  el.textContent = `${diff >= 0 ? "+" : ""}${formatUSD(diff)}`;
  el.style.color = diff >= 0 ? "var(--green)" : "var(--red)";
}

// ------------------------------------------------------------
// CURRENT PRICE UI
// ------------------------------------------------------------
function updateCurrentPriceUI() {
  const priceEl = document.getElementById("current-price");
  const changeEl = document.getElementById("price-change");
  const fixEl = document.getElementById("fix-price");
  const fixSourceEl = document.getElementById("fix-source");

  if (priceEl) priceEl.textContent = formatUSD(state.currentPrice);

  if (changeEl) {
    changeEl.textContent = `${formatPercent(state.change24h)} (24h)`;
    changeEl.classList.remove("positive", "negative");
    changeEl.classList.add(state.change24h >= 0 ? "positive" : "negative");
  }

  if (fixEl) fixEl.textContent = formatUSD(state.fixPrice);
  if (fixSourceEl) fixSourceEl.textContent = state.fixPrice ? "CME benchmark" : "";
}

// ------------------------------------------------------------
// CHART 1 — SPOT
// ------------------------------------------------------------
function initSpotChart() {
  const canvas = document.getElementById("priceChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const gradient = ctx.createLinearGradient(0, 0, 0, 400);
  gradient.addColorStop(0, "rgba(37, 99, 235, 0.22)");
  gradient.addColorStop(1, "rgba(37, 99, 235, 0.00)");

  state.spotChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "BTC/USD",
          data: [],
          borderColor: "#2563eb",
          backgroundColor: gradient,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: "#2563eb",
          pointHoverBorderColor: "#fff",
          pointHoverBorderWidth: 2,
          tension: 0.32,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#0f172a",
          titleColor: "#f1f5f9",
          bodyColor: "#93c5fd",
          borderColor: "#1e293b",
          borderWidth: 1,
          padding: 12,
          cornerRadius: 10,
          displayColors: false,
          titleFont: { family: "Inter", size: 12, weight: "600" },
          bodyFont: { family: "Inter", size: 13, weight: "500" },
          callbacks: { label: (ctx) => `BTC/USD: ${formatUSD(ctx.parsed.y)}` },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(226, 232, 240, 0.7)", drawBorder: false },
          ticks: {
            color: "#94a3b8",
            font: { family: "Inter", size: 11, weight: "500" },
            maxTicksLimit: 8,
            autoSkip: true,
          },
        },
        y: {
          position: "right",
          grid: { color: "rgba(226, 232, 240, 0.7)", drawBorder: false },
          ticks: {
            color: "#94a3b8",
            font: { family: "Inter", size: 11, weight: "500" },
            callback: (v) => "$" + Number(v).toLocaleString("en-US"),
          },
        },
      },
      animation: { duration: 400 },
    },
  });
}

function setSpotChartFromHistory(history) {
  if (!state.spotChart || !history.length) return;

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recent = history.filter((p) => p[0] >= oneDayAgo);
  const source = recent.length > 2 ? recent : history;

  const step = Math.max(1, Math.floor(source.length / CONFIG.CHART_MAX_POINTS));
  const labels = [], values = [];

  source.forEach((p, i) => {
    if (i % step === 0 || i === source.length - 1) {
      const d = new Date(p[0]);
      labels.push(
        d.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      );
      values.push(p[1]);
    }
  });

  state.spotChart.data.labels = labels;
  state.spotChart.data.datasets[0].data = values;
  state.spotChart.update("none");
  state.spotChartReady = true;
}

function appendLivePoint(price) {
  if (!state.spotChart || !state.spotChartReady || !price) return;

  const timeLabel = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  state.spotChart.data.labels.push(timeLabel);
  state.spotChart.data.datasets[0].data.push(price);

  while (state.spotChart.data.labels.length > CONFIG.CHART_MAX_POINTS + 20) {
    state.spotChart.data.labels.shift();
    state.spotChart.data.datasets[0].data.shift();
  }

  state.spotChart.update("none");
}

// ------------------------------------------------------------
// CHART 2 — DELTA VS PREVIOUS DAY FIX
// ------------------------------------------------------------
function initDeltaChart() {
  const canvas = document.getElementById("deltaChart");
  if (!canvas) return;

  state.deltaChart = new Chart(canvas.getContext("2d"), {
    type: "bar",
    data: {
      labels: [],
      datasets: [
        {
          label: "Δ vs Fix (%)",
          data: [],
          backgroundColor: [],
          borderColor: [],
          borderWidth: 1,
          borderRadius: 3,
          barPercentage: 0.85,
          categoryPercentage: 0.9,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#0f172a",
          titleColor: "#f1f5f9",
          bodyColor: "#93c5fd",
          borderColor: "#1e293b",
          borderWidth: 1,
          padding: 12,
          cornerRadius: 10,
          displayColors: false,
          titleFont: { family: "Inter", size: 12, weight: "600" },
          bodyFont: { family: "Inter", size: 13, weight: "500" },
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y;
              return `Δ vs Fix: ${v >= 0 ? "+" : ""}${v.toFixed(3)}%`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false, drawBorder: false },
          ticks: {
            color: "#94a3b8",
            font: { family: "Inter", size: 11, weight: "500" },
            maxTicksLimit: 8,
            autoSkip: true,
          },
        },
        y: {
          position: "right",
          grid: { color: "rgba(226, 232, 240, 0.7)", drawBorder: false },
          ticks: {
            color: "#94a3b8",
            font: { family: "Inter", size: 11, weight: "500" },
            callback: (v) => (v >= 0 ? "+" : "") + Number(v).toFixed(2) + "%",
          },
        },
      },
      animation: { duration: 400 },
    },
  });
}

function setDeltaChartFromHistory(history) {
  if (!state.deltaChart || !history.length || !state.fixPrice) return;

  const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
  const recent = history.filter((p) => p[0] >= oneDayAgo);
  const source = recent.length > 4 ? recent : history;

  const step = Math.max(1, Math.floor(source.length / CONFIG.CHART_MAX_POINTS));

  const labels = [];
  const deltas = [];
  const bgColors = [];
  const bdColors = [];

  source.forEach((p, i) => {
    if (i % step === 0 || i === source.length - 1) {
      const ts = p[0];
      const price = p[1];
      const deltaPct = ((price - state.fixPrice) / state.fixPrice) * 100;

      const d = new Date(ts);
      labels.push(
        d.toLocaleTimeString("en-US", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      );
      deltas.push(deltaPct);

      if (deltaPct >= 0) {
        bgColors.push("rgba(16, 185, 129, 0.75)");
        bdColors.push("rgba(5, 150, 105, 1)");
      } else {
        bgColors.push("rgba(239, 68, 68, 0.75)");
        bdColors.push("rgba(185, 28, 28, 1)");
      }
    }
  });

  state.deltaChart.data.labels = labels;
  state.deltaChart.data.datasets[0].data = deltas;
  state.deltaChart.data.datasets[0].backgroundColor = bgColors;
  state.deltaChart.data.datasets[0].borderColor = bdColors;
  state.deltaChart.update("none");
}

function appendDeltaPoint(price) {
  if (!state.deltaChart || !state.fixPrice || !price) return;

  const deltaPct = ((price - state.fixPrice) / state.fixPrice) * 100;
  const timeLabel = new Date().toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  const chart = state.deltaChart;
  chart.data.labels.push(timeLabel);
  chart.data.datasets[0].data.push(deltaPct);

  if (deltaPct >= 0) {
    chart.data.datasets[0].backgroundColor.push("rgba(16, 185, 129, 0.75)");
    chart.data.datasets[0].borderColor.push("rgba(5, 150, 105, 1)");
  } else {
    chart.data.datasets[0].backgroundColor.push("rgba(239, 68, 68, 0.75)");
    chart.data.datasets[0].borderColor.push("rgba(185, 28, 28, 1)");
  }

  while (chart.data.labels.length > CONFIG.CHART_MAX_POINTS + 20) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
    chart.data.datasets[0].backgroundColor.shift();
    chart.data.datasets[0].borderColor.shift();
  }

  chart.update("none");
}

// ------------------------------------------------------------
// ROUTING
// ------------------------------------------------------------
function setupRouting() {
  const pages = document.querySelectorAll(".page");

  function showPage(pageId) {
    pages.forEach((p) => p.classList.toggle("active", p.id === `page-${pageId}`));
    document.querySelectorAll(".nav-links a").forEach((a) => {
      a.classList.toggle("active", a.dataset.page === pageId);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  document.body.addEventListener("click", (e) => {
    const link = e.target.closest("[data-page]");
    if (!link) return;
    const page = link.dataset.page;
    if (!page) return;
    e.preventDefault();
    if (window.location.hash !== `#${page}`) window.location.hash = page;
    showPage(page);
  });

  window.addEventListener("hashchange", () => {
    const page = window.location.hash.replace("#", "") || "home";
    showPage(page);
  });

  const initial = window.location.hash.replace("#", "") || "home";
  showPage(initial);
}

// ------------------------------------------------------------
// CONTACT FORM
// ------------------------------------------------------------
function setupContactForm() {
  const form = document.getElementById("contact-form");
  if (!form) return;
  const status = document.getElementById("form-status");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (status) status.textContent = "✓ Message sent successfully. We will get back to you shortly.";
    form.reset();
    setTimeout(() => { if (status) status.textContent = ""; }, 5000);
  });
}

// ------------------------------------------------------------
// MAIN LOOP
// ------------------------------------------------------------
async function refreshSpot() {
  updateDateTime();

  const { price, change24h } = await fetchCurrentPrice();

  if (price && price !== state.currentPrice) {
    state.previousPrice = state.currentPrice;
    state.currentPrice = price;
    state.change24h = change24h;

    updateCurrentPriceUI();
    updateDifference();
    renderLevels();
    appendLivePoint(price);
    appendDeltaPoint(price);

    // Small visual log so you can see which API served the price.
    console.log(`[spot] ${state.activeApi} → $${price.toFixed(2)}`);
  }
}

async function bootstrap() {
  updateDateTime();
  setInterval(updateDateTime, 1000);

  initSpotChart();
  initDeltaChart();

  const [history, spot] = await Promise.all([
    fetchMarketHistory(true),
    fetchCurrentPrice(),
  ]);

  state.chartData = history || [];
  state.currentPrice = spot.price;
  state.change24h = spot.change24h ?? 0;

  const fix = extractFixFromHistory(state.chartData);
  if (fix) {
    state.fixPrice = fix.price;
    state.fixTimestamp = fix.timestamp;
  } else if (state.currentPrice) {
    state.fixPrice = state.currentPrice;
    state.fixTimestamp = getPreviousFixTimestamp() * 1000;
  }

  state.levels = buildLevels(state.fixPrice);

  updateCurrentPriceUI();
  renderLevels();
  updateStats();

  if (state.chartData.length) {
    setSpotChartFromHistory(state.chartData);
    setDeltaChartFromHistory(state.chartData);
  }

  setInterval(refreshSpot, CONFIG.REFRESH_INTERVAL);

  setInterval(async () => {
    const fresh = await fetchMarketHistory(true);
    if (fresh.length) {
      state.chartData = fresh;
      const updatedFix = extractFixFromHistory(fresh);
      if (updatedFix) {
        state.fixPrice = updatedFix.price;
        state.fixTimestamp = updatedFix.timestamp;
        state.levels = buildLevels(state.fixPrice);
        updateCurrentPriceUI();
        renderLevels();
      }
      updateStats();
      setDeltaChartFromHistory(state.chartData);
    }
  }, CONFIG.MARKET_DATA_TTL);
}

// ------------------------------------------------------------
// INIT
// ------------------------------------------------------------
document.addEventListener("DOMContentLoaded", () => {
  setupRouting();
  setupContactForm();
  bootstrap();
});
