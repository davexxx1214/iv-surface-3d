import express from 'express';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = __dirname;
const cacheDir = path.join(rootDir, '.cache', 'alphavantage');
const app = express();
const port = Number(process.env.PORT || 5173);
const alphaVantageBaseUrl = 'https://www.alphavantage.co/query';

app.use('/node_modules', express.static(path.join(rootDir, 'node_modules')));
app.use(express.static(rootDir));

app.get('/api/options', async (req, res) => {
  try {
    const symbol = normalizeSymbol(req.query.symbol);
    const requestedDate = normalizeOptionalDate(req.query.date);
    const fallback = req.query.fallback === 'previous';
    const data = await getHistoricalOptions(symbol, requestedDate, { fallback });
    res.json(data);
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.message || 'Unable to load options data.' });
  }
});

app.get('/api/samples', async (_req, res) => {
  try {
    const symbols = ['AAPL', 'NVDA'];
    const results = [];

    for (const symbol of symbols) {
      const data = await getHistoricalOptions(symbol, null);
      results.push(summarizeChain(symbol, data));
    }

    res.json({ samples: results });
  } catch (error) {
    const status = error.statusCode || 500;
    res.status(status).json({ error: error.message || 'Unable to load sample data.' });
  }
});

app.listen(port, () => {
  console.log(`IV Surface 3D running at http://localhost:${port}`);
});

async function getHistoricalOptions(symbol, requestedDate, options = {}) {
  if (requestedDate && options.fallback) {
    return getHistoricalOptionsWithFallback(symbol, requestedDate);
  }

  return getHistoricalOptionsForDate(symbol, requestedDate, requestedDate);
}

async function getHistoricalOptionsWithFallback(symbol, requestedDate) {
  const maxLookbackDays = 10;

  for (let offset = 0; offset <= maxLookbackDays; offset += 1) {
    const candidateDate = shiftIsoDate(requestedDate, -offset);
    const data = await getHistoricalOptionsForDate(symbol, candidateDate, requestedDate);
    const records = getRecords(data.raw);

    if (records.length > 0) {
      return {
        ...data,
        meta: {
          ...data.meta,
          requestedDate,
          resolvedDate: getRecordDate(records) || candidateDate,
          fallbackUsed: candidateDate !== requestedDate
        }
      };
    }
  }

  return getHistoricalOptionsForDate(symbol, requestedDate, requestedDate);
}

async function getHistoricalOptionsForDate(symbol, requestedDate, originalRequestedDate) {
  await mkdir(cacheDir, { recursive: true });
  const cacheKey = `${symbol}_${requestedDate || 'latest'}.json`;
  const cachePath = path.join(cacheDir, cacheKey);
  const cached = await readCache(cachePath);

  if (cached) {
    return { ...cached, meta: { ...cached.meta, cached: true } };
  }

  const apiKey = await readAlphaVantageKey();
  const url = new URL(alphaVantageBaseUrl);
  url.searchParams.set('function', 'HISTORICAL_OPTIONS');
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('apikey', apiKey);

  if (requestedDate) {
    url.searchParams.set('date', requestedDate);
  }

  const response = await fetch(url);

  if (!response.ok) {
    throw httpError(`Alpha Vantage returned HTTP ${response.status}.`, response.status);
  }

  const raw = await response.json();

  if (raw['Error Message']) {
    throw httpError(raw['Error Message'], 502);
  }

  if (raw.Note || raw.Information) {
    throw httpError(raw.Note || raw.Information, 429);
  }

  const payload = {
    meta: {
      symbol,
      requestedDate: originalRequestedDate || requestedDate || null,
      resolvedDate: getRecordDate(getRecords(raw)) || requestedDate || null,
      fallbackUsed: Boolean(originalRequestedDate && requestedDate && originalRequestedDate !== requestedDate),
      source: 'Alpha Vantage HISTORICAL_OPTIONS',
      fetchedAt: new Date().toISOString(),
      cached: false
    },
    raw
  };

  if (getRecords(raw).length > 0) {
    await writeFile(cachePath, JSON.stringify(payload, null, 2), 'utf8');
  }

  return payload;
}

function shiftIsoDate(date, dayOffset) {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + dayOffset));
  return shifted.toISOString().slice(0, 10);
}

function getRecordDate(records) {
  return records.find((record) => /^\d{4}-\d{2}-\d{2}$/.test(String(record.date)))?.date || null;
}

async function readCache(cachePath) {
  try {
    const cacheStat = await stat(cachePath);
    const ageMs = Date.now() - cacheStat.mtimeMs;
    const maxAgeMs = 1000 * 60 * 60 * 24;

    if (ageMs > maxAgeMs) {
      return null;
    }

    const content = await readFile(cachePath, 'utf8');
    const cached = JSON.parse(content);

    if (getRecords(cached.raw).length === 0) {
      return null;
    }

    return cached;
  } catch {
    return null;
  }
}

async function readAlphaVantageKey() {
  if (process.env.ALPHAVANTAGE_API_KEY) {
    return process.env.ALPHAVANTAGE_API_KEY;
  }

  const configPath = path.join(rootDir, 'config.yaml');
  const content = await readFile(configPath, 'utf8');
  const config = YAML.parse(content);
  const apiKey = config?.alphavantage?.api_key || config?.alphavantage?.apikey;

  if (!apiKey) {
    throw httpError('Missing alphavantage.api_key in config.yaml.', 500);
  }

  return String(apiKey).trim();
}

function normalizeSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  const aliases = new Map([['NVDIA', 'NVDA']]);
  const normalized = aliases.get(symbol) || symbol;

  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized)) {
    throw httpError('Invalid symbol.', 400);
  }

  return normalized;
}

function normalizeOptionalDate(value) {
  if (!value) {
    return null;
  }

  const date = String(value).trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw httpError('Date must use YYYY-MM-DD format.', 400);
  }

  return date;
}

function summarizeChain(symbol, data) {
  const records = getRecords(data.raw);
  const expirations = new Set(records.map((record) => record.expiration).filter(Boolean));
  const strikes = records.map((record) => Number(record.strike)).filter(Number.isFinite);
  const ivs = records
    .map((record) => Number(record.implied_volatility))
    .filter((value) => Number.isFinite(value) && value > 0);

  return {
    symbol,
    requestedDate: data.meta.requestedDate,
    cached: data.meta.cached,
    recordCount: records.length,
    expirationCount: expirations.size,
    strikeMin: strikes.length ? Math.min(...strikes) : null,
    strikeMax: strikes.length ? Math.max(...strikes) : null,
    ivMin: ivs.length ? Math.min(...ivs) : null,
    ivMax: ivs.length ? Math.max(...ivs) : null,
    fetchedAt: data.meta.fetchedAt
  };
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

function httpError(message, statusCode) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
