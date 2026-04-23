/**
 * Eurostat REST API client.
 *
 * Endpoint: https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/{dataset}
 * Format: JSON-stat 2.0
 *
 * JSON-stat is a sparse multidimensional array format. The `value` object
 * maps a flat index → numeric value, and `dimension.{dim}.category.index`
 * maps each dimension's labels to their position. To get a specific value,
 * compute the flat index from the dimension positions:
 *
 *   flatIdx = pos[d0] * size[d1]*size[d2]... + pos[d1] * size[d2]... + ...
 *
 * This module flattens the JSON-stat into an easier `[{geo, time, value}]` shape.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const BASE = 'https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data';
const UA = 'eu27-sust-dashboard/0.1 (+research; tourism sustainability profile)';
const CACHE_DIR = path.resolve('data/cache');
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function cacheKey(url) {
  return crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
}

async function readCache(url) {
  try {
    const p = path.join(CACHE_DIR, cacheKey(url) + '.json');
    const stat = await fs.stat(p);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    return JSON.parse(await fs.readFile(p, 'utf8'));
  } catch {
    return null;
  }
}

async function writeCache(url, json) {
  await fs.mkdir(CACHE_DIR, { recursive: true });
  const p = path.join(CACHE_DIR, cacheKey(url) + '.json');
  await fs.writeFile(p, JSON.stringify(json), 'utf8');
}

/**
 * Build a query URL for an Eurostat dataset.
 * @param {string} dataset - dataset code (e.g. "tour_occ_arnat")
 * @param {Object} filters - { dimension: value | [values] }
 * @returns {string} fully-qualified URL
 */
export function buildUrl(dataset, filters = {}) {
  const params = new URLSearchParams();
  params.set('format', 'JSON');
  params.set('lang', 'EN');
  for (const [dim, val] of Object.entries(filters)) {
    if (Array.isArray(val)) {
      for (const v of val) params.append(dim, v);
    } else {
      params.append(dim, val);
    }
  }
  return `${BASE}/${dataset}?${params.toString()}`;
}

/**
 * Fetch a dataset and return parsed JSON-stat.
 * @param {string} dataset
 * @param {Object} filters
 * @param {Object} opts - { useCache, log }
 */
export async function fetchDataset(dataset, filters = {}, opts = {}) {
  const { useCache = true, log = () => {} } = opts;
  const url = buildUrl(dataset, filters);

  if (useCache) {
    const cached = await readCache(url);
    if (cached) {
      log(`  ↺ cache hit: ${dataset}`);
      return cached;
    }
  }

  log(`  → fetching: ${dataset}  (${url.length} char URL)`);
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json' } });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} for ${dataset}: ${body.slice(0, 300)}`);
  }
  const json = await res.json();

  // Eurostat returns 200 even for "no results" — check the warning field
  if (json.warning) {
    throw new Error(`Eurostat warning for ${dataset}: ${JSON.stringify(json.warning)}`);
  }
  if (json.error) {
    throw new Error(`Eurostat error for ${dataset}: ${JSON.stringify(json.error)}`);
  }
  if (!json.value || !json.dimension) {
    throw new Error(`Unexpected response shape for ${dataset}: keys = ${Object.keys(json).join(',')}`);
  }

  await writeCache(url, json);
  return json;
}

/**
 * Flatten a JSON-stat response into [{...dimensionLabels, value}] rows.
 *
 * @param {Object} jsonStat - the full Eurostat response
 * @returns {Array<Object>}
 *
 * Example output for tour_occ_arnat:
 *   [{ geo: 'AT', time: '2023', unit: 'NR', c_resid: 'TOTAL', nace_r2: 'I551-I553', value: 22500000 }, ...]
 */
export function flatten(jsonStat) {
  const dims = jsonStat.id; // ordered array of dimension codes
  const sizes = jsonStat.size; // parallel array of dimension sizes

  // Compute multipliers for index calculation: rightmost dim has multiplier 1
  const multipliers = new Array(dims.length);
  multipliers[dims.length - 1] = 1;
  for (let i = dims.length - 2; i >= 0; i--) {
    multipliers[i] = multipliers[i + 1] * sizes[i + 1];
  }

  // Map dimension name → position-index map
  const dimMaps = {};
  for (const dim of dims) {
    const indexMap = jsonStat.dimension[dim].category.index;
    // indexMap is { value: position }, e.g. { AT: 0, BE: 1, BG: 2, ... }
    // We want position → value, e.g. { 0: 'AT', 1: 'BE', 2: 'BG', ... }
    const positionToValue = {};
    for (const [val, pos] of Object.entries(indexMap)) {
      positionToValue[pos] = val;
    }
    dimMaps[dim] = positionToValue;
  }

  // Iterate the value object — keys are flat indices as strings
  const rows = [];
  for (const [flatIdx, value] of Object.entries(jsonStat.value)) {
    const idx = parseInt(flatIdx);
    const row = { value };
    let remaining = idx;
    for (let d = 0; d < dims.length; d++) {
      const pos = Math.floor(remaining / multipliers[d]);
      remaining = remaining % multipliers[d];
      row[dims[d]] = dimMaps[dims[d]][pos];
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Convenience: fetch + flatten in one call.
 */
export async function fetchAndFlatten(dataset, filters = {}, opts = {}) {
  const json = await fetchDataset(dataset, filters, opts);
  return flatten(json);
}
