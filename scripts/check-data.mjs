import { readFile } from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const symbols = process.argv.slice(2).map((symbol) => symbol.toUpperCase());
const targets = symbols.length ? symbols : ['AAPL', 'NVDA'];

for (const symbol of targets) {
  const cachePath = path.join(rootDir, '.cache', 'alphavantage', `${symbol}_latest.json`);
  const payload = JSON.parse(await readFile(cachePath, 'utf8'));
  const records = Array.isArray(payload.raw?.data) ? payload.raw.data : [];
  const expirations = new Set(records.map((record) => record.expiration).filter(Boolean));
  const strikes = records.map((record) => Number(record.strike)).filter(Number.isFinite);
  const ivs = records
    .map((record) => Number(record.implied_volatility))
    .filter((value) => Number.isFinite(value) && value > 0);

  console.log(
    `${symbol}: ${records.length} contracts, ${expirations.size} expirations, ` +
      `strike ${Math.min(...strikes)}-${Math.max(...strikes)}, ` +
      `IV ${(Math.min(...ivs) * 100).toFixed(1)}%-${(Math.max(...ivs) * 100).toFixed(1)}%.`
  );
}
