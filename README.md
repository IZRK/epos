# EPOS Slovenia

## Development

Requirements: Node.js 22 and npm.

```sh
npm ci
npm run dev
```

The development server is available at `http://localhost:8080`.

## Build

```sh
npm run build
```

The generated website is written to `_site/`.

Run the complete build and validation suite with:

```sh
npm test
```

## GitHub Pages

The workflow in `.github/workflows/pages.yml` publishes the site after pushes to `main` and can also be run manually. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**.

Both project Pages URLs and custom domains are supported. The workflow uses the Pages base path automatically, so the same source works at `username.github.io/repository/` and at the root of a custom domain. Configure the domain under **Settings → Pages → Custom domain**.

The repository is now <https://github.com/IZRK/epos>, published at <https://izrk.github.io/epos/>. After renaming the repository, rerun **Publish website**: already published HTML retains its previous asset prefix until rebuilt. Keep the workflow's `configure-pages` variables.

Check this deployment locally with:

```sh
PATH_PREFIX=/epos SITE_URL=https://izrk.github.io/epos npm test
npx playwright install chromium
PATH_PREFIX=/epos npm run test:browser
```

## Local maps and StoryMap content

The full StoryMap narrative is at **https://izrk.github.io/epos/data-sites/**. That content page, `/slo-karst-nfo/`, and standalone maps use one Leaflet component (`src/map/map.js` and `src/_includes/components/local-map.njk`). Standalone URLs are `/maps/stations/` and `/maps/slo-karst/`. Other sites can embed, for example:

```html
<iframe src="https://izrk.github.io/epos/maps/slo-karst/"
        title="SLO KARST NFO" width="100%" height="650"
        style="border:0" loading="lazy" allowfullscreen></iframe>
```

Maps are rendered directly, without iframes. Scripts, styles, marker symbols, vectors, attributes and images are local. The only external map requests are the requested Esri World Topographic XYZ tiles. YouTube video embeds are retained as requested; source/citation and data-portal hyperlinks remain user-activated links. The map works without a remote ArcGIS application or FeatureServer. Base tiles need internet access.

The narrative audit matches all 40 blocks and credits against the original StoryMap. Reference layers come from original shapefiles; their download URLs and SHA-256 checksums are retained in `data/maps/originals/sources.json`. ZIP downloads are disposable build inputs, not site assets, and are not checked in:

- Karst: [Gostinčar & Stepišnik, PANGAEA.965529](https://doi.org/10.1594/PANGAEA.965529), CC BY 4.0. The original Figure 6 shapefile has 12,734 polygons, of which 6,322 are classified as karst. These are rendered with the publication's eight lithological classes. The broken, empty 2016 layer in the stations map is explicitly replaced by this 2023 dataset.
- Faults: [GeoZS MAF.SI](https://egeologija.si/geonetwork/srv/eng/catalog.search#/metadata/0a02f07a-b0a4-46df-b4e3-2276f9aa5d9c), original `MAF_SI_2020` shapefile, 240 segments. This replaces the ArcGIS snapshots (one had 241 records); it is the downloadable 2020 source, not a claim to the latest fault database.
- Cohesion regions and country outline: [Eurostat/GISCO NUTS 2024](https://ec.europa.eu/eurostat/web/gisco/geodata/statistical-units/territorial-units-statistics), 1:1 million shapefiles, selecting Slovenia. Legacy region demographics remain available in the tables and are not represented as 2024 population values.

Station coordinates and equipment attributes remain from the original institution-specific StoryMap collections, including the newer 2024 NFO layers; these were not substituted with unrelated public station datasets. Original ArcGIS definitions remain in `data/maps/` for provenance. Current GeoJSON is retained there, with PMTiles and attribute tables in `public/assets/maps/`.

Polygon and line tiles are drawn into clipped tile canvases, preserving the MVT buffer without overlapping fills or drawing artificial cut edges. Point symbols stay keyboard-accessible Leaflet markers; polygon/line clicks use canvas hit testing. Styling gives the karst categories, faults and stations distinct visual roles.

`npm test` verifies the narrative and every archived vector tile, feature ID and attribute value. Browser tests check desktop/mobile layouts, popups, legend, layer toggles, attribute search, byte ranges, iframe embeddability and the external-request allowlist, plus a pixel regression for tile-edge transparency and polygon holes at 1x/2x display density. YouTube player contents are stubbed in browser tests; the embed URLs are checked.

`npm run build:reference-maps` downloads the original shapefiles into ignored `.cache/map-sources/`, verifies their recorded checksums, and rebuilds reference layers and styling. Subsequent runs reuse that cache, which can be deleted at any time. If a provider returns an HTML download page instead of a ZIP, download the linked original through a browser into the cache filename reported by the script. `npm run refresh:maps` refreshes the institution-specific ArcGIS collections and then reapplies those original shapefile sources. Identical datasets share one GeoJSON, PMTiles archive and attribute table across maps; the manifest records the shared filenames and internal tile-layer name independently of display styling. Unused imported marker PNGs are removed after rebuilding reference styles.

`node scripts/rebuild-maps.mjs` rebuilds all archives from checked-in GeoJSON **without network access or ZIPs**. Normal site builds use committed archives and do not contact ArcGIS. Source projection is converted to WGS84 before tiling. Library assets are bundled during the build; Leaflet's license is copied alongside its stylesheet.
