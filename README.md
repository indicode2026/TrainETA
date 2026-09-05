# TrainETA

Indian Railway station search and live train ETA application.

## User flow

1. No browser location permission is requested.
2. The complete railway station directory is loaded through the Cloudflare Worker.
3. The user can search by station name, city, or station code.
4. The user selects a railway station.
5. The user enters a 5-digit train number.
6. TrainETA requests live running data through Cloudflare and shows live status/ETA when RailRadar supplies it.

## Railway stations

The station directory uses RailRadar's railway-station lookup API. Metro/subway location
permission is not used.

## Cloudflare

Worker file: `worker.js`

Required secret:

`RAILRADAR_API_KEY`

Worker URL:

`https://traineta.bharatchandrasirala.workers.dev`

After adding/changing the secret in Cloudflare, deploy/redeploy the Worker.

### Health check

Open:

`https://traineta.bharatchandrasirala.workers.dev/health`

The response should include:

`"railRadarSecretConfigured": true`

### Station directory

`/stations/directory`

### Station search

`/stations/search?q=NDLS&limit=10`

### Live train

`/train/12919/live?authoritative=true`

## Firebase

Firebase Web App configuration is included for optional Analytics. It does not block
railway functionality.

## Security

Never put the RailRadar secret in `app.js`, GitHub, or any public frontend file.

## Presentation demo mode

If RailRadar live data is unavailable, the frontend can show clearly labelled sample data for these NDLS demo train numbers: **12002, 12951, 12309, 12424, 12434**. Demo data is shown only after selecting **New Delhi (NDLS)** and is explicitly marked as DEMO DATA; it must not be presented as real-time information.
