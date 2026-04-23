#!/usr/bin/env node
/**
 * Build script: fetches all required Eurostat datasets, derives metrics,
 * and writes a single data/eu27.json that the dashboard consumes at runtime.
 *
 * Run: node scripts/build.js [--year-range=2019,2024] [--no-cache]
 *
 * Output structure:
 *   {
 *     meta: { generated_at, sources, year_range, ... },
 *     countries: { AT: { name, region, joined_eu, metrics: { ... } }, ... },
 *     regions: { CEE: { ...avg_metrics... }, Western: { ... }, ... }
 *   }
 *
 * Each country.metrics has time-series for each indicator:
 *   {
 *     arrivals:           { 2019: 31_000_000, ..., 2024: 32_000_000 },
 *     nights:             { 2019: 152_000_000, ..., 2024: 158_000_000 },
 *     length_of_stay:     { 2019: 4.9, ..., 2024: 4.94 },             // derived
 *     intensity:          { 2019: 17.2, ..., 2024: 17.7 },            // nights per inhabitant
 *     seasonality_peak:   { 2019: 14.8, ..., 2024: 15.1 },            // % of annual nights in peak month
 *     seasonality_gini:   { 2019: 0.21, ..., 2024: 0.22 },            // 0=flat, 1=concentrated
 *     gva_share:          { 2019: 5.3, ..., 2022: 4.9 },              // tourism % of total GVA
 *     accom_capacity:     { 2019: 18_500, ..., 2024: 19_200 },        // # establishments
 *     cert_count:         { 2024: 60 },                                 // Green Key certified
 *     cert_density:       { 2024: 3.1 }                                 // per 1000 establishments
 *   }
 */

import fs from 'node:fs/promises';
import path from 'node:path';

import { EU27, REGIONS, REGION_LABELS, toEurostatCode, toISO2 } from './countries.js';
import { fetchAndFlatten, fetchDataset, flatten } from './eurostat.js';

// ---------- args ----------
function parseArgs() {
  const opts = { yearStart: 2019, yearEnd: 2024, noCache: false, certPath: null };
  for (const a of process.argv.slice(2)) {
    if (a === '--no-cache') opts.noCache = true;
    else if (a.startsWith('--year-range=')) {
      const [s, e] = a.slice(13).split(',').map(Number);
      opts.yearStart = s; opts.yearEnd = e;
    } else if (a.startsWith('--cert-path=')) {
      opts.certPath = a.slice(12);
    }
  }
  return opts;
}

const log = (msg, lvl = 'info') => {
  const t = new Date().toISOString().slice(11, 19);
  const prefix = { info: '[ ]', ok: '[✓]', warn: '[!]', err: '[✕]', step: '[▸]' }[lvl] || '[ ]';
  console.log(`${t} ${prefix} ${msg}`);
};

// ---------- helpers ----------
const EUROSTAT_GEOS = EU27.map(c => c[1]);

function years(start, end) {
  const out = [];
  for (let y = start; y <= end; y++) out.push(String(y));
  return out;
}

function yearsMonths(start, end) {
  const out = [];
  for (let y = start; y <= end; y++) {
    for (let m = 1; m <= 12; m++) out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

/**
 * Index a flattened-rows array by [geo][time] for fast lookup.
 * For datasets with multiple value-per-cell (e.g. unit='NR' alongside unit='PCH'),
 * the caller should pre-filter the rows to just the relevant unit.
 */
function indexByGeoTime(rows) {
  const out = {};
  for (const r of rows) {
    if (!r.geo) continue;
    const iso = toISO2(r.geo);
    if (!out[iso]) out[iso] = {};
    out[iso][r.time] = r.value;
  }
  return out;
}

// ---------- metric derivers ----------
/**
 * Average length of stay = nights / arrivals
 */
function deriveLengthOfStay(arrivals, nights) {
  const out = {};
  for (const iso of Object.keys(arrivals)) {
    out[iso] = {};
    for (const yr of Object.keys(arrivals[iso])) {
      const a = arrivals[iso][yr];
      const n = nights[iso]?.[yr];
      if (a && n) out[iso][yr] = +(n / a).toFixed(2);
    }
  }
  return out;
}

/**
 * Tourism intensity = nights / inhabitant.
 * If we already have nights per inhabitant from Eurostat we use it directly;
 * otherwise compute from nights ÷ population.
 */
function deriveIntensity(nights, population) {
  const out = {};
  for (const iso of Object.keys(nights)) {
    out[iso] = {};
    for (const yr of Object.keys(nights[iso])) {
      const n = nights[iso][yr];
      const p = population[iso]?.[yr] || population[iso]?.['2023']; // fallback to most recent
      if (n && p) out[iso][yr] = +(n / p).toFixed(1);
    }
  }
  return out;
}

/**
 * Seasonality from monthly nights data.
 *  - peak: % of annual nights in highest month
 *  - gini: classic concentration measure (0=uniform, 1=one month gets all)
 */
function deriveSeasonality(monthlyRows) {
  // Group by geo + year
  const byGeoYear = {};
  for (const r of monthlyRows) {
    if (!r.geo || !r.time) continue;
    const iso = toISO2(r.geo);
    const [y, m] = r.time.split('-');
    if (!byGeoYear[iso]) byGeoYear[iso] = {};
    if (!byGeoYear[iso][y]) byGeoYear[iso][y] = new Array(12).fill(null);
    const monthIdx = parseInt(m) - 1;
    byGeoYear[iso][y][monthIdx] = r.value;
  }

  const peak = {}, gini = {};
  for (const iso of Object.keys(byGeoYear)) {
    peak[iso] = {}; gini[iso] = {};
    for (const yr of Object.keys(byGeoYear[iso])) {
      const months = byGeoYear[iso][yr].filter(v => v !== null && v >= 0);
      if (months.length < 12) continue; // need full year
      const total = months.reduce((s, v) => s + v, 0);
      if (total <= 0) continue;
      const max = Math.max(...months);
      peak[iso][yr] = +(100 * max / total).toFixed(2);

      // Gini coefficient on the 12 months
      const sorted = [...months].sort((a, b) => a - b);
      let area = 0;
      for (let i = 0; i < 12; i++) area += sorted[i] * (i + 1);
      const giniVal = (2 * area) / (12 * total) - (12 + 1) / 12;
      gini[iso][yr] = +giniVal.toFixed(3);
    }
  }
  return { peak, gini };
}

/**
 * Cert density: certified establishments per 1,000 accommodation establishments.
 */
function deriveCertDensity(certCount, accomCapacity) {
  const out = {};
  for (const iso of Object.keys(certCount)) {
    out[iso] = {};
    for (const yr of Object.keys(certCount[iso])) {
      const cnt = certCount[iso][yr];
      const cap = accomCapacity[iso]?.[yr] || accomCapacity[iso]?.['2023'] || accomCapacity[iso]?.['2022'];
      if (cnt != null && cap) out[iso][yr] = +(1000 * cnt / cap).toFixed(2);
    }
  }
  return out;
}

// ---------- regional aggregation ----------
function buildRegionAggregates(countries) {
  const regionAggs = {};
  for (const [regionKey, members] of Object.entries(REGIONS)) {
    const validMembers = members.filter(iso => countries[iso]);
    if (!validMembers.length) continue;
    const metrics = {};
    // Collect all metric keys
    const sampleMetrics = countries[validMembers[0]].metrics;
    for (const metric of Object.keys(sampleMetrics)) {
      metrics[metric] = {};
      // Collect all years across members
      const allYears = new Set();
      for (const iso of validMembers) {
        for (const yr of Object.keys(countries[iso].metrics[metric] || {})) allYears.add(yr);
      }
      // Compute mean (and median for robustness) per year
      for (const yr of allYears) {
        const vals = validMembers
          .map(iso => countries[iso].metrics[metric]?.[yr])
          .filter(v => v != null && Number.isFinite(v));
        if (!vals.length) continue;
        const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
        const sorted = [...vals].sort((a, b) => a - b);
        const median = sorted.length % 2
          ? sorted[Math.floor(sorted.length / 2)]
          : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
        metrics[metric][yr] = { mean: +mean.toFixed(2), median: +median.toFixed(2), n: vals.length };
      }
    }
    regionAggs[regionKey] = {
      label: REGION_LABELS[regionKey],
      members: validMembers,
      metrics
    };
  }
  return regionAggs;
}

// ---------- cert data loader ----------
async function loadCertCounts(certPath) {
  if (!certPath) return {};
  try {
    const json = JSON.parse(await fs.readFile(certPath, 'utf8'));
    if (!json.hotels || !Array.isArray(json.hotels)) {
      log(`cert file has unexpected structure (no .hotels array)`, 'warn');
      return {};
    }
    const counts = {};
    const yr = String(new Date().getFullYear());
    for (const h of json.hotels) {
      if (!h.country) continue;
      counts[h.country] = counts[h.country] || {};
      counts[h.country][yr] = (counts[h.country][yr] || 0) + 1;
    }
    log(`loaded cert counts from ${certPath}: ${Object.keys(counts).length} countries`);
    return counts;
  } catch (e) {
    log(`could not load cert counts: ${e.message}`, 'warn');
    return {};
  }
}

// ---------- main ----------
async function main() {
  const opts = parseArgs();
  const yearList = years(opts.yearStart, opts.yearEnd);
  log(`EU-27 sustainability dataset builder`, 'step');
  log(`Year range: ${opts.yearStart}–${opts.yearEnd}  (${yearList.length} years)`);
  log(`Cache: ${opts.noCache ? 'disabled' : 'enabled (7 day TTL)'}`);

  const fetchOpts = { useCache: !opts.noCache, log: m => log(m) };
  const sources = {};

  // ---- 1. Annual arrivals (tour_occ_arnat) ----
  log(`fetching: tourist arrivals (tour_occ_arnat)`, 'step');
  const arrivalsRows = await fetchAndFlatten('tour_occ_arnat', {
    geo: EUROSTAT_GEOS,
    time: yearList,
    unit: 'NR',                  // number of arrivals
    c_resid: 'TOTAL',            // residents + non-residents
    nace_r2: 'I551-I553'         // hotels + camping + holiday parks
  }, fetchOpts);
  const arrivals = indexByGeoTime(arrivalsRows);
  sources.arrivals = { dataset: 'tour_occ_arnat', n_rows: arrivalsRows.length };

  // ---- 2. Annual nights spent (tour_occ_ninat) ----
  log(`fetching: nights spent (tour_occ_ninat)`, 'step');
  const nightsRows = await fetchAndFlatten('tour_occ_ninat', {
    geo: EUROSTAT_GEOS,
    time: yearList,
    unit: 'NR',
    c_resid: 'TOTAL',
    nace_r2: 'I551-I553'
  }, fetchOpts);
  const nights = indexByGeoTime(nightsRows);
  sources.nights = { dataset: 'tour_occ_ninat', n_rows: nightsRows.length };

  // ---- 3. Population for intensity (demo_gind) ----
  log(`fetching: population (demo_gind)`, 'step');
  let population = {};
  try {
    const popRows = await fetchAndFlatten('demo_gind', {
      geo: EUROSTAT_GEOS,
      time: yearList,
      indic_de: 'AVG'   // annual average population
    }, fetchOpts);
    population = indexByGeoTime(popRows);
    sources.population = { dataset: 'demo_gind', n_rows: popRows.length };
  } catch (e) {
    log(`population fetch failed: ${e.message}`, 'warn');
    log(`intensity metric will be missing`, 'warn');
  }

  // ---- 4. Monthly nights for seasonality (tour_occ_nim) ----
  log(`fetching: monthly nights for seasonality (tour_occ_nim)`, 'step');
  let seasonality = { peak: {}, gini: {} };
  try {
    const monthlyRows = await fetchAndFlatten('tour_occ_nim', {
      geo: EUROSTAT_GEOS,
      time: yearsMonths(opts.yearStart, opts.yearEnd),
      unit: 'NR',
      c_resid: 'TOTAL',
      nace_r2: 'I551-I553'
    }, fetchOpts);
    seasonality = deriveSeasonality(monthlyRows);
    sources.seasonality = { dataset: 'tour_occ_nim', n_rows: monthlyRows.length };
  } catch (e) {
    log(`seasonality fetch failed: ${e.message}`, 'warn');
  }

  // ---- 5. Tourism share of GVA (proxy via nama_10_a64) ----
  // Note: the dedicated tourism-satellite-accounts dataset (tour_eco_int) was
  // discontinued from public dissemination. As a proxy we use NACE I
  // ("Accommodation and food service activities") as a share of total GVA.
  // This OVERSTATES tourism's true share (it includes restaurants serving locals)
  // and UNDERSTATES it (it excludes transport, travel agencies, etc.) — but it's
  // a reasonable cross-country comparable proxy that's consistently available.
  log(`fetching: accommodation+food share of GVA proxy (nama_10_a64)`, 'step');
  let gvaShare = {};
  try {
    // Need: I (accommodation+food) value AND TOTAL value to compute %
    const gvaRows = await fetchAndFlatten('nama_10_a64', {
      geo: EUROSTAT_GEOS,
      time: yearList,
      unit: 'CP_MEUR',           // current prices, million EUR
      na_item: 'B1G',            // gross value added at basic prices
      nace_r2: ['I', 'TOTAL']    // accommodation+food, and total
    }, fetchOpts);
    // Index by [geo][time][nace]
    const byGeoTimeNace = {};
    for (const r of gvaRows) {
      if (!r.geo) continue;
      const iso = toISO2(r.geo);
      byGeoTimeNace[iso] = byGeoTimeNace[iso] || {};
      byGeoTimeNace[iso][r.time] = byGeoTimeNace[iso][r.time] || {};
      byGeoTimeNace[iso][r.time][r.nace_r2] = r.value;
    }
    for (const iso of Object.keys(byGeoTimeNace)) {
      gvaShare[iso] = {};
      for (const yr of Object.keys(byGeoTimeNace[iso])) {
        const i = byGeoTimeNace[iso][yr]['I'];
        const total = byGeoTimeNace[iso][yr]['TOTAL'];
        if (i && total) gvaShare[iso][yr] = +(100 * i / total).toFixed(2);
      }
    }
    sources.gva_share = { dataset: 'nama_10_a64', n_rows: gvaRows.length, note: 'proxy: NACE I share' };
  } catch (e) {
    log(`GVA share fetch failed: ${e.message}`, 'warn');
  }

  // ---- 6. Accommodation capacity for cert density (tour_cap_nat) ----
  log(`fetching: accommodation capacity (tour_cap_nat)`, 'step');
  let accomCap = {};
  try {
    const capRows = await fetchAndFlatten('tour_cap_nat', {
      geo: EUROSTAT_GEOS,
      time: yearList,
      unit: 'NR',                // number of establishments
      nace_r2: 'I551-I553'
    }, fetchOpts);
    accomCap = indexByGeoTime(capRows);
    sources.accom_capacity = { dataset: 'tour_cap_nat', n_rows: capRows.length };
  } catch (e) {
    log(`accom capacity fetch failed: ${e.message}`, 'warn');
  }

  // ---- 7. Certification counts (from local hotels.json) ----
  log(`loading certification counts (local file)`, 'step');
  const certCount = await loadCertCounts(opts.certPath);
  sources.cert = { source: opts.certPath || 'none' };

  // ---- Derive ----
  log(`deriving: length of stay, intensity, cert density`, 'step');
  const lengthOfStay = deriveLengthOfStay(arrivals, nights);
  const intensity = deriveIntensity(nights, population);
  const certDensity = deriveCertDensity(certCount, accomCap);

  // ---- Assemble per-country structures ----
  log(`assembling country profiles`, 'step');
  const countries = {};
  for (const [iso, eurostatCode, name, region, joinedEu] of EU27) {
    countries[iso] = {
      iso2: iso,
      eurostat_code: eurostatCode,
      name,
      region,
      joined_eu: joinedEu,
      metrics: {
        arrivals: arrivals[iso] || {},
        nights: nights[iso] || {},
        length_of_stay: lengthOfStay[iso] || {},
        intensity: intensity[iso] || {},
        seasonality_peak: seasonality.peak[iso] || {},
        seasonality_gini: seasonality.gini[iso] || {},
        gva_share: gvaShare[iso] || {},
        accom_capacity: accomCap[iso] || {},
        cert_count: certCount[iso] || {},
        cert_density: certDensity[iso] || {}
      }
    };
  }

  // ---- Regional aggregates ----
  log(`computing regional aggregates`, 'step');
  const regions = buildRegionAggregates(countries);

  // ---- Coverage summary ----
  log(`coverage summary:`);
  const metricKeys = Object.keys(countries.AT.metrics);
  for (const mk of metricKeys) {
    const withData = Object.values(countries).filter(c =>
      Object.keys(c.metrics[mk]).length > 0
    ).length;
    log(`  ${mk.padEnd(20)} ${withData}/27 countries with data`);
  }

  // ---- Write output ----
  const output = {
    meta: {
      version: '0.1.0',
      generated_at: new Date().toISOString(),
      year_range: { start: opts.yearStart, end: opts.yearEnd },
      countries: EU27.length,
      regions: Object.keys(REGIONS).length,
      sources
    },
    countries,
    regions
  };

  const outDir = path.resolve('data');
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, 'eu27.json');
  await fs.writeFile(outPath, JSON.stringify(output, null, 2));
  log(`wrote ${outPath} (${(JSON.stringify(output).length / 1024).toFixed(1)} KB)`, 'ok');
}

main().catch(e => {
  log(`Fatal: ${e.message}`, 'err');
  console.error(e);
  process.exit(1);
});
