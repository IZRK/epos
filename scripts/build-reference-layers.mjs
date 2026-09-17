import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import shp from 'shpjs';
import { writeArchive } from './pmtiles-writer.mjs';
import { compactMaps } from './compact-maps.mjs';
import { applyReferenceStyles } from './map-reference-style.mjs';
import { publishStations } from './publish-stations.mjs';

const root='data/maps/originals/';
const sources=JSON.parse(await fs.readFile(root+'sources.json'));
const parsed={};
const cache='.cache/map-sources/';
await fs.mkdir(cache,{recursive:true});
for(const [key,source] of Object.entries(sources)) {
  let bytes;
  try { bytes=await fs.readFile(cache+source.file); }
  catch(error) {
    if(error.code!=='ENOENT') throw error;
    const response=await fetch(source.download,{signal:AbortSignal.timeout(60000)});
    if(!response.ok) throw new Error(`Download failed (${response.status}): ${source.download}`);
    bytes=Buffer.from(await response.arrayBuffer());
  }
  if(createHash('sha256').update(bytes).digest('hex')!==source.sha256)
    throw new Error(`Unexpected download for ${source.file}. Download the original ZIP from ${source.download} into ${cache}${source.file} and retry; do not replace the recorded checksum without reviewing the source.`);
  await fs.writeFile(cache+source.file,bytes);
  parsed[key]=await shp(bytes);
}
const karst=parsed.karst.find(c=>c.fileName.endsWith('Fig_6'));
const karstFeatures=karst.features.filter(f=>f.properties.Karst_EN!=='non-karst area');
if(karst.features.length!==12734 || karstFeatures.length!==6322) throw new Error('Unexpected original karst source count');
const manifestFile='public/assets/maps/manifest.json';
const manifest=JSON.parse(await fs.readFile(manifestFile));
for(const map of manifest.maps) {
  map.center=map.slug==='stations'?[46.06,14.95]:[45.77,14.25];
  map.zoom=map.slug==='stations'?8:10;
  map.bounds=map.slug==='stations'?[[45.42,13.35],[46.91,16.62]]:[[45.44,13.77],[46.04,14.85]];
  for(const layer of map.layers) {
    let features,provenance;
    if(/CarbonateRocks|Sloji_/.test(layer.sourceId)) {
      features=structuredClone(karstFeatures);provenance=sources.karst;
      layer.popup={title:'{Karst_EN}',fieldInfos:[{fieldName:'Karst_EN',label:'Karst type',visible:true},{fieldName:'Karst_SI',label:'Slovenian classification',visible:true},{fieldName:'Source',label:'Source',visible:true}]};
      layer.minScale=0;layer.maxScale=0;
      if(/Sloji_/.test(layer.sourceId)) layer.sourceNote='Replaces the empty 2016 web-map layer with the published 2023 dataset.';
    } else if(/active_fault/.test(layer.sourceId)) {
      features=structuredClone(parsed.faults.features);provenance=sources.faults;
      layer.popup={title:'{FAULT_NAME}',fieldInfos:['FAULT_NAME','FAULT_DESI','FAULT_TYPE','ACTIVITY','SLIPRATEMI','SLIPRATEMA','BEST_EST_2'].map((name,i)=>({fieldName:name,label:['Fault','Identifier','Fault type','Activity','Minimum slip rate','Maximum slip rate','Best slip-rate estimate'][i],visible:true}))};
    } else if(/Kohezijski/.test(layer.sourceId)) {
      const old=JSON.parse(await fs.readFile(`public/assets/maps/${layer.attributes}`));
      features=structuredClone(parsed.regions.features.filter(f=>f.properties.CNTR_CODE==='SI'));
      for(const feature of features) {
        const previous=old.find(p=>p.IME===feature.properties.NAME_LATN) || {};
        feature.properties={...previous,...feature.properties};
      }
      provenance=sources.regions;
      layer.popup={title:'{NAME_LATN}',fieldInfos:['NUTS_ID','NAME_LATN'].map(name=>({fieldName:name,label:name==='NUTS_ID'?'NUTS 2024 code':'Region',visible:true}))};
      layer.sourceNote='NUTS 2024 geometry; legacy demographic fields retained from the original StoryMap (not current population estimates).';
    } else if(layer.sourceId==='Slovenia_shapefile_9975') {
      features=structuredClone(parsed.country.features.filter(f=>f.properties.CNTR_CODE==='SI'));provenance=sources.country;
      layer.popup={title:'Slovenia',fieldInfos:[{fieldName:'NUTS_ID',label:'Country code',visible:true},{fieldName:'NAME_LATN',label:'Name',visible:true}]};
    }
    if(features) {
      // A prior build may have shared these files with another map.
      layer.dataFile=`${layer.id}.geojson`;layer.tileLayer=layer.id;
      layer.archive=`${layer.id}.pmtiles`;layer.attributes=`${layer.id}.json`;
      features.forEach((f,index)=>{
        f.id=index;f.properties.__id=index;
        for(const [key,value] of Object.entries(f.properties)) if(typeof value==='number'&&!Number.isFinite(value)) f.properties[key]=null;
      });
      const geojson={type:'FeatureCollection',features};
      layer.fields=Object.keys(features[0].properties).filter(k=>k!=='__id').map(name=>({name,alias:layer.fields.find(f=>f.name===name)?.alias || name,type:typeof features[0].properties[name]==='number'?'esriFieldTypeDouble':'esriFieldTypeString'}));
      layer.provenance=provenance;layer.count=features.length;
      await fs.writeFile(`data/maps/${layer.id}.geojson`,JSON.stringify(geojson)+'\n');
      await fs.writeFile(`public/assets/maps/${layer.attributes}`,JSON.stringify(features.map(f=>f.properties))+'\n');
      Object.assign(layer,await writeArchive(`public/assets/maps/${layer.archive}`,geojson,layer.id));
      console.log(`${layer.id}: ${features.length} features from ${provenance.file}`);
    }
  }
}
manifest.referenceSourcesUpdatedAt=new Date().toISOString();
await applyReferenceStyles(manifest);
await compactMaps(manifest);
await publishStations(manifest);
await fs.writeFile(manifestFile,JSON.stringify(manifest)+'\n');
await fs.writeFile(root+'sources.json',JSON.stringify(sources,null,2)+'\n');
