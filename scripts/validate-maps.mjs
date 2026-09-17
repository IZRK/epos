import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { PMTiles, tileIdToZxy } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { gunzipSync } from 'node:zlib';
import * as cheerio from 'cheerio';
import { buildStoryMap } from './import-content.mjs';

const manifest=JSON.parse(await fs.readFile('public/assets/maps/manifest.json'));
let total=0,tiles=0,empty=0;
// Walk every archive directory, rather than guessing whether an arbitrary XYZ tile exists.
function directory(buffer) {
  let pos=0;
  function uint() {let result=0,m=1,b; do {b=buffer[pos++]; result+=(b&127)*m;m*=128;}while(b>127);return result;}
  const count=uint(),entries=Array.from({length:count},()=>({}));let id=0;
  for(const entry of entries) {id+=uint();entry.id=id;}
  for(const entry of entries) entry.run=uint();
  for(const entry of entries) entry.length=uint();
  for(let i=0;i<count;i++) {const offset=uint();entries[i].offset=offset===0&&i?entries[i-1].offset+entries[i-1].length:offset-1;}
  return entries;
}
for(const map of manifest.maps) for(const layer of map.layers) {
  const bytes=await fs.readFile(`public/assets/maps/${layer.archive}`);
  const source={getKey:()=>layer.id,getBytes:async(offset,length)=>({data:bytes.buffer.slice(bytes.byteOffset+offset,bytes.byteOffset+Math.min(bytes.length,offset+length))})};
  const archive=new PMTiles(source),header=await archive.getHeader();
  assert.equal(header.tileType,1);assert.equal((await archive.getMetadata()).vector_layers[0].id,layer.tileLayer || layer.id);
  const attributes=JSON.parse(await fs.readFile(`public/assets/maps/${layer.attributes}`));
  const geojson=JSON.parse(await fs.readFile(`data/maps/${layer.dataFile || `${layer.id}.geojson`}`));
  assert.equal(attributes.length,layer.count);
  assert.deepEqual(attributes,geojson.features.map(f=>f.properties));
  const expected=new Set(geojson.features.filter(f=>f.geometry.coordinates.length).map(f=>f.properties.__id));
  empty+=layer.count-expected.size;
  const seen=new Set();
  function walk(offset,length) {
    for(const entry of directory(gunzipSync(bytes.subarray(offset,offset+length)))) {
      if(entry.run===0) {walk(header.leafDirectoryOffset+entry.offset,entry.length);continue;}
      const [z]=tileIdToZxy(entry.id);
      const tile=new VectorTile(new PbfReader(gunzipSync(bytes.subarray(header.tileDataOffset+entry.offset,header.tileDataOffset+entry.offset+entry.length))));
      const features=tile.layers[layer.tileLayer || layer.id];assert.ok(features);tiles++;
      for(let i=0;i<features.length;i++) {
        const feature=features.feature(i),id=feature.properties.__id;
        assert.ok(expected.has(id),`${layer.id}: unexpected feature ${id}`);
        for(const [key,value] of Object.entries(feature.properties)) assert.equal(value,attributes[id][key],`${layer.id}/${id}: altered ${key}`);
        if(z===header.maxZoom) seen.add(id);
      }
    }
  }
  walk(header.rootDirectoryOffset,header.rootDirectoryLength);
  assert.deepEqual([...seen].sort((a,b)=>a-b),[...expected].sort((a,b)=>a-b),`${layer.id}: geometry lost from maxzoom tiles`);
  total+=layer.count;
}
const original=JSON.parse(await fs.readFile('data/maps/story-source.json'));
const local=JSON.parse(await fs.readFile('src/_data/storyMap.json'));
const fresh=buildStoryMap({},original,new Map());
const text=html=>cheerio.load(html || '').text().replace(/\s+/g,' ').trim();
assert.equal(local.blocks.length,fresh.blocks.length);
fresh.blocks.forEach((block,i)=>{assert.equal(block.type,local.blocks[i].type);for(const key of ['html','caption','description','title']) assert.equal(text(block[key]),text(local.blocks[i][key]),`StoryMap block ${i}: ${key}`);});
assert.deepEqual(local.credits.map(text),fresh.credits.map(text));
const supported=new Set(['storycover','navigation','text','separator','webmap','embed','credits']);
for(const id of original.nodes[original.root].children) assert.ok(supported.has(original.nodes[id].type),`Unaccounted StoryMap block ${id}`);
const layers=manifest.maps.flatMap(m=>m.layers);
const sourceFiles=await fs.readdir('data/maps');
const publicFiles=await fs.readdir('public/assets/maps');
assert.deepEqual(new Set(sourceFiles.filter(file=>file.endsWith('.geojson'))),new Set(layers.map(layer=>layer.dataFile || `${layer.id}.geojson`)),'Unreferenced GeoJSON sources');
assert.deepEqual(new Set(publicFiles.filter(file=>file.endsWith('.pmtiles'))),new Set(layers.map(layer=>layer.archive)),'Unreferenced PMTiles archives');
assert.deepEqual(new Set(publicFiles.filter(file=>file.endsWith('.json') && file!=='manifest.json')),new Set(layers.map(layer=>layer.attributes)),'Unreferenced attribute tables');
const archiveCount=new Set(layers.map(layer=>layer.archive)).size;
console.log(`Verified ${fresh.blocks.length} StoryMap blocks and credits; ${layers.length} layers sharing ${archiveCount} archives, ${tiles} tile checks, ${total} records (${empty} empty source geometries). All nonempty feature IDs and tiled attribute values preserved.`);
