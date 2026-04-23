/**
 * EU-27 country reference with regional groupings.
 *
 * Eurostat uses ISO-2 codes with one exception: Greece is "EL" not "GR".
 * UK uses "UK" not "GB" in older series.
 */

export const EU27 = [
  // ISO-2  EurostatCode  Name              Region              JoinedEU
  ['AT', 'AT', 'Austria',         'CEE',         1995],
  ['BE', 'BE', 'Belgium',         'Western',     1957],
  ['BG', 'BG', 'Bulgaria',        'CEE',         2007],
  ['HR', 'HR', 'Croatia',         'CEE',         2013],
  ['CY', 'CY', 'Cyprus',          'Mediterranean', 2004],
  ['CZ', 'CZ', 'Czechia',         'CEE',         2004],
  ['DK', 'DK', 'Denmark',         'Nordics',     1973],
  ['EE', 'EE', 'Estonia',         'Baltics',     2004],
  ['FI', 'FI', 'Finland',         'Nordics',     1995],
  ['FR', 'FR', 'France',          'Western',     1957],
  ['DE', 'DE', 'Germany',         'Western',     1957],
  ['GR', 'EL', 'Greece',          'Mediterranean', 1981],
  ['HU', 'HU', 'Hungary',         'CEE',         2004],
  ['IE', 'IE', 'Ireland',         'Western',     1973],
  ['IT', 'IT', 'Italy',           'Mediterranean', 1957],
  ['LV', 'LV', 'Latvia',          'Baltics',     2004],
  ['LT', 'LT', 'Lithuania',       'Baltics',     2004],
  ['LU', 'LU', 'Luxembourg',      'Western',     1957],
  ['MT', 'MT', 'Malta',           'Mediterranean', 2004],
  ['NL', 'NL', 'Netherlands',     'Western',     1957],
  ['PL', 'PL', 'Poland',          'CEE',         2004],
  ['PT', 'PT', 'Portugal',        'Mediterranean', 1986],
  ['RO', 'RO', 'Romania',         'CEE',         2007],
  ['SK', 'SK', 'Slovakia',        'CEE',         2004],
  ['SI', 'SI', 'Slovenia',        'CEE',         2004],
  ['ES', 'ES', 'Spain',           'Mediterranean', 1986],
  ['SE', 'SE', 'Sweden',          'Nordics',     1995]
];

/** Regional groupings — used for "compare with..." dropdown in dashboard. */
export const REGIONS = {
  CEE:           ['AT', 'BG', 'HR', 'CZ', 'HU', 'PL', 'RO', 'SK', 'SI'],
  Western:       ['BE', 'FR', 'DE', 'IE', 'LU', 'NL'],
  Mediterranean: ['CY', 'GR', 'IT', 'MT', 'PT', 'ES'],
  Nordics:       ['DK', 'FI', 'SE'],
  Baltics:       ['EE', 'LV', 'LT'],
  EU27:          EU27.map(c => c[0])
};

export const REGION_LABELS = {
  CEE:           'Central & Eastern Europe',
  Western:       'Western Europe',
  Mediterranean: 'Mediterranean',
  Nordics:       'Nordics',
  Baltics:       'Baltics',
  EU27:          'All EU-27'
};

/** Eurostat code → ISO-2 conversion (only differs for Greece). */
export function toISO2(eurostatCode) {
  if (eurostatCode === 'EL') return 'GR';
  return eurostatCode;
}

/** ISO-2 → Eurostat code conversion. */
export function toEurostatCode(iso2) {
  if (iso2 === 'GR') return 'EL';
  return iso2;
}

export function countryName(iso2) {
  const row = EU27.find(c => c[0] === iso2);
  return row ? row[2] : iso2;
}

export function countryRegion(iso2) {
  const row = EU27.find(c => c[0] === iso2);
  return row ? row[3] : null;
}
