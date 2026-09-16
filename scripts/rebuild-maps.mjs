// Rebuild archives from the checked-in complete GeoJSON sources, without network access.
import fs from 'node:fs/promises';
import { writeArchive } from './pmtiles-writer.mjs';
const file='public/assets/maps/manifest.json';
const manifest=JSON.parse(await fs.readFile(file));
for(const map of manifest.maps) for(const layer of map.layers) {
  const geojson=JSON.parse(await fs.readFile(`data/maps/${layer.id}.geojson`));
  Object.assign(layer,await writeArchive(`public/assets/maps/${layer.archive}`,geojson,layer.id));
}
await fs.writeFile(file,JSON.stringify(manifest)+'\n');
