// Share byte-identical datasets while keeping each map's styling and layer IDs.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

export async function compactMaps(manifest) {
  const datasets=new Map(),obsolete=new Set();
  for(const map of manifest.maps) for(const layer of map.layers) {
    const dataFile=layer.dataFile || `${layer.id}.geojson`;
    const data=await fs.readFile(`data/maps/${dataFile}`);
    const attributes=await fs.readFile(`public/assets/maps/${layer.attributes}`);
    const hash=createHash('sha256').update(data).update(attributes).digest('hex');
    const previous=datasets.get(hash);
    if(previous) {
      if(dataFile!==previous.dataFile) obsolete.add(`data/maps/${dataFile}`);
      if(layer.archive!==previous.archive) obsolete.add(`public/assets/maps/${layer.archive}`);
      if(layer.attributes!==previous.attributes) obsolete.add(`public/assets/maps/${layer.attributes}`);
      Object.assign(layer,previous);
    } else {
      layer.dataFile=dataFile;
      layer.tileLayer=layer.tileLayer || layer.id;
      datasets.set(hash,Object.fromEntries(['dataFile','tileLayer','archive','attributes','tiles','bytes','bounds'].map(key=>[key,layer[key]])));
    }
  }
  const retained=new Set(manifest.maps.flatMap(map=>map.layers.flatMap(layer=>[
    `data/maps/${layer.dataFile}`,`public/assets/maps/${layer.archive}`,`public/assets/maps/${layer.attributes}`
  ])));
  for(const file of obsolete) if(!retained.has(file)) await fs.unlink(file);
  const referenced=new Set();
  function images(value) {
    if(!value || typeof value!=='object') return;
    if(value.localImage) referenced.add(value.localImage);
    Object.values(value).forEach(images);
  }
  images(manifest);
  for(const file of await fs.readdir('public/assets/maps')) {
    if(/^symbol-.*\.png$/.test(file) && !referenced.has(file)) await fs.unlink(`public/assets/maps/${file}`);
  }
  console.log(`Map data compacted: ${datasets.size} shared datasets for ${manifest.maps.flatMap(map=>map.layers).length} layers.`);
}
