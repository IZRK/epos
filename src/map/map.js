import L from 'leaflet';
import { PMTiles } from 'pmtiles';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { paintTile } from './tile-renderer.js';
import { ReferenceLabels } from './reference-labels.js';
import { symbolFor, stationName, stationRecords } from './stations.js';
export { paintTile } from './tile-renderer.js';

const assetBase = new URL('../maps/', import.meta.url);
const local = name => new URL(name, assetBase).href;
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const element = (tag, text, className) => { const el=document.createElement(tag); if(text!==undefined) el.textContent=text; if(className) el.className=className; return el; };
async function getJSON(url) { const response=await fetch(url); if(!response.ok) throw new Error(`Cannot load ${url}`); return response.json(); }
const stationData=new Map();
function getStations(layer) {
  if(!stationData.has(layer.geojson)) stationData.set(layer.geojson,getJSON(local(layer.geojson)).catch(error=>{stationData.delete(layer.geojson);throw error;}));
  return stationData.get(layer.geojson);
}

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
    // Station codes identify the observation station. Building/site descriptions
    // remain available under All attributes, not as a competing station name.
    if(!all && layer.geojson && properties.StationID && f.fieldName==='Station') continue;
    const row=element('tr'); const th=element('th',f.label || f.fieldName); th.scope='row';
    const td=element('td'); appendValue(td,formatted(properties[f.fieldName],f,layer.fields.find(d=>d.name===f.fieldName))); row.append(th,td); table.append(row);
  }
  return table;
}
function popup(layer,properties) {
  const box=element('div',undefined,'map-popup');
  const title=(layer.geojson?stationName(properties):'') || layer.popup?.title?.replace(/\{([^}]+)\}/g,(_,key)=>properties[key] ?? '') || properties.Station || properties.Name || properties.IME || layer.title;
  box.append(element('h3',title),attributeTable(layer,properties));
  const details=element('details'); details.append(element('summary','All attributes'),attributeTable(layer,properties,true)); box.append(details); return box;
}
function layerStatus(status,id,state) {
  status.layerStates ||= new Map(); status.layerStates.set(id,state);
  const values=[...status.layerStates.values()], pending=values.filter(v=>v==='loading').length;
  status.dataset.pending=String(pending);
  status.textContent=values.includes('error')?'Some map data could not load. Toggle the layer to retry.':pending?'Loading map layers…':'';
}

function openFeaturePopup(map, definition, properties, latlng,owner,choices) {
  map.closePopup();
  const candidates=choices || [{definition,properties,latlng,owner}];let index=0,selected;
  const window=L.popup({maxWidth:Math.min(440,map.getSize().x-80),minWidth:Math.min(340,map.getSize().x-80),autoPanPaddingTopLeft:[15,70],autoPanPaddingBottomRight:[15,25]});
  const render=()=>{
    selected=candidates[index];
    window.featureOwner=selected.owner;
    const content=popup(selected.definition,selected.properties);
    L.DomEvent.disableClickPropagation(content);
    if(candidates.length>1) {
      const nav=element('nav',undefined,'map-feature-navigation');nav.setAttribute('aria-label','Features at this location');
      const previous=element('button','Previous'),next=element('button','Next');previous.type=next.type='button';
      previous.onclick=event=>{event.stopPropagation();index=(index+candidates.length-1)%candidates.length;render();};
      next.onclick=event=>{event.stopPropagation();index=(index+1)%candidates.length;render();};
      nav.append(previous,element('span',`${index+1} of ${candidates.length}`),next);content.prepend(nav);
    }
    window.setLatLng(selected.latlng).setContent(content);
  };
  render();window.openOn(map);
}

class TiledVectors extends L.GridLayer {
  constructor(def,status,index) {
    super({tileSize:256,maxZoom:19,pane:`vectors-${index}`,keepBuffer:1});
    this.def=def;this.status=status;this.index=index;
    this.archive=new PMTiles(new LocalSource(local(def.archive)));
    this.cache=new Map();
    this.on('loading',()=>layerStatus(status,def.id,'loading'));
    this.on('load',()=>layerStatus(status,def.id,this.failed?'error':'ready'));
  }
  onAdd(map) {
    const pane=this.options.pane;
    if(!map.getPane(pane)) map.createPane(pane).style.zIndex=String(410+this.index);
    // Hit-testing happens on the map so empty upper tiles don't block lower layers.
    this.failed=false;
    super.onAdd(map);
    map._eposVectors ||= new Set();
    map._eposVectors.add(this);
    if(!map._eposIdentify) {
      map._eposIdentify=event=>{
        for(const layer of [...map._eposVectors].sort((a,b)=>b.index-a.index)) {
          const properties=layer.identify(event);
          if(properties) {openFeaturePopup(map,layer.def,properties,event.latlng,layer);break;}
        }
      };
      map.on('click',map._eposIdentify);
    }
    map.on('zoomend',this.updateScale,this);
    this.updateScale();
  }
  onRemove(map) {
    if(map._popup?.featureOwner===this) map.closePopup();
    map._eposVectors.delete(this);map.off('zoomend',this.updateScale,this);
    super.onRemove(map);layerStatus(this.status,this.def.id,'off');
    this.labels?.schedule();
  }
  updateScale() {
    const scale=591657527.591555/2**this._map.getZoom();
    this.inScale=(!this.def.minScale || scale<=this.def.minScale) && (!this.def.maxScale || scale>=this.def.maxScale);
    this.getContainer().style.display=this.inScale?'':'none';
  }
  createTile(coords,done) {
    const canvas=document.createElement('canvas');
    canvas.dataset.zoom=String(coords.z);canvas.dataset.layer=this.def.id;
    const ratio=Math.min(2,window.devicePixelRatio || 1);
    canvas.width=canvas.height=256*ratio;
    canvas.className='map-vector-tile';canvas.style.pointerEvents='none';
    const context=canvas.getContext('2d');
    // Overzoom the geometry into fresh canvases, not enlarged bitmap tiles:
    // line widths stay in screen pixels and remain sharp above archive maxzoom.
    const z=Math.min(coords.z,12),factor=2**(coords.z-z),x=Math.floor(coords.x/factor),y=Math.floor(coords.y/factor);
    const key=`${z}/${x}/${y}`;
    if(!this.cache.has(key)) this.cache.set(key,this.archive.getZxy(z,x,y).then(result=>result?new VectorTile(new PbfReader(new Uint8Array(result.data))).layers[this.def.tileLayer || this.def.id]:null).catch(error=>{this.cache.delete(key);throw error;}));
    this.cache.get(key).then(layer=>{
      if(layer) canvas.hits=paintTile(context,layer,p=>symbolFor(this.def,p),s=>style(s,this.def.opacity),ratio,{scale:factor,offsetX:(coords.x-x*factor)*256,offsetY:(coords.y-y*factor)*256});
      while(this.cache.size>256) this.cache.delete(this.cache.keys().next().value);
      done(null,canvas);
      this.labels?.schedule();
    }).catch(error=>{this.failed=true;layerStatus(this.status,this.def.id,'error');done(error,canvas);});
    return canvas;
  }
  identify(event) {
    if(!this.inScale || event.originalEvent?.target.closest('.leaflet-marker-icon,.leaflet-popup,.leaflet-control')) return;
    const z=this._tileZoom;
    if(z===undefined) return;
    const point=this._map.project(event.latlng,z),x=Math.floor(point.x/256),y=Math.floor(point.y/256);
    const tile=this._tiles[this._tileCoordsToKey({x,y,z})]?.el;
    if(!tile?.hits) return;
    const context=tile.getContext('2d'),px=point.x-x*256,py=point.y-y*256;
    for(const hit of [...tile.hits].reverse()) {
      context.lineWidth=Math.max(8,hit.width);
      if((hit.type===3 && context.isPointInPath(hit.path,px,py,'evenodd')) || context.isPointInStroke(hit.path,px,py)) {
        return hit.properties;
      }
    }
  }
}

function refreshStations(map) {
  const owners=[...map._eposPoints].sort((a,b)=>a.index-b.index);
  const records=stationRecords(owners.map(owner=>({definition:owner.def,data:owner.data})));
  for(const owner of owners) {
    const features=records.filter(record=>record.definition===owner.def).map(record=>record.feature);
    const ids=features.map(feature=>feature.properties.__id).join(',');
    if(owner.renderedIds!==ids) {
      owner.group.clearLayers().addData({type:'FeatureCollection',features});owner.renderedIds=ids;
    }
    owner.labels?.schedule();
  }
}
class StationMarkers extends L.Layer {
  constructor(def,status,index) { super(); this.def=def; this.status=status; this.index=index;this.generation=0; }
  onAdd(map) {
    this.map=map;
    this.renderedIds=undefined;
    map._eposPoints ||= new Set();map._eposPoints.add(this);
    const pane=`vectors-${this.index}`; if(!map.getPane(pane)) map.createPane(pane).style.zIndex=String(600+this.index);
    this.group=L.geoJSON(null,{pane,pointToLayer:(f,latlng)=>{
      const symbol=symbolFor(this.def,f.properties); const w=(symbol?.width || symbol?.size || 12)*4/3, h=(symbol?.height || symbol?.size || 12)*4/3;
      return L.marker(latlng,{pane,keyboard:true,title:stationName(f.properties) || this.def.title,opacity:this.def.opacity,icon:L.divIcon({className:'map-symbol',html:symbolHTML(symbol),iconSize:[w,h],iconAnchor:[w/2-(symbol?.xoffset || 0),h/2+(symbol?.yoffset || 0)]})});
    },onEachFeature:(feature,marker)=>{
      marker.on('add',()=>{marker.getElement().dataset.layer=this.def.id;marker.getElement().dataset.feature=String(feature.properties.__id);});
      marker.on('click',()=>{
        const point=map.latLngToContainerPoint(marker.getLatLng());
        const choices=[{definition:this.def,properties:feature.properties,latlng:marker.getLatLng(),owner:this}];
        for(const owner of map._eposPoints) owner.group.eachLayer(other=>{
          if(other===marker) return;
          const radius=Math.max(...other.options.icon.options.iconSize)/2+5;
          if(point.distanceTo(map.latLngToContainerPoint(other.getLatLng()))<=radius)
            choices.push({definition:owner.def,properties:other.feature.properties,latlng:other.getLatLng(),owner});
        });
        openFeaturePopup(map,this.def,feature.properties,marker.getLatLng(),this,choices);
      });
    }}).addTo(map);
    this.load();
  }
  onRemove(map) { ++this.generation;if(map._popup?.featureOwner===this) map.closePopup();map._eposPoints.delete(this);map.removeLayer(this.group);refreshStations(map);layerStatus(this.status,this.def.id,'off');this.labels?.schedule(); }
  async load() {
    const generation=++this.generation;
    layerStatus(this.status,this.def.id,'loading');
    try {
      const data=await getStations(this.def);
      if(generation!==this.generation) return;
      this.data=data;refreshStations(this.map);
      layerStatus(this.status,this.def.id,'ready');
      this.labels?.schedule();
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
  (layer.geojson?getStations(layer).then(data=>data.features.map(f=>f.properties)):getJSON(local(layer.attributes))).then(rows=>{
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
  const map=L.map(canvas,{scrollWheelZoom:host.dataset.fullscreen==='true',minZoom:5,maxZoom:19});
  const resetView=()=>def.bounds?map.fitBounds(def.bounds,{padding:[28,28],maxZoom:11}):map.setView(def.center,def.zoom);
  resetView();
  map.attributionControl.setPrefix(false);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles © Esri — Esri, HERE, Garmin, Intermap, USGS, FAO, NPS, NRCAN, GeoBase, IGN, Kadaster NL, Ordnance Survey, METI, Esri Japan, Hong Kong, OpenStreetMap contributors, GIS User Community'}).addTo(map);
  L.control.scale({imperial:false}).addTo(map);
  const reset=L.control({position:'topleft'});reset.onAdd=()=>{const button=element('button','⌂','map-reset leaflet-bar');button.type='button';button.title='Reset map view';button.setAttribute('aria-label','Reset map view');L.DomEvent.disableClickPropagation(button);button.addEventListener('click',resetView);return button;};reset.addTo(map);
  const panel=host.querySelector('.map-layer-list');
  const layers=def.layers.map((layer,i)=>({layer,overlay:layer.geometryType==='esriGeometryPoint'?new StationMarkers(layer,status,i):new TiledVectors(layer,status,i)}));
  new ReferenceLabels(layers).addTo(map);
  for(const {layer,overlay} of [...layers].reverse()) {
    const section=element('section',undefined,'map-layer'); const label=element('label');const checkbox=element('input');checkbox.type='checkbox'; checkbox.checked=layer.visible; label.append(checkbox,document.createTextNode(layer.title));section.append(label);
    const symbols=[...(layer.renderer.uniqueValueInfos || layer.renderer.classBreakInfos || [{symbol:layer.renderer.symbol,label:layer.renderer.label || layer.title}])];
    if(layer.renderer.defaultSymbol) symbols.push({symbol:layer.renderer.defaultSymbol,label:layer.renderer.defaultLabel || 'Other values'});
    for(const item of symbols) {const row=element('div',undefined,'map-legend-row');const swatch=element('span',undefined,'map-swatch');swatch.innerHTML=symbolHTML(item.symbol);row.append(swatch,document.createTextNode(item.label || item.value || layer.title));section.append(row);}
    if(layer.tiles===0) section.append(element('small','Source has no geometry; attributes are available.'));
    if(layer.provenance) {
      const source=element('a',layer.provenance.label,'map-source');source.href=layer.provenance.url;source.target='_blank';source.rel='noopener noreferrer';section.append(source);
    }
    const table=element('button',`Attributes (${layer.count})`);table.type='button';table.addEventListener('click',()=>showTable(host,layer));section.append(table);panel.append(section);
    checkbox.addEventListener('change',()=>checkbox.checked?overlay.addTo(map):map.removeLayer(overlay));
  }
  for(const {layer,overlay} of layers) if(layer.visible) overlay.addTo(map);
  new ResizeObserver(()=>map.invalidateSize()).observe(canvas);
  host.dataset.ready='true';
}
const hosts=[...document.querySelectorAll('[data-map]')];
if(hosts.length) getJSON(local('manifest.json')).then(manifest=>Promise.all(hosts.map(host=>initialize(host,manifest)))).catch(error=>{hosts.forEach(host=>host.querySelector('.map-status').textContent='The map could not load. Please reload to retry.');console.error(error);});
