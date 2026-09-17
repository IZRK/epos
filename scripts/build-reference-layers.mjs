import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import shp from 'shpjs';
import { writeArchive } from './pmtiles-writer.mjs';
import { compactMaps } from './compact-maps.mjs';

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
const classes=[
  ['karst in limestone','#54c41a'],['karst in limestone and dolomite','#96de54'],
  ['karst in dolomite','#ffc5c4'],['karst in clastic carbonate rocks','#ffecc4'],
  ['karst in flysch','#fed78c'],['carbonate gravel-covered karst','#c5d7ff'],
  ['fine grained sediment-covered karst','#f9ff5f'],['carbonate till-covered karst','#e2cafe']
];
const rgb=hex=>[...hex.slice(1).matchAll(/../g)].map(m=>parseInt(m[0],16)).concat(255);
const fill=hex=>({type:'esriSFS',style:'esriSFSSolid',color:hex?rgb(hex):null,outline:null});
const line=(hex,width,style='esriSLSSolid')=>({type:'esriSLS',style,color:rgb(hex),width});
const marker=(hex,shape='Circle',size=12)=>({type:'esriSMS',style:`esriSMS${shape}`,size,color:rgb(hex),outline:line('#ffffff',1.2)});
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
      layer.title='Karst types · Gostinčar & Stepišnik (2023)';
      layer.renderer={type:'uniqueValue',field1:'Karst_EN',defaultSymbol:null,uniqueValueInfos:classes.map(([value,hex])=>({value,label:value,symbol:fill(hex)}))};
      layer.opacity=.56;
      layer.popup={title:'{Karst_EN}',fieldInfos:[{fieldName:'Karst_EN',label:'Karst type',visible:true},{fieldName:'Karst_SI',label:'Slovenian classification',visible:true},{fieldName:'Source',label:'Source',visible:true}]};
      layer.minScale=0;layer.maxScale=0;
      if(/Sloji_/.test(layer.sourceId)) layer.sourceNote='Replaces the empty 2016 web-map layer with the published 2023 dataset.';
    } else if(/active_fault/.test(layer.sourceId)) {
      features=structuredClone(parsed.faults.features);provenance=sources.faults;
      layer.title='Active faults · GeoZS (MAF.SI 2020)';
      layer.renderer={type:'uniqueValue',field1:'ACTIVITY',defaultSymbol:null,uniqueValueInfos:[
        {value:'active',label:'Active',symbol:line('#943d35',1.35)},
        {value:'probably',label:'Probably active',symbol:line('#ad6351',1.0,'esriSLSDash')},
        {value:'potentially',label:'Potentially active',symbol:line('#997d6e',.65,'esriSLSDot')}
      ]};layer.opacity=.9;
      layer.popup={title:'{FAULT_NAME}',fieldInfos:['FAULT_NAME','FAULT_DESI','FAULT_TYPE','ACTIVITY','SLIPRATEMI','SLIPRATEMA','BEST_EST_2'].map((name,i)=>({fieldName:name,label:['Fault','Identifier','Fault type','Activity','Minimum slip rate','Maximum slip rate','Best slip-rate estimate'][i],visible:true}))};
    } else if(/Kohezijski/.test(layer.sourceId)) {
      const old=JSON.parse(await fs.readFile(`public/assets/maps/${layer.attributes}`));
      features=structuredClone(parsed.regions.features.filter(f=>f.properties.CNTR_CODE==='SI'));
      for(const feature of features) {
        const previous=old.find(p=>p.IME===feature.properties.NAME_LATN) || {};
        feature.properties={...previous,...feature.properties};
      }
      provenance=sources.regions;layer.title='Cohesion regions · East / West Slovenia';
      layer.renderer={type:'simple',symbol:{...fill(null),outline:line('#536c65',1)}};layer.opacity=1;
      layer.popup={title:'{NAME_LATN}',fieldInfos:['NUTS_ID','NAME_LATN'].map(name=>({fieldName:name,label:name==='NUTS_ID'?'NUTS 2024 code':'Region',visible:true}))};
      layer.sourceNote='NUTS 2024 geometry; legacy demographic fields retained from the original StoryMap (not current population estimates).';
    } else if(layer.sourceId==='Slovenia_shapefile_9975') {
      features=structuredClone(parsed.country.features.filter(f=>f.properties.CNTR_CODE==='SI'));provenance=sources.country;
      layer.renderer={type:'simple',symbol:{...fill(null),outline:line('#536c65',1.2)}};
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
    if(layer.geometryType==='esriGeometryPoint') {
      let color='#4569a0',shape='Circle';
      if(/support|EPOS_locations/.test(layer.sourceId)) color='#d28b24';
      if(layer.sourceId==='csv_3993') {color='#46505d';shape='Triangle';}
      if(/NFO_stations/.test(layer.sourceId)) {color=layer.sourceId.endsWith('_1832')?'#bf493e':'#278261';shape=layer.sourceId.endsWith('_1832')?'Square':'Triangle';}
      if(/slo_shapefile|avst_|hrv_|ita_|red0_|dodatno_/.test(layer.sourceId)) {color='#7c6599';shape='Diamond';}
      const r=layer.renderer;
      if(r.symbol) r.symbol=marker(color,shape);
      for(const info of r.uniqueValueInfos || []) info.symbol=marker(color,shape);
      if(r.defaultSymbol) r.defaultSymbol=marker(color,shape);
      if(/NFO_stations/.test(layer.sourceId)) layer.title=layer.sourceId.endsWith('_1832')?'Former seismic station locations':'SLO KARST NFO seismic stations';
    }
  }
}
manifest.referenceSourcesUpdatedAt=new Date().toISOString();
await compactMaps(manifest);
await fs.writeFile(manifestFile,JSON.stringify(manifest)+'\n');
await fs.writeFile(root+'sources.json',JSON.stringify(sources,null,2)+'\n');
