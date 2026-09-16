// PMTiles v3: sorted Hilbert tile IDs, gzip directories/MVT, bounded root directory.
import { gzipSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { zxyToTileId } from 'pmtiles';
import geojsonvt from 'geojson-vt';
import vtpbf from 'vt-pbf';

function directory(entries) {
  const bytes = [];
  const varint = n => { while (n > 127) { bytes.push((n % 128) | 128); n = Math.floor(n / 128); } bytes.push(n); };
  varint(entries.length);
  let previous = 0;
  for (const e of entries) { varint(e.id - previous); previous = e.id; }
  for (const e of entries) varint(e.run);
  for (const e of entries) varint(e.length);
  for (let i = 0; i < entries.length; i++) varint(i && entries[i].offset === entries[i-1].offset + entries[i-1].length ? 0 : entries[i].offset + 1);
  return gzipSync(Buffer.from(bytes));
}

export async function writeArchive(file, geojson, name, maxZoom = 12) {
  const index = new geojsonvt(geojson, { maxZoom, indexMaxZoom: 5, tolerance: 1, buffer: 64, extent: 4096 });
  const tiles = [];
  function visit(z, x, y) {
    const tile = index.getTile(z, x, y);
    if (!tile?.features.length) return;
    tiles.push({ id: zxyToTileId(z, x, y), data: gzipSync(vtpbf.fromGeojsonVt({ [name]: tile })) });
    if (z < maxZoom) for (let dx=0; dx<2; dx++) for (let dy=0; dy<2; dy++) visit(z+1,x*2+dx,y*2+dy);
  }
  visit(0, 0, 0);
  tiles.sort((a,b)=>a.id-b.id);
  let offset = 0;
  const entries = tiles.map(t => { const e = { id:t.id, run:1, offset, length:t.data.length }; offset += t.data.length; return e; });
  let root = directory(entries), leaves = Buffer.alloc(0);
  if (root.length > 16000) {
    const chunks = [], pointers = []; let leafOffset = 0;
    for (let i=0; i<entries.length; i+=512) {
      const chunk = directory(entries.slice(i,i+512));
      pointers.push({id:entries[i].id, run:0, offset:leafOffset, length:chunk.length});
      chunks.push(chunk); leafOffset += chunk.length;
    }
    root = directory(pointers); leaves = Buffer.concat(chunks);
  }
  const fields=Object.fromEntries(Object.entries(geojson.features[0]?.properties || {}).map(([k,v])=>[k,typeof v==='number'?'Number':typeof v==='boolean'?'Boolean':'String']));
  const metadata = gzipSync(JSON.stringify({ name, format:'pbf', vector_layers:[{id:name, fields, minzoom:0,maxzoom:maxZoom}] }));
  const header = Buffer.alloc(127); header.write('PMTiles'); header[7]=3;
  const u64 = (position,value)=>header.writeBigUInt64LE(BigInt(value),position);
  u64(8,127); u64(16,root.length); u64(24,127+root.length); u64(32,metadata.length);
  u64(40,127+root.length+metadata.length); u64(48,leaves.length);
  u64(56,127+root.length+metadata.length+leaves.length); u64(64,offset);
  u64(72,tiles.length); u64(80,tiles.length); u64(88,tiles.length);
  header[96]=1; header[97]=2; header[98]=2; header[99]=1; header[100]=0; header[101]=maxZoom;
  // Geographic coverage is calculated from the complete source, not a sample tile.
  const bounds=[180,90,-180,-90];
  function scan(c) { if(typeof c[0]==='number') { bounds[0]=Math.min(bounds[0],c[0]); bounds[1]=Math.min(bounds[1],c[1]); bounds[2]=Math.max(bounds[2],c[0]); bounds[3]=Math.max(bounds[3],c[1]); } else c.forEach(scan); }
  geojson.features.forEach(f=>scan(f.geometry.coordinates));
  if(!tiles.length) bounds.splice(0,4,0,0,0,0);
  bounds.forEach((v,i)=>header.writeInt32LE(Math.round(v*1e7),102+i*4));
  header[118]=8; header.writeInt32LE(Math.round((bounds[0]+bounds[2])/2*1e7),119); header.writeInt32LE(Math.round((bounds[1]+bounds[3])/2*1e7),123);
  await writeFile(file,Buffer.concat([header,root,metadata,leaves,...tiles.map(t=>t.data)]));
  return { tiles:tiles.length, bytes:127+root.length+metadata.length+leaves.length+offset, bounds };
}
