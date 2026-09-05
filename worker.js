/**
 * TrainETA Cloudflare Worker
 * RailRadar API stays server-side.
 *
 * Required Cloudflare Worker Secret:
 *   RAILRADAR_API_KEY
 *
 * Routes:
 *   GET /
 *   GET /health
 *   GET /stations/directory
 *   GET /stations/search?q=NDLS&limit=50
 *   GET /train-station-board?code=NDLS
 *   GET /train/12919/live?authoritative=true
 */

const RAILRADAR_BASE = "https://api.railradar.in/v1";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Cache-Control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS
    }
  });
}

function getApiKey(env) {
  // Primary name required by this project. The second name is accepted only
  // as a compatibility fallback for an older deployment.
  const value = env?.RAILRADAR_API_KEY ?? env?.RAILRADAR_KEY;
  return typeof value === "string" ? value.trim() : "";
}

async function railRadar(path, env) {
  const key = getApiKey(env);

  if (!key) {
    throw Object.assign(
      new Error(
        "RAILRADAR_API_KEY is not available to this deployed Worker. " +
        "Add the secret to the traineta Worker in Settings → Variables and Secrets, then deploy/redeploy."
      ),
      { status: 500, code: "MISSING_RAILRADAR_SECRET" }
    );
  }

  const response = await fetch(`${RAILRADAR_BASE}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json"
    }
  });

  const text = await response.text();
  let body;

  try {
    body = JSON.parse(text);
  } catch {
    body = {
      success: false,
      error: text || "Invalid RailRadar response"
    };
  }

  if (!response.ok || body?.success === false) {
    const message =
      body?.error?.message ||
      body?.error ||
      `RailRadar HTTP ${response.status}`;

    throw Object.assign(new Error(String(message)), {
      status: response.status,
      code: response.status === 401 ? "INVALID_RAILRADAR_KEY" :
            response.status === 429 ? "RAILRADAR_QUOTA" :
            response.status === 404 ? "RAILRADAR_NOT_FOUND" :
            "RAILRADAR_ERROR"
    });
  }

  return body;
}

function stationArray(body) {
  const source = body?.data ?? body;
  if (Array.isArray(source)) return source;

  if (source && typeof source === "object") {
    if (Array.isArray(source.stations)) return source.stations;
    if (Array.isArray(source.results)) return source.results;

    // /lookup/stations is a { CODE: "Station Name" } dictionary.
    return Object.entries(source).map(([code, value]) => {
      if (typeof value === "string") {
        return { code, name: value, city: "" };
      }
      if (value && typeof value === "object") {
        return {
          code,
          ...value,
          code: value.code || value.stationCode || code
        };
      }
      return { code, name: String(value ?? "") };
    });
  }

  return [];
}

function normalizeStations(body) {
  return stationArray(body)
    .map(item => {
      if (typeof item === "string") {
        return { code: "", name: item, city: "" };
      }

      const code =
        item?.code ||
        item?.stationCode ||
        item?.station_code ||
        "";

      const name =
        item?.name ||
        item?.stationName ||
        item?.station_name ||
        item?.label ||
        code;

      const city =
        item?.city ||
        item?.cityName ||
        "";

      return {
        code: String(code).trim().toUpperCase(),
        name: String(name).trim(),
        city: String(city).trim()
      };
    })
    .filter(item => item.code || item.name);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: CORS
      });
    }

    if (request.method !== "GET") {
      return json({ success: false, error: "Method not allowed" }, 405);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    // Health intentionally does NOT call RailRadar.
    if (path === "/" || path === "/health") {
      return json({
        success: true,
        service: "TrainETA Worker",
        status: "ok",
        railRadarSecretConfigured: Boolean(getApiKey(env))
      });
    }

    if (path === "/stations/directory" || path === "/api/stations/directory") {
      try {
        const body = await railRadar("/lookup/stations", env);
        const stations = normalizeStations(body);

        return json({
          success: true,
          data: stations,
          count: stations.length,
          source: "RailRadar station directory"
        });
      } catch (error) {
        return json({
          success: false,
          code: error.code || "STATION_DIRECTORY_ERROR",
          error: error.message
        }, error.status || 502);
      }
    }

    if (path === "/stations/search" || path === "/api/stations/search") {
      const q = String(url.searchParams.get("q") || "").trim();
      const limitRaw = Number(url.searchParams.get("limit") || 20);
      const limit = Math.min(
        Math.max(Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 20, 5),
        50
      );

      if (!q) {
        return json({ success: true, data: [] });
      }

      try {
        const body = await railRadar(
          `/lookup/search/stations?q=${encodeURIComponent(q)}&limit=${limit}`,
          env
        );
        return json(body);
      } catch (error) {
        return json({
          success: false,
          code: error.code || "STATION_SEARCH_ERROR",
          error: error.message
        }, error.status || 502);
      }
    }

    if (path === "/train-station-board") {
      const code = String(
        url.searchParams.get("code") || ""
      ).trim().toUpperCase();

      if (!/^[A-Z0-9]{1,10}$/.test(code)) {
        return json({
          success: false,
          error: "Valid station code is required."
        }, 400);
      }

      try {
        const body = await railRadar(
          `/stations/${encodeURIComponent(code)}/trains`,
          env
        );
        return json(body);
      } catch (error) {
        return json({
          success: false,
          code: error.code || "STATION_BOARD_ERROR",
          error: error.message
        }, error.status || 502);
      }
    }

    const liveMatch = path.match(/^\/train\/(\d{5})\/live$/);

    if (liveMatch) {
      try {
        const query = url.search || "";
        const body = await railRadar(
          `/trains/${liveMatch[1]}/live${query}`,
          env
        );
        return json(body);
      } catch (error) {
        return json({
          success: false,
          code: error.code || "LIVE_TRAIN_ERROR",
          error: error.message
        }, error.status || 502);
      }
    }

    return json({
      success: false,
      error: "Route not found",
      routes: [
        "/health",
        "/stations/directory",
        "/stations/search?q=NDLS&limit=10",
        "/train-station-board?code=NDLS",
        "/train/12919/live?authoritative=true"
      ]
    }, 404);
  }
};
