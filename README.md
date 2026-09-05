# TrainETA

Indian Railway station search and live train ETA application.

## User flow

1. The app requests **no browser location permission**.
2. The complete Indian railway station directory is loaded through the Cloudflare Worker.
3. The user can search by station name, city, or station code.
4. The user selects a railway station.
5. The user enters a 5-digit train number.
6. TrainETA requests live running data through Cloudflare and calculates the ETA for the selected station from the live route, current position, speed, schedule, and delay data when available.

## Important

- Metro/subway location permission is not used.
- RailRadar API secrets are never placed in the frontend.
- The Cloudflare Worker requires the secret `RAILRADAR_API_KEY`.
- The frontend is designed for GitHub Pages.
- The default Worker URL is `https://traineta.bharatchandrasirala.workers.dev`.

## Firebase

Firebase Web App configuration is already included in `app.js` for the TrainETA Firebase project. Firebase Analytics is optional and never blocks the railway functionality.

## Cloudflare

Worker file: `worker.js`
Configuration: `wrangler.toml`

Required secret:

`RAILRADAR_API_KEY`
