import L from 'leaflet';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';

const assetBase = new URL('../maps/', import.meta.url);
const local = name => new URL(name, assetBase).href;
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const element = (tag, text, className) => { const el=document.createElement(tag); if(text!==undefined) el.textContent=text; if(className) el.className=className; return el; };
async function getJSON(url) { const response=await fetch(url); if(!response.ok) throw new Error(`Cannot load ${url}`); return response.json(); }

// Also works on preview servers without byte ranges. Only those servers download the full archive.
class LocalSource {
  constructor(url) { this.url=url; }
  getKey() { return this.url; }
  async getBytes(offset,length,signal) {
    if(this.complete) return {data:this.complete.slice(offset,offset+length)};
    const response=await fetch(this.url,{headers:{Range:`bytes=${offset}-${offset+length-1}`},signal});
    if(!response.ok) throw new Error(`Map archive: HTTP ${response.status}`);
    const data=await response.arrayBuffer();
    if(response.status===200) { this.complete=data; return {data:data.slice(offset,offset+length)}; }
    return {data,etag:response.headers.get('etag') || undefined};
  }
}
function symbolFor(layer,properties) {
  const r=layer.renderer;
  if(r.type==='uniqueValue') {
    const value=[r.field1,r.field2,r.field3].filter(Boolean).map(f=>properties[f] ?? '').join(r.fieldDelimiter || ', ');
    return r.uniqueValueInfos.find(i=>String(i.value)===value)?.symbol || r.defaultSymbol;
  }
  if(r.type==='classBreaks') return r.classBreakInfos.find(i=>Number(properties[r.field])<=i.classMaxValue)?.symbol || r.defaultSymbol;
  return r.symbol;
}
const color = (c,fallback='transparent') => c ? `rgba(${c[0]},${c[1]},${c[2]},${(c[3]??255)/255})` : fallback;
function style(symbol,opacity=1) {
  const line=symbol?.type==='esriSLS'?symbol:symbol?.outline;
  return { color:color(line?.color),weight:(line?.width || 0)*4/3,opacity,fillColor:color(symbol?.color),fillOpacity:symbol?.style==='esriSFSNull'?0:opacity,dashArray:line?.style==='esriSLSDash'?'8 5':line?.style==='esriSLSDot'?'2 4':null };
}
function symbolHTML(symbol) {
  if(!symbol) return '';
  if(symbol.localImage) return `<img src="${escape(local(symbol.localImage))}" alt="" draggable="false">`;
  const s=style(symbol),size=24;
  let shape=symbol.type==='esriSLS'?'<path d="M2 18 L22 6"/>':symbol.type==='esriSFS'?'<path d="M2 4 H22 V20 H2 Z"/>':symbol.style==='esriSMSSquare'?'<rect x="5" y="5" width="14" height="14"/>':symbol.style==='esriSMSDiamond'?'<path d="M12 2 L22 12 L12 22 L2 12 Z"/>':symbol.style==='esriSMSTriangle'?'<path d="M12 2 L23 22 L1 22 Z"/>':symbol.style==='esriSMSCross'?'<path d="M3 12 H21 M12 3 V21"/>':'<circle cx="12" cy="12" r="8"/>';
  return `<svg viewBox="0 0 ${size} ${size}" aria-hidden="true" fill="${s.fillColor}" stroke="${s.color}" stroke-width="${s.weight || 1}" ${s.dashArray?`stroke-dasharray="${s.dashArray}"`:''}>${shape}</svg>`;
}
function formatted(value,field,definition) {
  if(value===null || value===undefined || value==='') return '—';
  const coded=definition?.domain?.codedValues?.find(v=>v.code===value);
  if(coded) return coded.name;
  if(typeof value==='number' && field?.format?.places!==undefined) return value.toLocaleString('en',{minimumFractionDigits:field.format.places,maximumFractionDigits:field.format.places,useGrouping:field.format.digitSeparator===true});
  return String(value);
}
function appendValue(cell,value) {
  // Attribute URLs remain user-activated links, never remote images or embeds.
  for(const piece of value.split(/(https?:\/\/[^\s<>]+)/g)) {
    if(/^https?:\/\//.test(piece)) { const a=element('a',piece); a.href=piece; a.target='_blank'; a.rel='noopener noreferrer'; cell.append(a); }
    else cell.append(document.createTextNode(piece));
  }
}
function attributeTable(layer,properties,all=false) {
  const table=element('table',undefined,'map-attributes');
  const fields=all ? layer.fields.map(f=>({fieldName:f.name,label:f.alias || f.name})) : layer.popup?.fieldInfos?.filter(f=>f.visible) || layer.fields.map(f=>({fieldName:f.name,label:f.alias || f.name}));
  for(const f of fields) {
    const row=element('tr'); const th=element('th',f.label || f.fieldName); th.scope='row';
    const td=element('td'); appendValue(td,formatted(properties[f.fieldName],f,layer.fields.find(d=>d.name===f.fieldName))); row.append(th,td); table.append(row);
  }
  return table;
}
function popup(layer,properties) {
  const box=element('div',undefined,'map-popup');
  const title=layer.popup?.title?.replace(/\{([^}]+)\}/g,(_,key)=>properties[key] ?? '') || properties.Station || properties.Name || properties.IME || layer.title;
  box.append(element('h3',title),attributeTable(layer,properties));
  const details=element('details'); details.append(element('summary','All attributes'),attributeTable(layer,properties,true)); box.append(details); return box;
}
function layerStatus(status,id,state) {
  status.layerStates ||= new Map(); status.layerStates.set(id,state);
  const values=[...status.layerStates.values()], pending=values.filter(v=>v==='loading').length;
  status.dataset.pending=String(pending);
  status.textContent=values.includes('error')?'Some map data could not load. Toggle the layer to retry.':pending?'Loading map layers…':'';
}

class VectorOverlay extends L.Layer {
  constructor(def,status,index) { super(); this.def=def; this.status=status; this.index=index; this.archive=new PMTiles(new LocalSource(local(def.archive))); this.cache=new Map(); this.generation=0; }
  onAdd(map) {
    this.map=map;
    const pane=`vectors-${this.index}`; if(!map.getPane(pane)) map.createPane(pane).style.zIndex=String(410+this.index);
    this.group=L.geoJSON(null,{pane,filter:f=>Boolean(symbolFor(this.def,f.properties)),style:f=>style(symbolFor(this.def,f.properties),this.def.opacity),pointToLayer:(f,latlng)=>{
      const symbol=symbolFor(this.def,f.properties); const w=(symbol?.width || symbol?.size || 12)*4/3, h=(symbol?.height || symbol?.size || 12)*4/3;
      return L.marker(latlng,{pane,keyboard:true,title:f.properties.Station || f.properties.Name || f.properties.IME || this.def.title,opacity:this.def.opacity,icon:L.divIcon({className:'map-symbol',html:symbolHTML(symbol),iconSize:[w,h],iconAnchor:[w/2-(symbol?.xoffset || 0),h/2+(symbol?.yoffset || 0)]})});
    },onEachFeature:(feature,layer)=>layer.on('click',event=>{
      // A standalone popup survives the tile refresh caused by its own auto-pan.
      L.popup({maxWidth:Math.min(420,map.getSize().x-50),minWidth:Math.min(230,map.getSize().x-50),autoPanPaddingTopLeft:[15,70],autoPanPaddingBottomRight:[15,25]})
        .setLatLng(event.latlng || layer.getLatLng()).setContent(popup(this.def,feature.properties)).openOn(map);
    })}).addTo(map);
    map.on('moveend',this.update,this); this.update();
  }
  onRemove(map) { ++this.generation; map.off('moveend',this.update,this); map.removeLayer(this.group); layerStatus(this.status,this.def.id,'off'); }
  async update() {
    const generation=++this.generation, zoom=this.map.getZoom(),scale=591657527.591555/2**zoom;
    if((this.def.minScale && scale>this.def.minScale) || (this.def.maxScale && scale<this.def.maxScale)) {this.group.clearLayers(); layerStatus(this.status,this.def.id,'off'); return;}
    layerStatus(this.status,this.def.id,'loading');
    const z=Math.min(12,Math.max(0,Math.floor(zoom))), bounds=this.map.getPixelBounds(this.map.getCenter(),z), n=2**z;
    const requests=[];
    for(let x=Math.max(0,Math.floor(bounds.min.x/256));x<=Math.min(n-1,Math.floor(bounds.max.x/256));x++) for(let y=Math.max(0,Math.floor(bounds.min.y/256));y<=Math.min(n-1,Math.floor(bounds.max.y/256));y++) {
      const key=`${z}/${x}/${y}`;
      if(!this.cache.has(key)) this.cache.set(key,this.archive.getZxy(z,x,y).then(result=>{
        if(!result) return [];
        const layer=new VectorTile(new PbfReader(new Uint8Array(result.data))).layers[this.def.id];
        return Array.from({length:layer?.length || 0},(_,i)=>layer.feature(i).toGeoJSON(x,y,z));
      }).catch(error=>{this.cache.delete(key);throw error;}));
      requests.push(this.cache.get(key));
    }
    try {
      const features=(await Promise.all(requests)).flat();
      if(generation!==this.generation) return;
      const seen=new Set();
      this.group.clearLayers().addData(features.filter(f=>{if(f.geometry.type!=='Point') return true; if(seen.has(f.properties.__id)) return false; seen.add(f.properties.__id); return true;}));
      while(this.cache.size>256) this.cache.delete(this.cache.keys().next().value);
      layerStatus(this.status,this.def.id,'ready');
    } catch(error) { if(generation===this.generation) layerStatus(this.status,this.def.id,'error'); console.error(error); }
  }
}

function showTable(host,layer) {
  const dialog=element('dialog',undefined,'map-table-dialog');
  const close=element('button','Close'); close.type='button'; close.addEventListener('click',()=>dialog.close());
  dialog.append(close,element('h2',layer.title));
  const search=element('input'); search.type='search'; search.placeholder='Search all attributes'; search.setAttribute('aria-label','Search all attributes'); dialog.append(search);
  const summary=element('p','Loading attributes…'),content=element('div',undefined,'map-table-scroll'),previous=element('button','Previous'),next=element('button','Next');
  dialog.append(summary,content,previous,next); host.append(dialog); dialog.showModal(); dialog.addEventListener('close',()=>dialog.remove());
  getJSON(local(layer.attributes)).then(rows=>{
    let page=0;
    const render=()=>{
      const filtered=rows.filter(row=>Object.values(row).join(' ').toLowerCase().includes(search.value.toLowerCase()));
      const table=element('table',undefined,'map-attributes'),head=element('tr');
      for(const f of layer.fields) {const th=element('th',f.alias || f.name); th.scope='col'; head.append(th); } table.append(head);
      for(const row of filtered.slice(page*50,(page+1)*50)) { const tr=element('tr'); for(const f of layer.fields) {const td=element('td'); appendValue(td,formatted(row[f.name],null,f));tr.append(td);} table.append(tr); }
      content.replaceChildren(table); summary.textContent=`${filtered.length} of ${rows.length} records · Page ${page+1} of ${Math.max(1,Math.ceil(filtered.length/50))}`; previous.disabled=page===0; next.disabled=(page+1)*50>=filtered.length;
    };
    search.addEventListener('input',()=>{page=0;render();}); previous.addEventListener('click',()=>{page--;render();});next.addEventListener('click',()=>{page++;render();});render();
  }).catch(()=>{summary.textContent='Attributes could not load. Please close and try again.';});
}

async function initialize(host,manifest) {
  const def=manifest.maps.find(m=>m.slug===host.dataset.map);
  const canvas=host.querySelector('.map-canvas'),status=host.querySelector('.map-status');
  const map=L.map(canvas,{scrollWheelZoom:host.dataset.fullscreen==='true',minZoom:5,maxZoom:19}).setView(def.center,def.zoom);
  map.attributionControl.setPrefix(false);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles © Esri — Esri, HERE, Garmin, Intermap, USGS, FAO, NPS, NRCAN, GeoBase, IGN, Kadaster NL, Ordnance Survey, METI, Esri Japan, Hong Kong, OpenStreetMap contributors, GIS User Community'}).addTo(map);
  L.control.scale({imperial:false}).addTo(map);
  const reset=L.control({position:'topleft'});reset.onAdd=()=>{const button=element('button','⌂','map-reset leaflet-bar');button.type='button';button.title='Reset map view';button.setAttribute('aria-label','Reset map view');L.DomEvent.disableClickPropagation(button);button.addEventListener('click',()=>map.setView(def.center,def.zoom));return button;};reset.addTo(map);
  const panel=host.querySelector('.map-layer-list');
  const layers=def.layers.map((layer,i)=>({layer,overlay:new VectorOverlay(layer,status,i)}));
  for(const {layer,overlay} of layers.toReversed()) {
    const section=element('section',undefined,'map-layer'); const label=element('label');const checkbox=element('input');checkbox.type='checkbox'; checkbox.checked=layer.visible; label.append(checkbox,document.createTextNode(layer.title));section.append(label);
    const symbols=[...(layer.renderer.uniqueValueInfos || layer.renderer.classBreakInfos || [{symbol:layer.renderer.symbol,label:layer.renderer.label || layer.title}])];
    if(layer.renderer.defaultSymbol) symbols.push({symbol:layer.renderer.defaultSymbol,label:layer.renderer.defaultLabel || 'Other values'});
    for(const item of symbols) {const row=element('div',undefined,'map-legend-row');const swatch=element('span',undefined,'map-swatch');swatch.innerHTML=symbolHTML(item.symbol);row.append(swatch,document.createTextNode(item.label || item.value || layer.title));section.append(row);}
    if(layer.tiles===0) section.append(element('small','Source has no geometry; attributes are available.'));
    const table=element('button',`Attributes (${layer.count})`);table.type='button';table.addEventListener('click',()=>showTable(host,layer));section.append(table);panel.append(section);
    checkbox.addEventListener('change',()=>checkbox.checked?overlay.addTo(map):map.removeLayer(overlay));
  }
  for(const {layer,overlay} of layers) if(layer.visible) overlay.addTo(map);
  new ResizeObserver(()=>map.invalidateSize()).observe(canvas);
  host.dataset.ready='true';
}
const hosts=[...document.querySelectorAll('[data-map]')];
if(hosts.length) getJSON(local('manifest.json')).then(manifest=>Promise.all(hosts.map(host=>initialize(host,manifest)))).catch(error=>{hosts.forEach(host=>host.querySelector('.map-status').textContent='The map could not load. Please reload to retry.');console.error(error);});
