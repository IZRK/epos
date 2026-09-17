// Rebuild archives from the checked-in complete GeoJSON sources, without network access.
import fs from 'node:fs/promises';
import { writeArchive } from './pmtiles-writer.mjs';
import { publishStations } from './publish-stations.mjs';
const file='public/assets/maps/manifest.json';
const manifest=JSON.parse(await fs.readFile(file));
const rebuilt=new Map();
for(const map of manifest.maps) for(const layer of map.layers) {
  if(layer.geometryType==='esriGeometryPoint') continue;
  if(!rebuilt.has(layer.archive)) {
    const geojson=JSON.parse(await fs.readFile(`data/maps/${layer.dataFile || `${layer.id}.geojson`}`));
    rebuilt.set(layer.archive,await writeArchive(`public/assets/maps/${layer.archive}`,geojson,layer.tileLayer || layer.id));
  }
  Object.assign(layer,rebuilt.get(layer.archive));
}
await publishStations(manifest);
await fs.writeFile(file,JSON.stringify(manifest)+'\n');
