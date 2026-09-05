/**
 * TrainETA Cloudflare Worker
 *
 * Required Cloudflare Worker Secret:
 *   RAILRADAR_API_KEY
 *
 * Public routes used by GitHub Pages:
 *   GET /health
 *   GET /stations/directory
 *   GET /stations/search?q=NDLS&limit=50
 *   GET /train-station-board?code=NDLS
 *   GET /train/12919/live
 */

const RAILRADAR_BASE = "https://api.railradar.in/v1";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...CORS }
  });
}

async function railRadar(path, env) {
  const key = env.RAILRADAR_API_KEY;
  if (!key) throw Object.assign(new Error("RAILRADAR_API_KEY is missing in Cloudflare Worker Secrets."), { status: 500 });
  const response = await fetch(`${RAILRADAR_BASE}${path}`, {
    headers: { Authorization: `Bearer ${key}`, Accept: "application/json" }
  });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch (_) { body = { success: false, error: text || "Invalid RailRadar response" }; }
  if (!response.ok) {
    const message = body?.error?.message || body?.error || `RailRadar HTTP ${response.status}`;
    throw Object.assign(new Error(String(message)), { status: response.status });
  }
  return body;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method !== "GET") return json({ success: false, error: "Method not allowed" }, 405);

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (path === "/" || path === "/health") {
      return json({ success: true, service: "TrainETA Worker", status: "ok" });
    }

    if (path === "/stations/directory" || path === "/api/stations/directory") {
      try {
        const body = await railRadar("/lookup/stations", env);
        return json(body);
      } catch (error) {
        return json({ success: false, error: error.message }, error.status || 502);
      }
    }

    if (path === "/stations/search" || path === "/api/stations/search") {
      const q = String(url.searchParams.get("q") || "").trim();
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 20), 5), 50);
      if (!q) return json({ success: true, data: [] });
      try {
        return json(await railRadar(`/lookup/search/stations?q=${encodeURIComponent(q)}&limit=${limit}`, env));
      } catch (error) {
        return json({ success: false, error: error.message }, error.status || 502);
      }
    }

    if (path === "/train-station-board") {
      const code = String(url.searchParams.get("code") || "").trim().toUpperCase();
      if (!/^[A-Z0-9]{1,10}$/.test(code)) return json({ success: false, error: "Valid station code is required." }, 400);
      try {
        return json(await railRadar(`/stations/${encodeURIComponent(code)}/trains`, env));
      } catch (error) {
        return json({ success: false, error: error.message }, error.status || 502);
      }
    }

    const liveMatch = path.match(/^\/train\/(\d{5})\/live$/);
    if (liveMatch) {
      try {
        const query = url.search ? url.search : "";
        return json(await railRadar(`/trains/${liveMatch[1]}/live${query}`, env));
      } catch (error) {
        return json({ success: false, error: error.message }, error.status || 502);
      }
    }

    return json({
      success: false,
      error: "Route not found",
      routes: ["/health", "/stations/directory", "/stations/search?q=NDLS", "/train-station-board?code=NDLS", "/train/12919/live"]
    }, 404);
  }
};
