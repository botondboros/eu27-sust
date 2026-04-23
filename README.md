# EU-27 Tourism Sustainability Profile

Interactive dashboard tracking tourism sustainability across the 27 EU member states, 2019–2025.

**Live:** https://botondboros.github.io/eu27-sust

## What this measures

Eight indicators grouped into three buckets:

| Bucket | Indicators |
|---|---|
| **Volume** | Tourist arrivals, nights spent, average length of stay |
| **Pressure** | Tourism intensity, seasonality (peak month + Gini), economic dependence |
| **Sustainability infrastructure** | Accommodation capacity, Green Key certified properties, cert density |

Details on every metric — including what it does and does not capture — are documented on the **Methodology** tab of the dashboard.

## Data sources

All figures come from one of two public sources. No estimation, no proxy guesses for the metrics that matter.

| Indicator | Source | Dataset code |
|---|---|---|
| Arrivals | Eurostat | `tour_occ_arnat` |
| Nights spent | Eurostat | `tour_occ_ninat` |
| Monthly nights (seasonality) | Eurostat | `tour_occ_nim` |
| Population | Eurostat | `demo_gind` |
| Sectoral GVA share (proxy) | Eurostat | `nama_10_a64` |
| Accommodation capacity | Eurostat | `tour_cap_nat` |
| Sustainability certifications | Green Key International | monthly xlsx |

The NACE I sector GVA share is used as a **proxy** for tourism economic dependence because Eurostat's dedicated Tourism Satellite Accounts dataset (`tour_eco_int`) was discontinued from public dissemination. Limitations are documented in the dashboard.

## Structure

```
eu27_sust/
├── scripts/
│   ├── build.js          # Eurostat fetch + cert data merge pipeline
│   ├── eurostat.js       # JSON-stat 2.0 API client with disk cache
│   └── countries.js      # EU-27 reference + regional groupings
├── data/
│   ├── cache/            # Per-URL Eurostat response cache (7-day TTL)
│   └── eu27.json         # Canonical output consumed by the dashboard
├── public/
│   ├── index.html        # Dashboard UI
│   ├── dashboard.js      # D3-powered visualisations
│   └── data/eu27.json    # Copy served by GitHub Pages
└── package.json
```

## Running locally

Requires Node.js 20+.

```bash
npm install
npm run build
cd public && python -m http.server 8000
```

Open `http://localhost:8000`.

### Refreshing certification data

Green Key cert counts come from [botondboros/hotel-sustainability-scraper](https://github.com/botondboros/hotel-sustainability-scraper). To include them in the build:

```bash
node scripts/build.js --cert-path=/path/to/hotels.json
```

The dashboard automatically fetches the latest release of the scraper at runtime when deployed.

## Refresh cadence

- **Eurostat annual data** — published Q4 each year. GitHub Actions workflow refreshes weekly.
- **Green Key registry** — monthly xlsx. Scraper runs monthly and publishes a GitHub Release.

## License

MIT. Data remains © Eurostat / Green Key International; they retain their respective licences.

## Built by

Botond Boros · [LinkedIn](https://www.linkedin.com/in/botondboros/) · [GitHub](https://github.com/botondboros)
