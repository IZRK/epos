import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { arcgisToGeoJSON } from '@terraformer/arcgis';
import { writeArchive } from './pmtiles-writer.mjs';

const directory = new URL('../public/assets/maps/', import.meta.url);
const sources = new URL('../data/maps/', import.meta.url);
await fs.mkdir(directory,{recursive:true}); await fs.mkdir(sources,{recursive:true});
const itemBase='https://www.arcgis.com/sharing/rest/content/items/';
function convertFeature(f, source, def, webmap) {
  const sr=f.geometry.spatialReference || source.featureSet.spatialReference || def.spatialReference || def.extent?.spatialReference || webmap.spatialReference;
  const wkid=sr?.latestWkid || sr?.wkid;
  if(![4326,3857,102100].includes(wkid)) throw new Error(`Unsupported source projection ${wkid}`);
  const geometry={...f.geometry}; delete geometry.spatialReference;
  const converted=arcgisToGeoJSON({...f,geometry});
  function project(c) {
    if(typeof c[0]==='number') return [c[0]/20037508.342789244*180,Math.atan(Math.sinh(c[1]/6378137))*180/Math.PI];
    return c.map(project);
  }
  if(wkid!==4326) converted.geometry.coordinates=project(converted.geometry.coordinates);
  return converted;
}
async function json(url) {
  const r=await fetch(url); if(!r.ok) throw new Error(`${r.status} ${url}`);
  const d=await r.json(); if(d.error) throw new Error(JSON.stringify(d.error)); return d;
}
async function save(base,name,data) { await fs.writeFile(new URL(name,base),JSON.stringify(data)+'\n'); }
const story=await json(`${itemBase}ec3c6d784536473bab965af575a6d131/data?f=json`);
await save(sources,'story-source.json',story);
const mapDefs=[['stations','daba1ce3c7c74957af450092afb31e41'],['slo-karst','12fdef716cc64c30b667b9100d2ef24f']];
const manifest={ retrievedAt:new Date().toISOString(), maps:[] };
for(const [slug,id] of mapDefs) {
  const [webmap,item]=await Promise.all([json(`${itemBase}${id}/data?f=json`),json(`${itemBase}${id}?f=json`)]);
  await save(sources,`${slug}-webmap.json`,webmap);
  await save(sources,`${slug}-item.json`,item);
  const storyNode=Object.values(story.nodes).find(n=>n.type==='webmap' && story.resources[n.data.map]?.data.itemId===id);
  const map={slug,title:slug==='stations'?'EPOS & RI-SI-EPOS stations':'SLO KARST NFO',center:slug==='stations'?[46.3,14.78]:[45.8,14.35],zoom:slug==='stations'?8:9,layers:[]};
  for(const layer of webmap.operationalLayers) {
    let collection=layer.featureCollection?.layers;
    if(!layer.url && (!collection || collection.some(l=>!l.featureSet))) {
      const data=await json(`${itemBase}${layer.itemId}/data?f=json`);
      await save(sources,`${layer.itemId}.json`,data);
      collection=(data.layers || data.featureCollection?.layers).map((l,i)=>({...l,...collection?.[i],featureSet:l.featureSet,layerDefinition:{...l.layerDefinition,...collection?.[i]?.layerDefinition}}));
    }
    if(layer.url) {
      const def=await json(`${layer.url}?f=json`);
      const ids=await json(`${layer.url}/query?f=json&where=1%3D1&returnIdsOnly=true`);
      const features=[];
      for(let i=0;i<ids.objectIds.length;i+=200) {
        const batch=ids.objectIds.slice(i,i+200);
        const data=await json(`${layer.url}/query?f=geojson&objectIds=${batch.join(',')}&outFields=*&outSR=4326&returnGeometry=true`);
        if(data.features.length!==batch.length) throw new Error(`Incomplete service batch ${layer.id}`);
        features.push(...data.features);
      }
      collection=[{layerDefinition:{...def,...layer.layerDefinition},geojson:{type:'FeatureCollection',features},popupInfo:layer.popupInfo}];
      const downloadedIds=new Set(features.map(f=>f.properties[def.objectIdField]));
      if(downloadedIds.size!==ids.objectIds.length || ids.objectIds.some(id=>!downloadedIds.has(id))) throw new Error(`Incomplete service IDs ${layer.id}`);
      await save(sources,`${layer.id}-definition.json`,def);
    }
    for(let i=0;i<collection.length;i++) {
      const source=collection[i],def=source.layerDefinition;
      const key=`${slug}-${layer.id}${i?`-${i}`:''}`;
      const geojson=source.geojson || {type:'FeatureCollection', features:source.featureSet.features.map(f=>convertFeature(f,source,def,webmap))};
      if(geojson.features.some(f=>!f.geometry)) throw new Error(`Missing geometry ${key}`);
      geojson.features.forEach((f,index)=>{f.id=index; f.properties.__id=index;});
      await save(sources,`${key}.geojson`,geojson);
      const renderer=structuredClone(def.drawingInfo?.renderer);
      if(!renderer) throw new Error(`Missing renderer ${key}`);
      // Embedded ArcGIS picture symbols become same-origin assets, including legend icons.
      async function localize(object) {
        if(!object || typeof object!=='object') return;
        if(object.type==='esriPMS') {
          const bytes=object.imageData?Buffer.from(object.imageData,'base64'):Buffer.from(await (await fetch(object.url.replace(/^http:/,'https:'))).arrayBuffer());
          const filename=`symbol-${createHash('sha256').update(bytes).digest('hex').slice(0,16)}.png`;
          await fs.writeFile(new URL(filename,directory),bytes); object.localImage=filename; delete object.url; delete object.imageData;
        }
        for(const value of Object.values(object)) if(typeof value==='object') await localize(value);
      }
      await localize(renderer);
      const isPoint=def.geometryType==='esriGeometryPoint';
      const archive=isPoint?{}:await writeArchive(new URL(`${key}.pmtiles`,directory),geojson,key);
      const storyLayer=storyNode?.data.mapLayers?.find(l=>l.id===layer.id);
      const entry={id:key,sourceId:layer.id,title:layer.title,visible:storyLayer?.visible ?? layer.visibility ?? true,opacity:layer.opacity ?? 1,geometryType:def.geometryType,renderer,popup:layer.popupInfo || source.popupInfo || null,fields:def.fields || [],minScale:layer.minScale ?? def.minScale ?? 0,maxScale:layer.maxScale ?? def.maxScale ?? 0,count:geojson.features.length,archive:`${key}.pmtiles`,attributes:`${key}.json`,...archive};
      if(isPoint) {
        entry.geojson=`${key}.geojson`;
        delete entry.archive;delete entry.attributes;
        await save(directory,entry.geojson,geojson);
      } else await save(directory,entry.attributes,geojson.features.map(f=>f.properties));
      entry.labelingInfo=structuredClone(def.drawingInfo?.labelingInfo || []);
      map.layers.push(entry);
      console.log(isPoint?`${key}: ${entry.count} ordinary markers, local GeoJSON`:`${key}: ${entry.count} features, ${archive.tiles} tiles, ${(archive.bytes/1048576).toFixed(1)} MiB`);
    }
  }
  manifest.maps.push(map);
}
await save(directory,'manifest.json',manifest);
