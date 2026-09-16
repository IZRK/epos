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

The content page, `/slo-karst-nfo/`, and standalone maps use one Leaflet component (`src/map/map.js` and `src/_includes/components/local-map.njk`). Standalone URLs are `/maps/stations/` and `/maps/slo-karst/`. Other sites can embed, for example:

```html
<iframe src="https://izrk.github.io/epos/maps/slo-karst/"
        title="SLO KARST NFO" width="100%" height="650"
        style="border:0" loading="lazy" allowfullscreen></iframe>
```

Maps are rendered directly, without iframes. Scripts, styles, marker symbols, vectors, attributes and images are local. The only external map requests are the requested Esri World Topographic XYZ tiles. YouTube video embeds are retained as requested; source/citation and data-portal hyperlinks remain user-activated links. The map works without a remote ArcGIS application or FeatureServer. Base tiles need internet access.

The 2026-09-16 audit matched all 40 narrative blocks and credits against the original StoryMap. Both current web maps were downloaded, including hidden layers and their original symbols, visibility/scale rules and popup field labels. The archive contains 19 layers and 6,997 records. Four records in the old `Sloji` carbonate layer have empty geometry in the source; their attributes are retained, while the separate 2023 carbonate layer includes all 6,322 polygons. The current NFO map also contains the newer 2024 station layers. Full provenance and original definitions are in `data/maps/`; complete GeoJSON is retained there, with PMTiles and attribute tables in `public/assets/maps/`.

`npm test` verifies the narrative and every archived vector tile, feature ID and attribute value. Browser tests check desktop/mobile layouts, popups, legend, layer toggles, attribute search, byte ranges, iframe embeddability and the external-request allowlist. YouTube player contents are stubbed in browser tests; the embed URLs are checked.

Refresh live vector sources explicitly with `npm run refresh:maps`, or rebuild without network access with `node scripts/rebuild-maps.mjs`. Normal site builds use the committed archives and do not contact ArcGIS. Source projection is converted to WGS84 before tiling; all original attribute fields remain in the local tables. Library assets are bundled during the build; Leaflet's license is copied alongside its stylesheet.
