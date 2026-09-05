// TrainETA — Indian Railway station search + live train ETA
// Firebase is used for optional analytics. RailRadar stays server-side behind Cloudflare.

const firebaseConfig = {
  apiKey: "AIzaSyB6ZjGCfv95XsuAT_S0FQfBiIX2gV_3cic",
  authDomain: "traineta-4d192.firebaseapp.com",
  projectId: "traineta-4d192",
  storageBucket: "traineta-4d192.firebasestorage.app",
  messagingSenderId: "1013506580188",
  appId: "1:1013506580188:web:09351e972e088828391e19",
  measurementId: "G-ZDS0X4N2HT"
};

// The Worker should be created with the name "traineta" in the same Cloudflare
// account whose workers.dev subdomain is bharatchandrasirala.
const WORKER_BASE = "https://traineta.bharatchandrasirala.workers.dev";

const $ = id => document.getElementById(id);
const searchInput = $("searchInput");
const searchBtn = $("searchBtn");
const clearBtn = $("clearBtn");
const statusEl = $("status");
const errorEl = $("error");
const resultsEl = $("results");
const listEl = $("stationList");
const summaryEl = $("summary");
const detailEl = $("stationDetail");

const FALLBACK_STATIONS = [
  ["NDLS","New Delhi","Delhi"],["DLI","Old Delhi Junction","Delhi"],["NZM","Hazrat Nizamuddin","Delhi"],["ANVT","Anand Vihar Terminal","Delhi"],["DEE","Delhi Sarai Rohilla","Delhi"],
  ["AGC","Agra Cantt","Agra"],["CNB","Kanpur Central","Kanpur"],["LKO","Lucknow","Lucknow"],["HWH","Howrah Junction","Kolkata"],["SDAH","Sealdah","Kolkata"],
  ["CSMT","Chhatrapati Shivaji Maharaj Terminus","Mumbai"],["MMCT","Mumbai Central","Mumbai"],["PUNE","Pune Junction","Pune"],["ADI","Ahmedabad Junction","Ahmedabad"],["JP","Jaipur Junction","Jaipur"],
  ["BPL","Bhopal Junction","Bhopal"],["INDB","Indore Junction","Indore"],["JBP","Jabalpur Junction","Jabalpur"],["NGP","Nagpur Junction","Nagpur"],["HYB","Hyderabad Deccan","Hyderabad"],
  ["SC","Secunderabad Junction","Hyderabad"],["MAS","Chennai Central","Chennai"],["SBC","KSR Bengaluru City Junction","Bengaluru"],["YPR","Yesvantpur Junction","Bengaluru"],
  ["VSKP","Visakhapatnam","Visakhapatnam"],["BBS","Bhubaneswar","Bhubaneswar"],["PURI","Puri","Puri"],["GKP","Gorakhpur Junction","Gorakhpur"],["PNBE","Patna Junction","Patna"]
].map(([code,name,city]) => ({code,name,city}));

let allStations = FALLBACK_STATIONS.slice();
let selectedStation = null;
let currentTrainNumber = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));
}
function setError(message) { errorEl.textContent = message || ""; errorEl.hidden = !message; }
function normalizeText(value) { return String(value || "").toLowerCase().trim().replace(/\s+/g, " "); }

function normalizeStationList(body) {
  const source = body?.data ?? body;
  let raw = [];
  if (Array.isArray(source)) raw = source;
  else if (Array.isArray(source?.stations)) raw = source.stations;
  else if (Array.isArray(source?.results)) raw = source.results;
  else if (source && typeof source === "object") raw = Object.entries(source).map(([code, value]) =>
    typeof value === "object" && value ? { code, ...value } : { code, name: value }
  );

  return raw.map(item => {
    if (typeof item === "string") return { code: "", name: item, city: "" };
    const code = item?.code || item?.stationCode || item?.station_code || item?.stationCodeName || "";
    const name = item?.name || item?.stationName || item?.station_name || item?.label || code;
    const city = item?.city || item?.cityName || "";
    return { code: String(code).toUpperCase(), name: String(name), city: String(city) };
  }).filter(x => x.code || x.name);
}

function mergeStations(stations) {
  const map = new Map();
  [...FALLBACK_STATIONS, ...stations].forEach(s => {
    const key = s.code || `${normalizeText(s.name)}|${normalizeText(s.city)}`;
    if (!map.has(key)) map.set(key, s);
  });
  return [...map.values()].sort((a,b) => a.name.localeCompare(b.name));
}

function renderStations(stations, query = "") {
  resultsEl.hidden = false;
  listEl.innerHTML = "";
  if (!stations.length) {
    summaryEl.textContent = query ? `No railway station matched “${query}”.` : "No railway stations available.";
    listEl.innerHTML = `<div class="empty"><strong>No matching railway station found.</strong><p>Try a station name, city, or code such as <b>NDLS</b>.</p></div>`;
    return;
  }

  // Keep the initial DOM light; the full directory is still searchable in memory.
  const shown = stations.slice(0, 80);
  summaryEl.textContent = query
    ? `${stations.length.toLocaleString()} railway station${stations.length === 1 ? "" : "s"} found. Showing ${shown.length}.`
    : `${stations.length.toLocaleString()} railway stations available. Showing ${shown.length} — search to narrow the list.`;

  shown.forEach((s, index) => {
    const button = document.createElement("button");
    button.className = "station";
    button.type = "button";
    button.innerHTML = `<div class="stationMain"><div class="num">${index + 1}</div><div><div class="name">${escapeHtml(s.name)}</div><div class="meta">${escapeHtml(s.code || "No code")}${s.city ? ` · ${escapeHtml(s.city)}` : ""} · Indian Railways</div></div></div><div class="arrow">→</div>`;
    button.addEventListener("click", () => selectStation(s));
    listEl.appendChild(button);
  });
}

async function workerJson(path) {
  const response = await fetch(`${WORKER_BASE}${path}`, { cache: "no-store" });
  let body = null;
  try { body = await response.json(); } catch (_) {}
  if (!response.ok || body?.success === false) {
    const message = body?.error?.message || body?.error || `Worker request failed (HTTP ${response.status})`;
    throw new Error(String(message));
  }
  return body;
}

async function loadStationDirectory() {
  setError("");
  renderStations(allStations);
  statusEl.textContent = `Loading the complete Indian railway station directory…`;

  try {
    const body = await workerJson("/stations/directory");
    const remote = normalizeStationList(body);
    if (!remote.length) throw new Error("RailRadar returned an empty station directory.");
    allStations = mergeStations(remote);
    try { localStorage.setItem("traineta.stationDirectory.v1", JSON.stringify(allStations)); } catch (_) {}
    renderStations(allStations);
    statusEl.textContent = `${allStations.length.toLocaleString()} railway stations loaded. Search by station name, city, or code.`;
  } catch (error) {
    try {
      const cached = JSON.parse(localStorage.getItem("traineta.stationDirectory.v1") || "null");
      if (Array.isArray(cached) && cached.length > 100) {
        allStations = mergeStations(cached);
        renderStations(allStations);
        statusEl.textContent = `${allStations.length.toLocaleString()} railway stations loaded from saved directory. Live refresh unavailable.`;
        setError(`Live station directory could not be refreshed: ${error.message}`);
        return;
      }
    } catch (_) {}
    renderStations(allStations);
    statusEl.textContent = `${allStations.length} common railway stations shown. Live directory is unavailable.`;
    setError(`Could not load the full station directory. Check the Cloudflare Worker and RAILRADAR_API_KEY. ${error.message}`);
  }
}

async function searchStations() {
  const q = searchInput.value.trim();
  setError("");
  if (!q) {
    renderStations(allStations);
    statusEl.textContent = `${allStations.length.toLocaleString()} railway stations available.`;
    return;
  }

  const tokens = normalizeText(q).split(" ").filter(Boolean);
  const local = allStations.filter(s => {
    const hay = normalizeText(`${s.code} ${s.name} ${s.city}`);
    return tokens.every(token => hay.includes(token));
  });

  if (local.length) {
    renderStations(local, q);
    statusEl.textContent = `Search results for “${q}”.`;
    return;
  }

  // Fallback to RailRadar's server-side autocomplete if the local directory does not match.
  try {
    const body = await workerJson(`/stations/search?q=${encodeURIComponent(q)}&limit=50`);
    const remote = normalizeStationList(body);
    renderStations(remote, q);
    statusEl.textContent = remote.length ? `Search results for “${q}”.` : `No matching railway station found for “${q}”.`;
  } catch (error) {
    renderStations([], q);
    setError(`Station search is temporarily unavailable. ${error.message}`);
  }
}

function selectStation(station) {
  selectedStation = station;
  detailEl.hidden = false;
  detailEl.innerHTML = `
    <div class="detailHead">
      <div><h3>${escapeHtml(station.name)} (${escapeHtml(station.code || "—")})</h3><p class="meta">Railway station selected. Enter a 5-digit train number to see live status and ETA.</p></div>
      <button class="secondary small" id="closeDetail" type="button">Close</button>
    </div>
    <form id="trainForm" class="trainForm">
      <input id="trainInput" inputmode="numeric" maxlength="5" pattern="[0-9]{5}" placeholder="Enter 5-digit train number — e.g. 12919" aria-label="Train number" required>
      <button type="submit">Get Live ETA</button>
    </form>
    <div id="trainResult"></div>`;
  $("closeDetail").addEventListener("click", () => { detailEl.hidden = true; });
  $("trainForm").addEventListener("submit", e => { e.preventDefault(); loadLiveTrain($("trainInput").value.trim()); });
  $("trainInput").focus();
  detailEl.scrollIntoView({behavior:"smooth",block:"start"});
}

function formatTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("en-IN", { hour:"2-digit", minute:"2-digit" });
}
function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-IN", { dateStyle:"medium", timeStyle:"short" });
}
function stationRouteIndex(route, station) {
  if (!Array.isArray(route) || !station) return -1;
  const code = String(station.code || "").toUpperCase();
  if (code) {
    const i = route.findIndex(x => String(x.stationCode || "").toUpperCase() === code);
    if (i >= 0) return i;
  }
  const target = normalizeText(station.name).replace(/\b(junction|jn|railway|station|terminal|halt)\b/g, "").trim();
  return route.findIndex(x => normalizeText(x.stationName).replace(/\b(junction|jn|railway|station|terminal|halt)\b/g, "").trim() === target);
}

function calculateSelectedStationEta(data) {
  const route = Array.isArray(data?.route) ? data.route : [];
  const targetIndex = stationRouteIndex(route, selectedStation);
  if (targetIndex < 0) return { time:"—", minutes:null, note:"The selected station is not in this train's current route." };

  const target = route[targetIndex];
  const current = data?.currentLocation || {};
  const currentIndex = route.findIndex(x => String(x.stationCode || "").toUpperCase() === String(current.stationCode || "").toUpperCase());
  if (currentIndex >= 0 && targetIndex < currentIndex) return { time:"Passed", minutes:null, note:"This train has already passed the selected station." };

  let forecast = target.actualArrival ? new Date(target.actualArrival) : null;
  if (!forecast || Number.isNaN(forecast.getTime())) {
    const scheduled = target.scheduledArrival || target.scheduledDeparture;
    if (!scheduled) return { time:"—", minutes:null, note:"No arrival time is available from the live feed." };
    forecast = new Date(scheduled);
    const delay = Number(data?.delayMinutes);
    if (Number.isFinite(delay)) forecast = new Date(forecast.getTime() + delay * 60000);
  }

  if (currentIndex >= 0 && targetIndex > currentIndex) {
    const currentItem = route[currentIndex];
    const currentDistance = Number(currentItem.distance);
    const targetDistance = Number(target.distance);
    const speed = Number(current.speedKmh || current.speedToNextStationKmph || currentItem.speedToNextStationKmph);
    if (Number.isFinite(currentDistance) && Number.isFinite(targetDistance) && speed > 10) {
      let remaining = Math.max(0, targetDistance - currentDistance);
      const progress = Number(current.segmentProgress);
      if (Number.isFinite(progress) && progress >= 0 && progress <= 1 && currentIndex + 1 < route.length) {
        const nextDistance = Number(route[currentIndex + 1].distance);
        if (Number.isFinite(nextDistance) && nextDistance > currentDistance) {
          remaining = Math.max(0, targetDistance - (currentDistance + (nextDistance-currentDistance)*progress));
        }
      }
      const liveEta = new Date(Date.now() + (remaining / speed) * 60 * 60000 + (Number(data?.delayMinutes) || 0) * 60000);
      const scheduled = target.scheduledArrival || target.scheduledDeparture;
      if (scheduled) {
        const scheduledEta = new Date(new Date(scheduled).getTime() + (Number(data?.delayMinutes) || 0) * 60000);
        forecast = new Date(liveEta.getTime() * 0.65 + scheduledEta.getTime() * 0.35);
      } else forecast = liveEta;
    }
  }

  const minutes = Math.round((forecast.getTime() - Date.now()) / 60000);
  return { time: formatTime(forecast), minutes, note: minutes >= 0 ? `Estimated in about ${minutes} min.` : "Scheduled/live estimate has elapsed; refresh for the newest data." };
}

function renderLiveTrain(data) {
  const target = data?.route?.[stationRouteIndex(data.route, selectedStation)] || {};
  const train = data?.train || {};
  const current = data?.currentLocation || {};
  const next = data?.nextHalt || {};
  const eta = calculateSelectedStationEta(data);
  const delay = Number(data?.delayMinutes);
  const route = Array.isArray(data?.route) ? data.route : [];

  const routeHtml = route.map(item => {
    const isTarget = String(item.stationCode || "").toUpperCase() === String(selectedStation?.code || "").toUpperCase();
    const isCurrent = String(item.stationCode || "").toUpperCase() === String(current.stationCode || "").toUpperCase();
    const status = isCurrent ? "CURRENT" : isTarget ? "TARGET" : item.status || "";
    return `<div class="train"><b>${escapeHtml(item.stationName || item.stationCode || "Station")}${item.stationCode ? ` (${escapeHtml(item.stationCode)})` : ""}</b><span>${escapeHtml(status)} · Arrival ${escapeHtml(formatTime(item.actualArrival || item.scheduledArrival))} · Departure ${escapeHtml(formatTime(item.actualDeparture || item.scheduledDeparture))}${item.platform ? ` · PF ${escapeHtml(item.platform)}` : ""}</span></div>`;
  }).join("");

  $("trainResult").innerHTML = `
    <div class="etaHero">
      <div><div class="eyebrow">LIVE ETA</div><div class="etaValue">${escapeHtml(eta.time)}</div><p>${escapeHtml(eta.note)}</p></div>
      <div class="etaBadge">${data?.isLive ? "LIVE" : "NOT LIVE"}</div>
    </div>
    <div class="liveGrid">
      <div><span>Train</span><b>${escapeHtml(data?.trainNumber || currentTrainNumber)} · ${escapeHtml(data?.trainName || train.name || "Unknown Train")}</b></div>
      <div><span>Selected station</span><b>${escapeHtml(selectedStation.name)} (${escapeHtml(selectedStation.code || "—")})</b></div>
      <div><span>Current location</span><b>${escapeHtml(current.stationCode || current.stationName || "Unavailable")}</b></div>
      <div><span>Next halt</span><b>${escapeHtml(next.stationName || next.stationCode || "Unavailable")}</b></div>
      <div><span>Speed</span><b>${Number.isFinite(Number(current.speedKmh)) ? `${Number(current.speedKmh).toFixed(1)} km/h` : "—"}</b></div>
      <div><span>Delay</span><b>${Number.isFinite(delay) ? `${delay} min` : "—"}</b></div>
      <div><span>Scheduled arrival</span><b>${escapeHtml(formatTime(target.scheduledArrival))}</b></div>
      <div><span>Last updated</span><b>${escapeHtml(formatDateTime(data?.lastUpdatedAt))}</b></div>
    </div>
    <div class="routeTitle">Journey route</div>
    <div>${routeHtml || `<div class="empty">Route data is not available.</div>`}</div>
    <button class="secondary refreshLive" id="refreshLive" type="button">Refresh live data</button>`;
  $("refreshLive").addEventListener("click", () => loadLiveTrain(currentTrainNumber));
}

async function loadLiveTrain(value) {
  const number = String(value || "").replace(/\D/g, "");
  if (!/^\d{5}$/.test(number)) {
    $("trainResult").innerHTML = `<p class="boardError">Please enter a valid 5-digit train number.</p>`;
    return;
  }
  currentTrainNumber = number;
  $("trainResult").innerHTML = `<div class="empty">Fetching live train data for ${number}…</div>`;
  try {
    const body = await workerJson(`/train/${number}/live?authoritative=true`);
    const data = body?.data || body;
    if (!data || data.success === false) throw new Error(data?.error || "No train data returned.");
    renderLiveTrain(data);
  } catch (error) {
    $("trainResult").innerHTML = `<div class="empty"><strong>Live train data could not be loaded.</strong><p>${escapeHtml(error.message)}</p><p>Check the train number, RailRadar API quota, and Cloudflare secret.</p></div>`;
  }
}

searchBtn.addEventListener("click", searchStations);
searchInput.addEventListener("input", searchStations);
clearBtn.addEventListener("click", () => { searchInput.value = ""; searchStations(); searchInput.focus(); });
searchInput.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); searchStations(); } });

// Firebase analytics is optional and must never block the railway app.
(async () => {
  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js");
    const { getAnalytics, isSupported } = await import("https://www.gstatic.com/firebasejs/12.7.0/firebase-analytics.js");
    const firebaseApp = initializeApp(firebaseConfig);
    if (await isSupported()) getAnalytics(firebaseApp);
  } catch (_) {}
})();

loadStationDirectory();
