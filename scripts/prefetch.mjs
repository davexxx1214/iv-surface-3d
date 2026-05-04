import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { DEFAULT_STOCK_POOL } from '../src/stockPool.js';

const rootDir = process.cwd();
const cacheDir = path.join(rootDir, '.cache', 'alphavantage');
const symbols = process.argv.slice(2).map((symbol) => symbol.toUpperCase());
const targets = symbols.length ? symbols : DEFAULT_STOCK_POOL;
const delayMs = Number(process.env.PREFETCH_DELAY_MS || 0);
const results = [];

await mkdir(cacheDir, { recursive: true });

const config = YAML.parse(await readFile(path.join(rootDir, 'config.yaml'), 'utf8'));
const apiKey = config?.alphavantage?.api_key || process.env.ALPHAVANTAGE_API_KEY;

if (!apiKey) {
  throw new Error('Missing alphavantage.api_key in config.yaml.');
}

for (const [index, symbol] of targets.entries()) {
  const normalizedSymbol = symbol === 'NVDIA' ? 'NVDA' : symbol;

  try {
    const url = new URL('https://www.alphavantage.co/query');
    url.searchParams.set('function', 'HISTORICAL_OPTIONS');
    url.searchParams.set('symbol', normalizedSymbol);
    url.searchParams.set('apikey', String(apiKey).trim());

    const response = await fetch(url);
    const raw = await response.json();

    if (!response.ok || raw['Error Message'] || raw.Note || raw.Information) {
      const message = raw['Error Message'] || raw.Note || raw.Information || `HTTP ${response.status}`;
      throw new Error(message);
    }

    const records = getRecords(raw);
    const payload = {
      meta: {
        symbol: normalizedSymbol,
        requestedDate: null,
        resolvedDate: getRecordDate(records),
        source: 'Alpha Vantage HISTORICAL_OPTIONS',
        fetchedAt: new Date().toISOString(),
        cached: false
      },
      raw
    };

    const cachePath = path.join(cacheDir, `${normalizedSymbol}_latest.json`);
    await writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf8');

    const expirations = new Set(records.map((record) => record.expiration).filter(Boolean));
    results.push({ symbol: normalizedSymbol, ok: true, records: records.length, expirations: expirations.size });
    console.log(`${normalizedSymbol}: ${records.length} contracts, ${expirations.size} expirations cached.`);
  } catch (error) {
    const message = error.message || 'Unknown error';
    results.push({ symbol: normalizedSymbol, ok: false, error: message });
    console.error(`${normalizedSymbol}: failed - ${message}`);
  }

  if (delayMs > 0 && index < targets.length - 1) {
    await delay(delayMs);
  }
}

const succeeded = results.filter((result) => result.ok);
const failed = results.filter((result) => !result.ok);
const contractCount = succeeded.reduce((sum, result) => sum + result.records, 0);

console.log(
  `Prefetch complete: ${succeeded.length}/${targets.length} symbols cached, ` +
    `${contractCount} contracts total, ${failed.length} failed.`
);

if (failed.length) {
  process.exitCode = 1;
}

function getRecords(raw) {
  if (Array.isArray(raw?.data)) {
    return raw.data;
  }

  if (Array.isArray(raw?.options)) {
    return raw.options;
  }

  return [];
}

function getRecordDate(records) {
  return records.find((record) => /^\d{4}-\d{2}-\d{2}$/.test(String(record.date)))?.date || null;
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
