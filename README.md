# IV Surface 3D

Interactive 3D implied volatility surface viewer for US equity and ETF options.

The app lets you pick a ticker and a historical snapshot date, fetches the full option chain from Alpha Vantage, and renders call IV, put IV, or average IV as a 3D surface. You can rotate the surface, zoom in, hover over points, and inspect the normalized chain slice next to the chart.

Chinese documentation is available in [README_cn.md](README_cn.md).

## Current Status

- Express serves the API and static frontend.
- Three.js renders the 3D IV surface in the browser.
- The backend reads `alphavantage.api_key` from `config.yaml`, so the browser never sees the API key.
- `/api/options` proxies Alpha Vantage `HISTORICAL_OPTIONS`.
- The ticker control uses the default stock pool in `src/stockPool.js`.
- Changing the ticker or snapshot date loads data automatically.
- The app can switch between `Average IV`, `Call IV`, and `Put IV`.
- The cache currently contains the full default ticker pool: 102 symbols and 198,702 option contracts.

## Quick Start

Install dependencies:

```bash
npm install
```

Prefetch the default ticker pool:

```bash
npm run prefetch
```

Run the local app:

```bash
npm start
```

Open:

```text
http://localhost:5173
```

To prefetch only a few symbols, pass them after `--`:

```bash
npm run prefetch -- AAPL NVDA QQQ
```

## Configuration

Create or update `config.yaml`:

```yaml
alphavantage:
  api_key: "YOUR_ALPHA_VANTAGE_API_KEY"
```

The app also supports `ALPHAVANTAGE_API_KEY` from the environment.

## Default Ticker Pool

The default ticker pool lives in `src/stockPool.js`. It contains the NASDAQ 100 style list supplied for this project plus `QQQ`. The current list has 102 unique symbols.

The frontend fills the `Ticker` select box from that file. The prefetch script uses the same file when you run `npm run prefetch` with no explicit symbols.

## Data Source

The app uses Alpha Vantage Options Data API:

```text
https://www.alphavantage.co/query?function=HISTORICAL_OPTIONS&symbol={ticker}&date={as_of_date}&apikey={ALPHAVANTAGE_API_KEY}
```

`date` is optional. When omitted, Alpha Vantage returns the latest available historical option chain. When supplied, the app uses that date as the snapshot date and as the base date for DTE calculations.

## Data Flow

1. The browser sends `symbol`, optional `date`, and fallback mode to `/api/options`.
2. The Express backend normalizes the ticker and date.
3. The backend checks `.cache/alphavantage`.
4. If no fresh cache entry exists, the backend calls Alpha Vantage.
5. The frontend groups contracts by `expiration + strike`, merges call and put rows, calculates DTE and average IV, then renders the surface.

## Core Fields

| Field | Meaning | Example | Used For |
| --- | --- | --- | --- |
| Ticker | Underlying symbol | `NVDA`, `AAPL`, `QQQ` | API request and chart title |
| Snapshot Date | Historical option chain date | `2026-05-01` | Alpha Vantage `date`, DTE base |
| Expiration | Option expiration date | `2026-05-08` | DTE axis |
| DTE | Days to expiration | `4`, `11`, `18` | Term structure |
| Strike | Option strike price | `50` to `350` | Strike axis |
| Call IV | Call implied volatility | `0.35` | Call surface mode |
| Put IV | Put implied volatility | `0.41` | Put surface mode |
| Average IV | Average of call and put IV | `0.38` | Default surface mode |
| Open Interest | Contract open interest | `1200` | Hover details |

## UI

The top control strip contains:

- `Ticker`: select a symbol from the default pool. Selection loads data immediately.
- `Snapshot`: choose a historical date. Date changes load data immediately.
- `Surface`: switch between average, call, and put IV without refetching.
- `Reset View`: restore the 3D camera after rotating or zooming.

The main workspace contains:

- A Three.js 3D IV surface.
- Summary metrics for expirations, point count, average IV, IV range, and strike range.
- A sortable option chain table.
- A hover tooltip for expiration, DTE, strike, IV, and open interest.

## Scripts

```bash
npm start
```

Starts the Express server on `http://localhost:5173`.

```bash
npm run prefetch
```

Fetches and caches the full default ticker pool.

```bash
npm run prefetch -- AAPL NVDA
```

Fetches and caches only the supplied tickers.

```bash
npm run check
```

Reads cached option data and prints a short summary for selected symbols. If no symbols are supplied, it checks the script defaults.

## Cache Layout

Cached Alpha Vantage responses are stored under:

```text
.cache/alphavantage/
```

Examples:

```text
NVDA_latest.json
AAPL_2026-05-01.json
QQQ_latest.json
```

The backend ignores empty cached responses and refreshes stale latest-cache entries after 24 hours.

## Notes

- This project uses historical option chains, not live option quotes.
- DTE uses `expiration - snapshot_date`, not the current date.
- The default surface filters out very short DTE records and invalid IV values before rendering.
- A few symbols have custom view windows in `src/app.js`; other symbols use the generic strike and DTE window.
