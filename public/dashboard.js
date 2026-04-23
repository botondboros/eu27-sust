/* ============================================================
   EU-27 Tourism Sustainability Dashboard
   ============================================================ */

const DATA_URL = 'data/eu27.json';

/* ---------- METRIC DEFINITIONS ---------- */
// `inverse: true` means higher = worse (seasonality)
const METRICS = {
  arrivals:         { label: 'Tourist arrivals',           unit: 'arrivals/year',       fmt: 'compact',  inverse: false, group: 'volume',
                      explainer: 'Total number of tourists checking into accommodation establishments in the country during the year. A measure of absolute scale — not sustainability on its own.' },
  nights:           { label: 'Nights spent',               unit: 'nights/year',         fmt: 'compact',  inverse: false, group: 'volume',
                      explainer: 'Total overnight stays recorded across all hotels, campsites, and short-stay accommodation. Nights × length-of-stay captures the actual residential pressure tourism creates.' },
  length_of_stay:   { label: 'Avg length of stay',         unit: 'nights',              fmt: 'decimal',  inverse: false, group: 'volume',
                      explainer: 'Nights divided by arrivals. Longer stays mean lower per-visitor transport emissions and stronger local economic ties — but also more infrastructure pressure per visitor during the stay.' },
  intensity:        { label: 'Tourism intensity',          unit: 'nights / inhabitant', fmt: 'decimal',  inverse: false, group: 'pressure',
                      explainer: 'Total tourist nights divided by resident population. Tells you how saturated local life is by tourism. Malta (~40), Croatia (~30) sit in a fundamentally different regime from Germany (~3) or Romania (~1.5).' },
  seasonality_peak: { label: 'Seasonality (peak month)',   unit: '% of annual',         fmt: 'decimal',  inverse: true,  group: 'pressure',
                      explainer: 'Share of annual nights that occur in the country\'s busiest month. 8.3% would be perfectly even. Values above 20% indicate summer-concentrated tourism with year-round consequences for employment and infrastructure.' },
  seasonality_gini: { label: 'Seasonality (Gini)',         unit: '0 = flat · 1 = concentrated', fmt: 'decimal3', inverse: true, group: 'pressure',
                      explainer: 'Gini coefficient over the 12-month distribution. 0 = perfectly flat year-round, 1 = all tourism in one month. A more sensitive measure of concentration than peak-month share alone.' },
  gva_share:        { label: 'GVA share (NACE I proxy)',   unit: '% of total GVA',      fmt: 'decimal',  inverse: false, group: 'economy',
                      explainer: 'Accommodation & food services as % of total gross value added. A proxy for economic dependence on tourism — higher values mean more structural exposure when tourism demand drops.' },
  accom_capacity:   { label: 'Accommodation capacity',     unit: 'establishments',      fmt: 'compact',  inverse: false, group: 'infrastructure',
                      explainer: 'Total number of registered accommodation establishments. Context for interpreting certification density — a small country with few hotels can achieve high certification coverage with less absolute effort.' },
  cert_count:       { label: 'Green Key certified',        unit: 'establishments',      fmt: 'integer',  inverse: false, group: 'sustainability',
                      explainer: 'Number of hotels and accommodations certified under the Green Key International scheme. Certification is voluntary, costs money, and requires annual audits — so counts reflect sector engagement with sustainability.' },
  cert_density:     { label: 'Cert density',               unit: 'per 1k establishments', fmt: 'decimal', inverse: false, group: 'sustainability',
                      explainer: 'Green Key certifications per 1,000 accommodation establishments. The share of the accommodation sector actively committing to sustainability practices — a leading indicator of intent.' }
};

const RADAR_METRICS = ['intensity', 'seasonality_peak', 'gva_share', 'cert_density', 'length_of_stay'];

/* ---------- STATE ---------- */
let DATA = null;
let USER_COUNTRY = null;  // ISO-2 detected from IP

let state = {
  barMetric: 'intensity',
  barYear: '2024',
  barHighlight: 'HU',       // reset from USER_COUNTRY once detected
  barRegion: 'EU27',
  profileCountry: 'HU',
  profileYear: '2024',
  profileCompare: 'region'
};

/* ---------- HELPERS ---------- */
function fmt(value, type) {
  if (value == null || isNaN(value)) return '—';
  if (type === 'compact') {
    if (Math.abs(value) >= 1e9) return (value / 1e9).toFixed(1) + 'B';
    if (Math.abs(value) >= 1e6) return (value / 1e6).toFixed(1) + 'M';
    if (Math.abs(value) >= 1e3) return (value / 1e3).toFixed(1) + 'k';
    return Math.round(value).toLocaleString();
  }
  if (type === 'decimal') return (+value).toFixed(1);
  if (type === 'decimal3') return (+value).toFixed(3);
  if (type === 'integer') return Math.round(value).toLocaleString();
  return String(value);
}

function fmtDelta(latest, baseline, inverse) {
  if (latest == null || baseline == null || baseline === 0) return { text: '—', cls: 'delta-flat' };
  const pct = ((latest - baseline) / Math.abs(baseline)) * 100;
  if (Math.abs(pct) < 0.5) return { text: '≈ baseline', cls: 'delta-flat' };
  const arrow = pct > 0 ? '▲' : '▼';
  const cls = pct > 0 ? 'delta-up' : 'delta-down';
  return { text: `${arrow} ${Math.abs(pct).toFixed(1)}% vs 2019`, cls };
}

/* ---------- COVERAGE / YEAR HELPERS ---------- */
// Core metrics that define whether a year is "real" (i.e. has primary Eurostat data).
// If none of these have any values for year Y, then Y is filtered out of year tabs.
const CORE_METRICS_FOR_YEAR_FILTER = ['arrivals', 'nights'];

// Min coverage a metric must have to remain selectable (0-1 scale).
// "Hide if > 70% of countries lack this data" → coverage < 0.30 → hidden.
const MIN_METRIC_COVERAGE = 0.30;

function coverageOf(metric, year) {
  const total = Object.keys(DATA.countries).length || 27;
  const withData = Object.values(DATA.countries)
    .filter(c => {
      const v = c.metrics[metric]?.[year];
      return v != null && Number.isFinite(v);
    }).length;
  return withData / total;
}

// Does this metric have adequate coverage for ANY year in the dataset?
function metricPassesCoverageGate(metric) {
  const years = yearsFromCore();
  return years.some(y => coverageOf(metric, y) >= MIN_METRIC_COVERAGE);
}

function yearsFromCore() {
  // Only years where at least one core metric has data for at least one country.
  const set = new Set();
  for (const c of Object.values(DATA.countries)) {
    for (const m of CORE_METRICS_FOR_YEAR_FILTER) {
      const s = c.metrics[m];
      if (!s) continue;
      for (const y of Object.keys(s)) {
        if (Number.isFinite(s[y])) set.add(y);
      }
    }
  }
  return [...set].sort();
}

function median(values) {
  const vals = values.filter(v => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!vals.length) return null;
  const mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid - 1] + vals[mid]) / 2;
}

function rankOf(iso2, metric, year, inverse) {
  const all = Object.values(DATA.countries)
    .map(c => ({ iso2: c.iso2, v: c.metrics[metric]?.[year] }))
    .filter(x => x.v != null && Number.isFinite(x.v))
    .sort((a, b) => inverse ? a.v - b.v : b.v - a.v);
  const idx = all.findIndex(x => x.iso2 === iso2);
  return { rank: idx + 1, total: all.length };
}

/* ---------- IP-BASED COUNTRY DETECTION ---------- */
async function detectUserCountry() {
  // Try multiple providers — they all occasionally rate-limit or change ToS
  const providers = [
    {
      url: 'https://ipapi.co/json/',
      extract: (j) => j?.country_code
    },
    {
      url: 'https://api.country.is/',
      extract: (j) => j?.country
    },
    {
      url: 'https://get.geojs.io/v1/ip/country.json',
      extract: (j) => j?.country
    }
  ];
  for (const p of providers) {
    try {
      const r = await fetch(p.url, { cache: 'no-store' });
      if (!r.ok) continue;
      const j = await r.json();
      const iso2 = p.extract(j);
      if (iso2 && DATA.countries[iso2]) {
        console.log(`Detected country via ${p.url}: ${iso2}`);
        return iso2;
      }
    } catch (e) {
      console.warn(`IP detection via ${p.url} failed:`, e.message);
    }
  }
  console.log('No IP detection succeeded — defaulting to HU');
  return 'HU';
}

/* ---------- LOAD ---------- */
async function loadAll() {
  const data = await fetch(DATA_URL).then(r => {
    if (!r.ok) throw new Error('Could not load eu27.json');
    return r.json();
  });
  DATA = data;

  // Start IP detection in parallel with UI init
  const userCountryPromise = detectUserCountry();

  // Footer meta
  document.getElementById('lastRefresh').textContent = new Date(data.meta.generated_at).toLocaleDateString('en-GB');
  document.getElementById('dataVersion').textContent = data.meta.version || '0.1.0';
  document.getElementById('navDataVersion').textContent = 'v' + (data.meta.version || '0.1.0');

  // Wait for IP detection (with a 2-second cap)
  USER_COUNTRY = await Promise.race([
    userCountryPromise,
    new Promise(resolve => setTimeout(() => resolve('HU'), 2000))
  ]);

  // Seed state from detected country
  state.barHighlight = USER_COUNTRY;
  state.profileCountry = USER_COUNTRY;

  initControls();
  renderAll();
  renderYouSummary();
}

/* ---------- CONTROLS ---------- */
function initControls() {
  const years = yearsFromCore();

  // Make sure state years are in the valid set (fall back to latest if not)
  if (!years.includes(state.barYear)) state.barYear = years[years.length - 1] || state.barYear;
  if (!years.includes(state.profileYear)) state.profileYear = years[years.length - 1] || state.profileYear;

  // Bar chart
  populateMetricSelect('barMetric', state.barMetric);
  populateYearTabs('barYear', years, state.barYear, y => { state.barYear = y; renderBarChart(); renderMetricExplainer(); });
  document.getElementById('barMetric').addEventListener('change', e => {
    state.barMetric = e.target.value;
    renderBarChart();
    renderMetricExplainer();
  });
  populateCountrySelect('barHighlight', state.barHighlight);
  document.getElementById('barHighlight').addEventListener('change', e => {
    state.barHighlight = e.target.value;
    renderBarChart();
  });
  document.getElementById('barRegion').addEventListener('change', e => {
    state.barRegion = e.target.value;
    renderBarChart();
  });

  // Profile
  populateCountrySelect('profileCountry', state.profileCountry);
  document.getElementById('profileCountry').addEventListener('change', e => {
    state.profileCountry = e.target.value;
    renderProfile();
  });
  populateYearTabs('profileYear', years, state.profileYear, y => { state.profileYear = y; renderProfile(); });
  document.getElementById('profileCompareRegion').addEventListener('change', e => {
    state.profileCompare = e.target.value;
    renderProfile();
  });
}

function yearsFrom(data) {
  const set = new Set();
  for (const c of Object.values(data.countries)) {
    for (const m of Object.values(c.metrics)) {
      for (const y of Object.keys(m)) set.add(y);
    }
  }
  return [...set].sort();
}

function populateMetricSelect(id, defaultValue) {
  const sel = document.getElementById(id);
  sel.innerHTML = '';
  const grouped = {};
  for (const [key, def] of Object.entries(METRICS)) {
    if (!metricPassesCoverageGate(key)) continue; // skip low-coverage metrics
    if (!grouped[def.group]) grouped[def.group] = [];
    grouped[def.group].push([key, def]);
  }
  const groupOrder = ['volume', 'pressure', 'economy', 'infrastructure', 'sustainability'];
  for (const grp of groupOrder) {
    if (!grouped[grp]) continue;
    const og = document.createElement('optgroup');
    og.label = grp.charAt(0).toUpperCase() + grp.slice(1);
    grouped[grp].forEach(([key, def]) => {
      const o = document.createElement('option');
      o.value = key;
      o.textContent = def.label;
      og.appendChild(o);
    });
    sel.appendChild(og);
  }
  // Fall back if the default was filtered out
  if (![...sel.querySelectorAll('option')].some(o => o.value === defaultValue)) {
    const firstOpt = sel.querySelector('option');
    if (firstOpt) sel.value = firstOpt.value;
  } else {
    sel.value = defaultValue;
  }
}

function populateYearTabs(id, years, defaultValue, onChange) {
  const wrap = document.getElementById(id);
  wrap.innerHTML = '';
  for (const y of years) {
    const btn = document.createElement('button');
    btn.className = 'year-tab' + (y === defaultValue ? ' active' : '');
    btn.textContent = y;
    btn.dataset.year = y;
    btn.addEventListener('click', () => {
      wrap.querySelectorAll('.year-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onChange(y);
    });
    wrap.appendChild(btn);
  }
}

function populateCountrySelect(id, defaultValue) {
  const sel = document.getElementById(id);
  sel.innerHTML = '';
  const byRegion = {};
  for (const [iso, c] of Object.entries(DATA.countries)) {
    if (!byRegion[c.region]) byRegion[c.region] = [];
    byRegion[c.region].push([iso, c.name]);
  }
  for (const region of ['CEE', 'Western', 'Mediterranean', 'Nordics', 'Baltics']) {
    if (!byRegion[region]) continue;
    const og = document.createElement('optgroup');
    og.label = region;
    byRegion[region].sort((a, b) => a[1].localeCompare(b[1])).forEach(([iso, name]) => {
      const o = document.createElement('option');
      o.value = iso;
      o.textContent = name;
      og.appendChild(o);
    });
    sel.appendChild(og);
  }
  sel.value = defaultValue;
}

/* ---------- METRIC EXPLAINER ---------- */
function renderMetricExplainer() {
  const def = METRICS[state.barMetric];
  const year = state.barYear;
  const values = Object.values(DATA.countries)
    .map(c => c.metrics[state.barMetric]?.[year])
    .filter(v => v != null && Number.isFinite(v));
  const med = median(values);
  const min = values.length ? Math.min(...values) : null;
  const max = values.length ? Math.max(...values) : null;

  document.getElementById('metricExplainer').innerHTML = `
    <div>
      <span class="me-group-tag ${def.group}">${def.group}</span>
      <div class="me-title">${def.label}</div>
    </div>
    <div class="me-body">${def.explainer}</div>
    <div class="me-stats">
      <div>EU-27 median · ${year}</div>
      <div class="value">${fmt(med, def.fmt)}</div>
      <div>range: ${fmt(min, def.fmt)} — ${fmt(max, def.fmt)} ${def.unit}</div>
    </div>
  `;
}

/* ---------- BAR CHART ---------- */
function renderBarChart() {
  const metric = state.barMetric;
  const year = state.barYear;
  const def = METRICS[metric];
  const highlight = state.barHighlight;
  const regionFilter = state.barRegion;

  let all = Object.values(DATA.countries).map(c => ({ ...c, value: c.metrics[metric]?.[year] }));
  if (regionFilter !== 'EU27') all = all.filter(c => c.region === regionFilter);

  // Split into with-data and without-data
  const withData = all.filter(c => c.value != null && Number.isFinite(c.value));
  const withoutData = all.filter(c => c.value == null || !Number.isFinite(c.value));

  withData.sort((a, b) => def.inverse ? a.value - b.value : b.value - a.value);
  withoutData.sort((a, b) => a.name.localeCompare(b.name));

  const max = withData[0]?.value || 1;

  const wrap = document.getElementById('barchart');
  let html = withData.map((c, i) => {
    const isYou = c.iso2 === highlight;
    const pct = (c.value / max) * 100;
    return `
      <div class="barchart-row ${isYou ? 'is-you' : ''}" data-iso="${c.iso2}">
        <div class="bc-rank">${i + 1}</div>
        <div class="bc-country">
          ${c.name}
          ${isYou ? '<span class="bc-you-badge">YOU</span>' : ''}
        </div>
        <div class="bc-bar-cell">
          <div class="bc-bar"><div class="bc-bar-fill" style="width:${pct.toFixed(1)}%;"></div></div>
        </div>
        <div class="bc-value">${fmt(c.value, def.fmt)}</div>
      </div>
    `;
  }).join('');

  if (withoutData.length > 0) {
    html += `
      <div class="barchart-nodata-header">Countries without ${def.label.toLowerCase()} data for ${year}</div>
    `;
    html += withoutData.map(c => {
      const isYou = c.iso2 === highlight;
      return `
        <div class="barchart-row barchart-row-nodata ${isYou ? 'is-you' : ''}" data-iso="${c.iso2}">
          <div class="bc-rank">—</div>
          <div class="bc-country">
            ${c.name}
            ${isYou ? '<span class="bc-you-badge">YOU</span>' : ''}
          </div>
          <div class="bc-bar-cell">
            <div class="bc-bar"><div class="bc-bar-fill bc-bar-nodata"></div></div>
          </div>
          <div class="bc-value bc-value-nodata">no data</div>
        </div>
      `;
    }).join('');
  }

  html += `
    <div class="barchart-legend">
      <div class="bl-item"><span class="bl-swatch" style="background:var(--eu-blue);"></span>${regionFilter === 'EU27' ? 'EU-27 member states' : regionFilter + ' member states'}</div>
      <div class="bl-item"><span class="bl-swatch" style="background:var(--you);"></span>${DATA.countries[highlight]?.name || 'Your country'}${highlight === USER_COUNTRY ? ' · detected from your location' : ''}</div>
      ${withoutData.length ? `<div class="bl-item" style="margin-left:auto;color:var(--ink-faint);">${withoutData.length} of ${all.length} missing data</div>` : ''}
    </div>
  `;
  wrap.innerHTML = html;

  wrap.querySelectorAll('.barchart-row[data-iso]').forEach(row => {
    row.addEventListener('click', () => {
      const iso = row.dataset.iso;
      state.profileCountry = iso;
      document.getElementById('profileCountry').value = iso;
      renderProfile();
      document.getElementById('profile-section').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });

  const total = Object.keys(DATA.countries).length;
  document.getElementById('barStatus').textContent = all.length === total
    ? `${withData.length} of ${total} with data${withoutData.length ? ` · ${withoutData.length} missing` : ''}`
    : `${withData.length}/${all.length} with data · ${regionFilter}`;
}

/* ---------- YOU SUMMARY ---------- */
function renderYouSummary() {
  const c = DATA.countries[USER_COUNTRY];
  if (!c) return;

  const year = state.barYear;
  const latest = (m) => c.metrics[m]?.[year];
  const eu27Median = (m) => {
    const vals = Object.values(DATA.countries).map(cc => cc.metrics[m]?.[year]).filter(v => v != null);
    return median(vals);
  };

  const intensity = latest('intensity');
  const intensityMedian = eu27Median('intensity');
  const intensityRank = rankOf(USER_COUNTRY, 'intensity', year, false);

  const seasonality = latest('seasonality_peak');
  const seasonalityMedian = eu27Median('seasonality_peak');
  const seasonalityRank = rankOf(USER_COUNTRY, 'seasonality_peak', year, true); // lower = better

  const gva = latest('gva_share');
  const gvaMedian = eu27Median('gva_share');

  const certDensity = latest('cert_density');
  const certDensityMedian = eu27Median('cert_density');
  const certRank = rankOf(USER_COUNTRY, 'cert_density', year, false);

  // Position helpers
  const relIntensity =
    intensity > intensityMedian * 1.5 ? 'a high-intensity' :
    intensity < intensityMedian * 0.6 ? 'a low-intensity' :
    'a moderate-intensity';
  const relSeasonality =
    seasonality > seasonalityMedian * 1.2 ? 'strongly seasonal' :
    seasonality < seasonalityMedian * 0.85 ? 'well-distributed year-round' :
    'moderately seasonal';
  const relGva =
    gva > gvaMedian * 1.3 ? 'significantly above' :
    gva < gvaMedian * 0.7 ? 'below' :
    'near';
  const relCert = certDensity == null ? null :
    certDensity > certDensityMedian * 1.5 ? 'above-average' :
    certDensity < certDensityMedian * 0.6 ? 'below-average' :
    'near-median';

  // Build summary — 3-4 sentences
  const sentences = [];
  sentences.push(
    `${c.name} runs <strong>${relIntensity} tourism sector</strong> (${fmt(intensity, 'decimal')} nights per inhabitant, ${intensityRank.rank <= 7 ? 'ranking' : 'placing'} ${intensityRank.rank}th of ${intensityRank.total} in the EU-27), ` +
    (intensity > intensityMedian ?
      `above the EU median of ${fmt(intensityMedian, 'decimal')}.` :
      `compared with an EU median of ${fmt(intensityMedian, 'decimal')}.`)
  );

  sentences.push(
    `Seasonality is <strong>${relSeasonality}</strong> — ${fmt(seasonality, 'decimal')}% of annual nights fall in the peak month (EU median: ${fmt(seasonalityMedian, 'decimal')}%), ` +
    (seasonality > seasonalityMedian * 1.2 ?
      `pointing to concentrated summer pressure on local infrastructure and labour markets.` :
      seasonality < seasonalityMedian * 0.85 ?
      `suggesting a balanced year-round visitor flow that reduces off-peak economic volatility.` :
      `placing the country in the middle of the EU range.`)
  );

  sentences.push(
    `Economic dependence on tourism — measured as the accommodation & food services share of gross value added — is <strong>${relGva} the EU median</strong> ` +
    `(${fmt(gva, 'decimal')}% vs ${fmt(gvaMedian, 'decimal')}%), ` +
    (gva > gvaMedian * 1.3 ?
      `indicating a structural reliance on tourism demand.` :
      gva < gvaMedian * 0.7 ?
      `suggesting a diversified economy less exposed to tourism shocks.` :
      `consistent with a typical European tourism economy.`)
  );

  if (certDensity != null) {
    sentences.push(
      `Green Key certification coverage is <strong>${relCert}</strong> (${fmt(certDensity, 'decimal')} per 1,000 establishments, EU median: ${fmt(certDensityMedian, 'decimal')}; rank ${certRank.rank}/${certRank.total}), ` +
      (certDensity > certDensityMedian * 1.5 ?
        `signalling strong sector engagement with sustainability certification.` :
        certDensity < certDensityMedian * 0.6 ?
        `indicating limited uptake of voluntary sustainability certification so far.` :
        `in line with EU-wide certification patterns.`)
    );
  } else {
    sentences.push(
      `Green Key certification data is not yet available for ${c.name} in our dataset.`
    );
  }

  document.getElementById('youSummaryKicker').textContent = `Your country · detected from your location`;
  document.getElementById('youSummaryTitle').innerHTML = `How is <em>${c.name}</em> doing?`;
  document.getElementById('youSummaryBody').innerHTML = sentences.join(' ');
  document.getElementById('youSummaryFooter').textContent = `Region: ${c.region} · Joined EU: ${c.joined_eu} · Comparison year: ${year}`;
}

/* ---------- PROFILE ---------- */
function renderProfile() {
  const country = DATA.countries[state.profileCountry];
  if (!country) return;

  let compareKey = state.profileCompare === 'region' ? country.region : state.profileCompare;
  const region = DATA.regions[compareKey];
  document.getElementById('radarLegendCountry').textContent = country.name;
  document.getElementById('radarLegendRegion').textContent = region ? `${region.label} (median)` : 'Region';

  const isYou = country.iso2 === USER_COUNTRY;
  document.getElementById('radarCountrySwatch').style.background = isYou ? 'var(--you)' : 'var(--eu-blue)';
  document.getElementById('radarCountrySwatch').style.borderColor = isYou ? 'var(--you)' : 'var(--eu-blue)';

  renderProfileSummary(country, region, isYou);
  renderRadar(country, region, isYou);
  renderTimeseriesGrid(country, isYou);
}

function renderProfileSummary(country, region, isYou) {
  const year = state.profileYear;
  const baselineYear = '2019';

  const rows = Object.entries(METRICS).map(([key, def]) => {
    const latest = country.metrics[key]?.[year];
    const baseline = country.metrics[key]?.[baselineYear];
    const delta = fmtDelta(latest, baseline, def.inverse);
    const isInverse = def.inverse ? ' inverse' : '';
    return `
      <div class="metric-row${isInverse}">
        <div class="metric-row-label">
          ${def.label}
          <span class="unit">${def.unit}</span>
        </div>
        <div>
          <div class="metric-row-value">${fmt(latest, def.fmt)}</div>
          <span class="metric-row-delta ${delta.cls}">${delta.text}</span>
        </div>
      </div>
    `;
  }).join('');

  const el = document.getElementById('profileSummary');
  el.className = 'profile-summary' + (isYou ? ' is-you' : '');
  el.innerHTML = `
    <div class="profile-flag">${country.region.toUpperCase()} · JOINED EU ${country.joined_eu}${isYou ? ' · YOUR COUNTRY' : ''}</div>
    <div class="profile-name">${country.name}</div>
    <div class="profile-region">8 indicators · ${year}</div>
    <div class="metric-list">${rows}</div>
  `;
}

function renderRadar(country, region, isYou) {
  const svg = d3.select('#profileRadarSvg');
  svg.selectAll('*').remove();
  const width = 400, height = 380;
  const cx = width / 2, cy = height / 2 - 10;
  const radius = 130;

  const year = state.profileYear;
  const metrics = RADAR_METRICS;
  const n = metrics.length;

  const normalizedCountry = metrics.map(metric => {
    const allVals = Object.values(DATA.countries)
      .map(c => c.metrics[metric]?.[year])
      .filter(v => v != null && Number.isFinite(v));
    if (!allVals.length) return 0;
    const min = Math.min(...allVals);
    const max = Math.max(...allVals);
    const v = country.metrics[metric]?.[year];
    if (v == null || max === min) return 0;
    let norm = (v - min) / (max - min);
    if (METRICS[metric].inverse) norm = 1 - norm;
    return norm;
  });

  const normalizedRegion = metrics.map(metric => {
    const allVals = Object.values(DATA.countries)
      .map(c => c.metrics[metric]?.[year])
      .filter(v => v != null && Number.isFinite(v));
    if (!allVals.length) return 0;
    const min = Math.min(...allVals);
    const max = Math.max(...allVals);
    const v = region?.metrics[metric]?.[year]?.median;
    if (v == null || max === min) return 0;
    let norm = (v - min) / (max - min);
    if (METRICS[metric].inverse) norm = 1 - norm;
    return norm;
  });

  for (let r = 1; r <= 4; r++) {
    svg.append('circle').attr('cx', cx).attr('cy', cy).attr('r', (radius * r) / 4).attr('class', 'radar-grid');
  }
  metrics.forEach((metric, i) => {
    const angle = -Math.PI / 2 + (i / n) * 2 * Math.PI;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    svg.append('line').attr('x1', cx).attr('y1', cy).attr('x2', x).attr('y2', y).attr('class', 'radar-axis');
    const lx = cx + Math.cos(angle) * (radius + 22);
    const ly = cy + Math.sin(angle) * (radius + 22);
    const label = METRICS[metric].label.length > 18 ? METRICS[metric].label.slice(0, 16) + '…' : METRICS[metric].label;
    svg.append('text').attr('x', lx).attr('y', ly + 3).attr('class', 'radar-axis-label').text(label);
  });

  drawRadarPolygon(svg, normalizedRegion, cx, cy, radius, 'radar-area-region', 'radar-point-region');
  drawRadarPolygon(svg, normalizedCountry, cx, cy, radius,
    'radar-area-country' + (isYou ? ' is-you' : ''),
    'radar-point-country' + (isYou ? ' is-you' : ''));
}

function drawRadarPolygon(svg, normalized, cx, cy, radius, areaCls, pointCls) {
  const n = normalized.length;
  const points = normalized.map((v, i) => {
    const angle = -Math.PI / 2 + (i / n) * 2 * Math.PI;
    const r = radius * Math.max(0.05, v);
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  });
  svg.append('path').attr('d', `M ${points.map(p => p.join(',')).join(' L ')} Z`).attr('class', areaCls);
  points.forEach(p => {
    svg.append('circle').attr('cx', p[0]).attr('cy', p[1]).attr('r', 3).attr('class', pointCls);
  });
}

function renderTimeseriesGrid(country, isYou) {
  const grid = document.getElementById('timeseriesGrid');
  grid.innerHTML = '';
  Object.entries(METRICS).forEach(([key, def]) => {
    const series = country.metrics[key] || {};
    const years = Object.keys(series).sort();
    if (years.length === 0) return;
    const values = years.map(y => series[y]).filter(v => v != null && Number.isFinite(v));
    if (values.length === 0) return;
    const latestIdx = years.indexOf(state.profileYear);
    const latest = (latestIdx >= 0 && Number.isFinite(series[state.profileYear])) ? series[state.profileYear] : values[values.length - 1];

    const min = Math.min(...values);
    const max = Math.max(...values);
    const range = max - min;
    const w = 160, h = 36;
    const validYears = years.filter(y => Number.isFinite(series[y]));
    const xs = validYears.map((_, i) => validYears.length > 1 ? (i / (validYears.length - 1)) * w : w / 2);
    const ys = validYears.map(y => {
      if (range === 0) return h / 2;
      return h - ((series[y] - min) / range) * h * 0.85 - h * 0.075;
    });
    const linePts = xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ');
    const hasArea = xs.length >= 2;
    const areaPts = hasArea ? `${xs[0].toFixed(1)},${h} ${linePts} ${xs[xs.length - 1].toFixed(1)},${h}` : '';

    const card = document.createElement('div');
    card.className = 'ts-card' + (isYou ? ' is-you' : '');
    card.innerHTML = `
      <div class="ts-card-label">${def.label}</div>
      <div class="ts-card-value">${fmt(latest, def.fmt)}</div>
      <svg class="ts-card-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
        ${hasArea ? `<polygon class="ts-area" points="${areaPts}" />` : ''}
        ${linePts ? `<polyline class="ts-line" points="${linePts}" />` : ''}
      </svg>
    `;
    grid.appendChild(card);
  });
}

/* ---------- RENDER ALL ---------- */
function renderAll() {
  renderMetricExplainer();
  renderBarChart();
  renderProfile();
}

/* ---------- BOOT ---------- */
loadAll().catch(err => {
  console.error(err);
  document.querySelector('.wrap').innerHTML = `
    <div style="padding: 80px 0; text-align: center; color: var(--ink-dim);">
      <div style="font-family: 'Fraunces', serif; font-size: 28px; color: var(--ink); margin-bottom: 16px;">
        Failed to load data
      </div>
      <div style="font-family: 'JetBrains Mono', monospace; font-size: 12px;">
        ${err.message}
      </div>
      <div style="margin-top: 16px; font-size: 13px;">
        Make sure <code>data/eu27.json</code> is alongside this dashboard.
      </div>
    </div>
  `;
});
