import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Small point collections are plain GeoJSON, never vector tiles. Coordinates
// and all attributes are copied exactly from the checked-in source.
export async function publishStations(manifest) {
  for(const map of manifest.maps) for(const layer of map.layers) {
    if(layer.geometryType!=='esriGeometryPoint') continue;
    layer.dataFile ||= `${layer.id}.geojson`;
    layer.geojson=layer.dataFile;
    await fs.copyFile(`data/maps/${layer.dataFile}`,`public/assets/maps/${layer.geojson}`);
    for(const file of [layer.archive,layer.attributes]) if(file) await fs.rm(`public/assets/maps/${file}`,{force:true});
    for(const key of ['archive','attributes','tileLayer','tiles','bytes']) delete layer[key];
  }
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const file='public/assets/maps/manifest.json';
  const manifest=JSON.parse(await fs.readFile(file));
  await publishStations(manifest);
  await fs.writeFile(file,JSON.stringify(manifest)+'\n');
}
