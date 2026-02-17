# Firefly — FIRE Tracker

A **GBP/UK** personal finance web app focused on **Financial Independence, Retire Early (FIRE)** goal tracking, investment portfolios, expenses, and debt/mortgage management.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

**Yahoo Finance (no API key):** The app tries Yahoo first for quotes. In the browser Yahoo is often blocked by CORS, so run the optional **API server** in a second terminal so the server fetches from Yahoo:

```bash
npm run server
```

With both `npm run dev` and `npm run server` running, Vite proxies `/api` to the server and Yahoo quotes work without CORS. In Docker/production the same server serves the app and `/api/quote`.

**Daily snapshot (today’s gain):** The server stores synced UK holdings in SQLite and, at **23:59 server time**, fetches prices from Yahoo, computes portfolio value, and saves a snapshot. The Dashboard fetches `/api/snapshots` and shows **today’s gain** as market movement (current value vs yesterday’s EOD). Holdings are synced to the server when you open the Dashboard (debounced). No need to open the app daily for the 23:59 snapshot.

## Build

```bash
npm run build
npm run preview   # serve production build
```

## What’s included

- **Dashboard** — UK portfolio totals (with XIRR-style gain %), grand total in GBP, emergency fund progress, FIRE progress (UK £1M and 30x expenses), portfolio growth chart, current vs ideal allocation pie chart.
- **Investments** — UK portfolio is **added by you**. For each holding you choose **Exchange** (NASDAQ, LSE) and **Symbol**; the app fetches live price in this order: **[Yahoo Finance](https://finance.yahoo.com)** (free, no key; run `npm run server` in dev so the backend fetches Yahoo and avoids CORS), then [Twelve Data](https://twelvedata.com), then [Alpha Vantage](https://www.alphavantage.co) for LSE ETFs not on Twelve Data’s free tier. Add/remove holdings; refresh price per row or “Refresh all”. Store Twelve Data and/or Alpha Vantage API keys in **More → Settings** (or `VITE_TWELVEDATA_KEY` / `VITE_ALPHA_VANTAGE_KEY` in `.env`) if Yahoo is unavailable.
- **Expenses** — Expense journal (list) and budget view using UK budget categories.
- **Goals** — FIRE calculator (current combined portfolio, target from 25x/30x/50x, monthly savings, growth rate, years to FIRE, projection chart), emergency fund progress, placeholder for savings goals.
- **More** — Debt list (total + per-item), mortgage summary, SIP list, placeholders for reports and settings.

## Tech stack

- **React 18** + **TypeScript** + **Vite**
- **Tailwind CSS** for styling (primary blue, success/warning/error colours, dark mode ready)
- **Recharts** for line and pie charts
- **React Router** for navigation
- **lucide-react** for icons

## Data

Data is stored in the browser’s **localStorage** (holdings, budgets, cash-added dates, API keys). Sample data in `src/data/sampleData.ts` is used only when nothing is saved yet. When the **server** is running, it keeps a copy of UK holdings and **daily snapshots** in SQLite (`server/firefly.db`) for the 23:59 job and for “today’s gain” (market movement vs yesterday).

## Deploy to production

**No database needed.** The app is a static SPA; all state lives in the browser (localStorage).

### Option 1: Docker (one container)

One container is enough: it builds the app and serves the static files with nginx.

```bash
docker build -t firefly .
docker run -p 8080:80 firefly
```

Open [http://localhost:8080](http://localhost:8080).

#### Docker Hub & running on NAS

Image on Docker Hub: **`lforlinux/firefly`**.

**Tagging:** Each release is tagged with the app version from `package.json` (e.g. `v0.0.1`) and `latest`. Use version tags for reproducible deploys; use `latest` for “current” builds.

**Build and push from your machine:** Push builds for **linux/amd64** and **linux/arm64** so the same image runs on Synology NAS (amd64) and Apple Silicon (arm64).

```bash
# Build and tag only for your current platform (no push)
./scripts/docker-build-push.sh

# Build multi-platform and push to Docker Hub (run once: docker login -u lforlinux)
./scripts/docker-build-push.sh push
```

**On your NAS** (or any host with Docker):

```bash
docker pull lforlinux/firefly:latest
docker run -d -p 8080:80 --name firefly --restart unless-stopped lforlinux/firefly:latest
```

Or pin to a version:

```bash
docker pull lforlinux/firefly:v0.0.4
docker run -d -p 8080:80 --name firefly --restart unless-stopped lforlinux/firefly:v0.0.4
```

Then open `http://<nas-ip>:8080` (or the port you mapped, e.g. `9765` if using the compose file). `--restart unless-stopped` makes the container start again after a reboot.

**Using docker-compose on NAS (no clone needed):** Copy only `docker-compose.yml` to your Synology (or any host). Run `docker compose up -d`; it will pull the image from Docker Hub. No need to clone the repo on the NAS.

```bash
docker compose up -d
```

Port **9765** is exposed (host) → 80 (container); change the left number in `docker-compose.yml` if needed. Stop with `docker compose down`.

**Releases (e.g. when pushing to Git):** Bump `version` in `package.json`, then run `./scripts/docker-build-push.sh push`. Optionally create a Git tag (e.g. `git tag v0.0.1 && git push origin v0.0.1`) so the repo and image versions stay in sync.

### Option 2: Static hosting (no Docker)

Build and upload the `dist/` folder to any static host:

```bash
npm run build
# Upload contents of dist/ to:
# - Vercel: vercel deploy --prod
# - Netlify: drag dist/ to Netlify or connect Git
# - AWS S3 + CloudFront, GitHub Pages, etc.
```

No server or database to manage; each user’s data stays in their browser.

---

## Possible next steps

- Add/Edit/Delete holdings, expenses, budgets, debts, SIPs
- CSV import for transactions and holdings
- Live price APIs
- Mortgage amortization table and extra-payment impact
- Rebalancing suggestions from current vs ideal allocation
- Insurance, house deposit, and savings goal modules
- Auth, persistence (e.g. localStorage or backend DB)
