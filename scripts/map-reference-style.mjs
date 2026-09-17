import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function referenceLayers(slug) {
  const webmap=JSON.parse(await fs.readFile(`data/maps/${slug}-webmap.json`));
  return Promise.all(webmap.operationalLayers.map(async layer=>{
    let source=layer.featureCollection?.layers?.[0]?.layerDefinition;
    if(layer.itemId && !source?.drawingInfo && !layer.layerDefinition?.drawingInfo) {
      const item=JSON.parse(await fs.readFile(`data/maps/${layer.itemId}.json`));
      source=(item.layers || item.featureCollection?.layers)[0].layerDefinition;
    }
    return {...layer,definition:{...source,...layer.layerDefinition}};
  }));
}

async function localizeSymbols(value) {
  if(!value || typeof value!=='object') return;
  if(value.type==='esriPMS') {
    if(!value.imageData) throw new Error('Reference picture symbol has no local image data');
    const bytes=Buffer.from(value.imageData,'base64');
    value.localImage=`symbol-${createHash('sha256').update(bytes).digest('hex').slice(0,16)}.png`;
    await fs.writeFile(`public/assets/maps/${value.localImage}`,bytes);
    delete value.imageData;delete value.url;
  }
  for(const child of Object.values(value)) await localizeSymbols(child);
}

export async function applyReferenceStyles(manifest) {
  const karst=(await referenceLayers('slo-karst')).find(l=>/CarbonateRocks/.test(l.id));
  for(const map of manifest.maps) {
    const references=await referenceLayers(map.slug);
    for(const layer of map.layers) {
      // The empty 2016 karst dataset was replaced by the 2023 source; use the
      // 2023 reference symbol there too, without pretending it is 2016 data.
      const reference=/Sloji_/.test(layer.sourceId)?karst:references.find(l=>l.id===layer.sourceId);
      if(!reference?.definition.drawingInfo?.renderer) throw new Error(`Missing reference style: ${layer.id}`);
      layer.renderer=structuredClone(reference.definition.drawingInfo.renderer);
      await localizeSymbols(layer.renderer);
      layer.labelingInfo=structuredClone(reference.definition.drawingInfo.labelingInfo || []);
      layer.opacity=reference.opacity ?? 1;
      layer.title=reference.title;
      // Only the source geometry was replaced. Preserve each map's original
      // symbols and label scales instead of inventing a shared visual style.
    }
  }
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const file='public/assets/maps/manifest.json';
  const manifest=JSON.parse(await fs.readFile(file));
  await applyReferenceStyles(manifest);
  await fs.writeFile(file,JSON.stringify(manifest)+'\n');
}
