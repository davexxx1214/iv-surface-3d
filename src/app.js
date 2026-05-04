import * as THREE from '/node_modules/three/build/three.module.js';
import { OrbitControls } from '/node_modules/three/examples/jsm/controls/OrbitControls.js';
import { DEFAULT_STOCK_POOL, DEFAULT_TICKER } from './stockPool.js';

const sceneEl = document.querySelector('#scene');
const tooltipEl = document.querySelector('#tooltip');
const loadingOverlay = document.querySelector('#loadingOverlay');
const sourceBadge = document.querySelector('#sourceBadge');
const form = document.querySelector('#controlForm');
const symbolInput = document.querySelector('#symbolInput');
const dateInput = document.querySelector('#dateInput');
const surfaceModeInput = document.querySelector('#surfaceMode');
const resetCameraButton = document.querySelector('#resetCamera');

const metrics = {
  expirationCount: document.querySelector('#expirationCount'),
  pointCount: document.querySelector('#pointCount'),
  averageIv: document.querySelector('#averageIv'),
  ivRange: document.querySelector('#ivRange'),
  strikeRange: document.querySelector('#strikeRange')
};

const chainBody = document.querySelector('#chainBody');
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const hoverTargets = [];
const surfaceObjects = new THREE.Group();
const labelObjects = new THREE.Group();
const clock = new THREE.Clock();

let camera;
let controls;
let renderer;
let currentPoints = [];
let currentStats = null;
let lastPayload = null;
let currentRows = [];
let sortState = { key: 'expiration', direction: 'asc' };

const referenceWindows = {
  NVDA: { minStrike: 50, maxStrike: 350, minDte: 4, maxExpirations: 8, minValidIv: 0.02 },
  AAPL: { minStrike: 110, maxStrike: 400, minDte: 4, maxExpirations: 8, minValidIv: 0.02 }
};

initScene();
bindEvents();
populateTickerOptions();
initializeDefaultControls();
loadSurface(symbolInput.value, dateInput.value);
animate();

function initScene() {
  const { width, height } = sceneSize();
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06090d);
  scene.fog = new THREE.Fog(0x06090d, 13, 30);
  window.ivScene = scene;

  camera = new THREE.PerspectiveCamera(44, width / height, 0.1, 100);
  camera.position.set(6.8, 5.2, 7.6);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  sceneEl.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 1.6, 0);
  controls.minDistance = 4.5;
  controls.maxDistance = 18;

  const ambient = new THREE.AmbientLight(0x8ca8ba, 1.2);
  const key = new THREE.DirectionalLight(0x6de8ff, 2.4);
  key.position.set(-3, 8, 4);
  const warm = new THREE.PointLight(0xffb54f, 3.6, 13);
  warm.position.set(4, 5, -3);
  scene.add(ambient, key, warm, surfaceObjects, labelObjects);

  sceneEl.addEventListener('pointermove', handlePointerMove);
  sceneEl.addEventListener('pointerleave', hideTooltip);
  window.addEventListener('resize', resizeScene);
}

function bindEvents() {
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    loadSurface(symbolInput.value, dateInput.value);
  });

  symbolInput.addEventListener('change', () => {
    loadSurface(symbolInput.value, dateInput.value);
  });

  surfaceModeInput.addEventListener('change', () => {
    if (lastPayload) {
      applyPayload(lastPayload);
    }
  });

  resetCameraButton.addEventListener('click', resetCamera);

  dateInput.addEventListener('click', () => {
    dateInput.showPicker?.();
  });

  dateInput.addEventListener('change', () => {
    loadSurface(symbolInput.value, dateInput.value);
  });

  document.querySelectorAll('[data-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.sort;
      sortState = {
        key,
        direction: sortState.key === key && sortState.direction === 'asc' ? 'desc' : 'asc'
      };
      renderChain(currentRows);
    });
  });
}

function initializeDefaultControls() {
  const today = getLocalTodayIso();
  dateInput.value = today;
  dateInput.max = today;
}

function populateTickerOptions() {
  const selectedSymbol = symbolInput.value || DEFAULT_TICKER;
  const fragment = document.createDocumentFragment();

  for (const ticker of DEFAULT_STOCK_POOL) {
    const option = document.createElement('option');
    option.value = ticker;
    option.textContent = ticker;
    fragment.appendChild(option);
  }

  symbolInput.replaceChildren(fragment);
  symbolInput.value = DEFAULT_STOCK_POOL.includes(selectedSymbol) ? selectedSymbol : DEFAULT_TICKER;
}

async function loadSurface(symbol, date) {
  setLoading(true);
  sourceBadge.textContent = 'Loading';

  try {
    const params = new URLSearchParams({ symbol: String(symbol || DEFAULT_TICKER).trim() || DEFAULT_TICKER });
    if (date) {
      params.set('date', date);
      params.set('fallback', 'previous');
    }

    const response = await fetch(`/api/options?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to load options data.');
    }

    if (payload.meta?.resolvedDate && payload.meta.resolvedDate !== dateInput.value) {
      dateInput.value = payload.meta.resolvedDate;
    }

    lastPayload = payload;
    applyPayload(payload);
    sourceBadge.textContent = payload.meta?.fallbackUsed ? 'Nearest' : payload.meta?.cached ? 'Cached' : 'Fresh';
  } catch (error) {
    sourceBadge.textContent = 'Error';
    showEmptyState(error.message);
  } finally {
    setLoading(false);
  }
}

function applyPayload(payload) {
  const normalized = normalizePayload(payload);
  currentPoints = normalized.points;
  currentStats = normalized.stats;
  currentRows = normalized.rows;
  renderSurface(currentPoints, currentStats);
  renderMetrics(normalized.stats);
  renderChain(normalized.rows);
  document.querySelector('#panelSubtitle').textContent =
    `${normalized.stats.symbol} · snapshot ${normalized.stats.asOfDate} · drag to rotate, scroll to zoom.`;
}

function normalizePayload(payload) {
  const rawRecords = Array.isArray(payload.raw?.data) ? payload.raw.data : [];
  const asOfDate = getAsOfDate(payload, rawRecords);
  const grouped = new Map();
  const symbol = payload.meta?.symbol || symbolInput.value.trim().toUpperCase();
  const viewWindow = getViewWindow(symbol);

  for (const record of rawRecords) {
    const expiration = record.expiration;
    const strike = toNumber(record.strike);
    const type = String(record.type || '').toLowerCase();
    const iv = toNumber(record.implied_volatility);
    const oi = toNumber(record.open_interest);

    if (!expiration || !Number.isFinite(strike) || !Number.isFinite(iv) || iv <= viewWindow.minValidIv) {
      continue;
    }

    const dte = daysBetween(asOfDate, expiration);
    if (!Number.isFinite(dte) || dte < viewWindow.minDte) {
      continue;
    }

    if (strike < viewWindow.minStrike || strike > viewWindow.maxStrike) {
      continue;
    }

    const key = `${expiration}:${strike}`;
    const row = grouped.get(key) || {
      expiration,
      dte,
      strike,
      callIv: null,
      putIv: null,
      oiCall: null,
      oiPut: null
    };

    if (type === 'call') {
      row.callIv = iv;
      row.oiCall = oi;
    }

    if (type === 'put') {
      row.putIv = iv;
      row.oiPut = oi;
    }

    grouped.set(key, row);
  }

  const allRows = [...grouped.values()]
    .map((row) => {
      const ivs = [row.callIv, row.putIv].filter(Number.isFinite);
      return {
        ...row,
        avgIv: ivs.length ? ivs.reduce((sum, value) => sum + value, 0) / ivs.length : null
      };
    })
    .filter((row) => Number.isFinite(row.avgIv))
    .sort((a, b) => a.dte - b.dte || a.strike - b.strike);

  const selectedExpirations = [...new Set(allRows.map((row) => row.expiration))].slice(
    0,
    viewWindow.maxExpirations
  );
  const rows = allRows.filter((row) => selectedExpirations.includes(row.expiration));

  const mode = surfaceModeInput.value;
  const points = rows
    .map((row) => ({
      ...row,
      iv: mode === 'call' ? row.callIv : mode === 'put' ? row.putIv : row.avgIv
    }))
    .filter((row) => Number.isFinite(row.iv));

  return {
    rows,
    points,
    stats: buildStats(points, rows, symbol, asOfDate)
  };
}

function getViewWindow(symbol) {
  const normalized = String(symbol || '').toUpperCase();
  return (
    referenceWindows[normalized] || {
      minStrike: 0,
      maxStrike: Number.POSITIVE_INFINITY,
      minDte: 4,
      maxExpirations: 8,
      minValidIv: 0.02
    }
  );
}

function renderSurface(points, stats) {
  clearGroup(surfaceObjects);
  clearGroup(labelObjects);
  hoverTargets.length = 0;

  if (!points.length) {
    showEmptyState(`No historical option chain for ${stats.symbol} on ${stats.asOfDate}.`);
    return;
  }

  const bounds = {
    strikeMin: Math.min(...points.map((point) => point.strike)),
    strikeMax: Math.max(...points.map((point) => point.strike)),
    dteMin: Math.min(...points.map((point) => point.dte)),
    dteMax: Math.max(...points.map((point) => point.dte)),
    ivMin: Math.min(...points.map((point) => point.iv)),
    ivMax: Math.max(...points.map((point) => point.iv))
  };

  const byExpiry = groupBy(points, (point) => point.expiration);
  const sortedExpiries = [...byExpiry.keys()].sort((a, b) => byExpiry.get(a)[0].dte - byExpiry.get(b)[0].dte);

  surfaceObjects.add(createBasePlane());
  surfaceObjects.add(createAxes(bounds));

  for (const expiry of sortedExpiries) {
    const slice = byExpiry.get(expiry).sort((a, b) => a.strike - b.strike);
    surfaceObjects.add(createSliceLine(slice, bounds));
    surfaceObjects.add(createPointCloud(slice, bounds));
  }

  for (let index = 0; index < sortedExpiries.length - 1; index += 1) {
    const left = byExpiry.get(sortedExpiries[index]).sort((a, b) => a.strike - b.strike);
    const right = byExpiry.get(sortedExpiries[index + 1]).sort((a, b) => a.strike - b.strike);
    const mesh = createSurfaceBand(left, right, bounds);

    if (mesh) {
      surfaceObjects.add(mesh);
    }
  }

  addAxisLabels(bounds, stats);
  resetCamera(false);
}

function createBasePlane() {
  const geometry = new THREE.PlaneGeometry(7.6, 5.4, 1, 1);
  const material = new THREE.MeshBasicMaterial({
    color: 0x112331,
    transparent: true,
    opacity: 0.44,
    side: THREE.DoubleSide,
    depthWrite: false
  });
  const plane = new THREE.Mesh(geometry, material);
  plane.rotation.x = -Math.PI / 2;
  plane.position.y = -0.02;
  return plane;
}

function createAxes(bounds) {
  const group = new THREE.Group();
  const material = new THREE.LineBasicMaterial({ color: 0x5c7688, transparent: true, opacity: 0.62 });
  const axisPoints = [
    [new THREE.Vector3(-3.8, 0, -2.7), new THREE.Vector3(3.8, 0, -2.7)],
    [new THREE.Vector3(-3.8, 0, -2.7), new THREE.Vector3(-3.8, 0, 2.7)],
    [new THREE.Vector3(-3.8, 0, -2.7), new THREE.Vector3(-3.8, 4.2, -2.7)]
  ];

  for (const points of axisPoints) {
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material));
  }

  const gridMaterial = new THREE.LineBasicMaterial({ color: 0x2d4658, transparent: true, opacity: 0.25 });
  for (let i = 1; i < 5; i += 1) {
    const x = -3.8 + i * 1.52;
    const z = -2.7 + i * 1.08;
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x, 0.01, -2.7),
      new THREE.Vector3(x, 0.01, 2.7)
    ]), gridMaterial));
    group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-3.8, 0.01, z),
      new THREE.Vector3(3.8, 0.01, z)
    ]), gridMaterial));
  }

  return group;
}

function createSliceLine(slice, bounds) {
  const material = new THREE.LineBasicMaterial({
    color: 0x37dbc9,
    transparent: true,
    opacity: 0.9
  });
  const points = slice.map((point) => projectPoint(point, bounds));
  return new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), material);
}

function createPointCloud(slice, bounds) {
  const group = new THREE.Group();
  const markerGeometry = new THREE.SphereGeometry(0.032, 14, 14);

  for (const point of slice) {
    const color = point.iv > bounds.ivMin + (bounds.ivMax - bounds.ivMin) * 0.72 ? 0xffb24d : 0x49e0d1;
    const marker = new THREE.Mesh(
      markerGeometry,
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.45,
        roughness: 0.35,
        metalness: 0.18
      })
    );
    marker.position.copy(projectPoint(point, bounds));
    marker.userData = { point };
    hoverTargets.push(marker);
    group.add(marker);
  }

  return group;
}

function createSurfaceBand(left, right, bounds) {
  const rightByStrike = new Map(right.map((point) => [point.strike, point]));
  const shared = left.filter((point) => rightByStrike.has(point.strike));

  if (shared.length < 2) {
    return null;
  }

  const vertices = [];
  const indices = [];

  for (const point of shared) {
    const a = projectPoint(point, bounds);
    const b = projectPoint(rightByStrike.get(point.strike), bounds);
    vertices.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }

  for (let i = 0; i < shared.length - 1; i += 1) {
    const base = i * 2;
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  return new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color: 0x259e92,
      transparent: true,
      opacity: 0.24,
      side: THREE.DoubleSide,
      roughness: 0.8,
      metalness: 0.05,
      depthWrite: false
    })
  );
}

function addAxisLabels(bounds, stats) {
  const labels = [
    { text: 'Strike', position: [0, -0.28, -3.1] },
    { text: 'DTE', position: [4.15, -0.12, 0] },
    { text: 'IV', position: [-4.18, 2.4, -2.82] },
    { text: formatNumber(bounds.strikeMin), position: [-3.8, -0.25, -2.95] },
    { text: formatNumber(bounds.strikeMax), position: [3.72, -0.25, -2.95] },
    { text: `${bounds.dteMin}d`, position: [4.05, -0.14, -2.7] },
    { text: `${bounds.dteMax}d`, position: [4.05, -0.14, 2.7] },
    { text: formatPercent(bounds.ivMax), position: [-4.15, 4.15, -2.7] },
    { text: stats.symbol, position: [-3.8, 4.65, -2.7], scale: 0.38, color: '#dce8ef' }
  ];

  for (const label of labels) {
    labelObjects.add(makeLabel(label.text, label.position, label.scale, label.color));
  }
}

function makeLabel(text, position, scale = 0.24, color = '#8fa4b2') {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  canvas.width = 512;
  canvas.height = 128;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = '600 46px IBM Plex Mono, monospace';
  context.fillStyle = color;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(text, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.position.set(...position);
  sprite.scale.set(scale * 4, scale, 1);
  return sprite;
}

function projectPoint(point, bounds) {
  return new THREE.Vector3(
    scale(point.strike, bounds.strikeMin, bounds.strikeMax, -3.8, 3.8),
    scale(point.iv, bounds.ivMin, bounds.ivMax, 0.15, 4.2),
    scale(point.dte, bounds.dteMin, bounds.dteMax, -2.7, 2.7)
  );
}

function handlePointerMove(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const intersections = raycaster.intersectObjects(hoverTargets, false);

  if (!intersections.length) {
    hideTooltip();
    return;
  }

  const point = intersections[0].object.userData.point;
  tooltipEl.hidden = false;
  tooltipEl.style.left = `${event.clientX - sceneEl.getBoundingClientRect().left + 18}px`;
  tooltipEl.style.top = `${event.clientY - sceneEl.getBoundingClientRect().top + 18}px`;
  tooltipEl.innerHTML = `
    <strong>${point.expiration} · DTE ${point.dte}</strong>
    <span>Strike: ${formatNumber(point.strike)}</span>
    <span>Avg IV: ${formatPercent(point.avgIv)}</span>
    <span>Call IV: ${formatNullablePercent(point.callIv)} · OI: ${formatNullableNumber(point.oiCall)}</span>
    <span>Put IV: ${formatNullablePercent(point.putIv)} · OI: ${formatNullableNumber(point.oiPut)}</span>
  `;
}

function hideTooltip() {
  tooltipEl.hidden = true;
}

function renderMetrics(stats) {
  metrics.expirationCount.textContent = stats.expirationCount;
  metrics.pointCount.textContent = stats.pointCount;
  metrics.averageIv.textContent = formatNullablePercent(stats.averageIv);
  metrics.ivRange.textContent =
    Number.isFinite(stats.ivMin) && Number.isFinite(stats.ivMax)
      ? `${formatPercent(stats.ivMin)} - ${formatPercent(stats.ivMax)}`
      : '--';
  metrics.strikeRange.textContent =
    Number.isFinite(stats.strikeMin) && Number.isFinite(stats.strikeMax)
      ? `${formatNumber(stats.strikeMin)} - ${formatNumber(stats.strikeMax)}`
      : '--';
}

function renderChain(rows) {
  chainBody.innerHTML = '';
  updateSortHeaders();

  if (!rows.length) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="6">No option chain records for the selected date.</td>';
    chainBody.appendChild(tr);
    return;
  }

  const fragment = document.createDocumentFragment();
  const sortedRows = sortRows(rows);

  for (const row of sortedRows.slice(0, 160)) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${row.expiration}</td>
      <td>${row.dte}</td>
      <td>${formatNumber(row.strike)}</td>
      <td>${formatNullablePercent(row.callIv)}</td>
      <td>${formatNullablePercent(row.putIv)}</td>
      <td>${formatPercent(row.avgIv)}</td>
    `;
    fragment.appendChild(tr);
  }

  chainBody.appendChild(fragment);
}

function sortRows(rows) {
  const direction = sortState.direction === 'asc' ? 1 : -1;

  return [...rows].sort((a, b) => {
    const primary = compareValues(a[sortState.key], b[sortState.key]) * direction;

    return (
      primary ||
      a.expiration.localeCompare(b.expiration) ||
      a.dte - b.dte ||
      a.strike - b.strike
    );
  });
}

function compareValues(left, right) {
  const leftMissing = left === null || left === undefined || Number.isNaN(left);
  const rightMissing = right === null || right === undefined || Number.isNaN(right);

  if (leftMissing && rightMissing) return 0;
  if (leftMissing) return 1;
  if (rightMissing) return -1;

  if (typeof left === 'string' || typeof right === 'string') {
    return String(left).localeCompare(String(right));
  }

  return Number(left) - Number(right);
}

function updateSortHeaders() {
  document.querySelectorAll('[data-sort]').forEach((button) => {
    const active = button.dataset.sort === sortState.key;
    button.classList.toggle('is-active', active);
    button.dataset.direction = active ? sortState.direction : '';
  });
}

function buildStats(points, rows, symbol, asOfDate) {
  const ivs = points.map((point) => point.iv);
  const strikes = points.map((point) => point.strike);
  const expirations = new Set(rows.map((row) => row.expiration));

  return {
    symbol,
    asOfDate,
    expirationCount: expirations.size,
    pointCount: points.length,
    averageIv: ivs.length ? average(ivs) : null,
    ivMin: ivs.length ? Math.min(...ivs) : null,
    ivMax: ivs.length ? Math.max(...ivs) : null,
    strikeMin: strikes.length ? Math.min(...strikes) : null,
    strikeMax: strikes.length ? Math.max(...strikes) : null
  };
}

function showEmptyState(message) {
  clearGroup(surfaceObjects);
  clearGroup(labelObjects);
  const label = makeLabel(message, [0, 2.2, 0], 0.32, '#dce8ef');
  labelObjects.add(label);
}

function setLoading(isLoading) {
  loadingOverlay.hidden = !isLoading;
}

function resetCamera(animateControls = true) {
  camera.position.set(6.8, 5.2, 7.6);
  controls.target.set(0, 1.6, 0);
  if (animateControls) {
    controls.update();
  }
}

function animate() {
  requestAnimationFrame(animate);
  const elapsed = clock.getElapsedTime();
  surfaceObjects.rotation.y = Math.sin(elapsed * 0.2) * 0.008;
  controls.update();
  renderer.render(window.ivScene, camera);
}

function resizeScene() {
  const { width, height } = sceneSize();
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function sceneSize() {
  return {
    width: Math.max(sceneEl.clientWidth, 320),
    height: Math.max(sceneEl.clientHeight, 420)
  };
}

function getAsOfDate(payload, records) {
  const candidates = [
    payload.meta?.resolvedDate,
    payload.raw?.date,
    payload.raw?.['date'],
    payload.raw?.['last trading day'],
    payload.raw?.['last_trading_day'],
    payload.meta?.requestedDate,
    records[0]?.date
  ].filter(Boolean);

  const found = candidates.find((candidate) => /^\d{4}-\d{2}-\d{2}$/.test(String(candidate)));
  return found || new Date().toISOString().slice(0, 10);
}

function getLocalTodayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function daysBetween(start, end) {
  const startDate = parseUtcDate(start);
  const endDate = parseUtcDate(end);
  return Math.round((endDate - startDate) / 86_400_000);
}

function parseUtcDate(date) {
  const [year, month, day] = String(date).split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function groupBy(items, getKey) {
  const map = new Map();
  for (const item of items) {
    const key = getKey(item);
    const group = map.get(key) || [];
    group.push(item);
    map.set(key, group);
  }
  return map;
}

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children.pop();
    child.traverse?.((object) => {
      object.geometry?.dispose?.();
      object.material?.dispose?.();
      object.material?.map?.dispose?.();
    });
  }
}

function toNumber(value) {
  if (value === null || value === undefined || value === '' || value === '-') {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function scale(value, min, max, outputMin, outputMax) {
  if (max === min) {
    return (outputMin + outputMax) / 2;
  }
  return outputMin + ((value - min) / (max - min)) * (outputMax - outputMin);
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatPercent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNullablePercent(value) {
  return Number.isFinite(value) ? formatPercent(value) : '--';
}

function formatNumber(value) {
  return Number(value).toLocaleString('en-US', {
    minimumFractionDigits: Number.isInteger(Number(value)) ? 0 : 2,
    maximumFractionDigits: 2
  });
}

function formatNullableNumber(value) {
  return Number.isFinite(value) ? formatNumber(value) : '--';
}
