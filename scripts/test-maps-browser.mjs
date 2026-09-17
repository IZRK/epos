import { chromium, firefox, webkit } from '@playwright/test';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { stationRecords } from '../src/map/stations.js';

const prefix=(process.env.PATH_PREFIX || '').replace(/\/$/,'');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.mp4':'video/mp4','.pmtiles':'application/octet-stream'};
let ranges=0,stationRangeRequests=0;
const server=createServer(async(req,res)=>{
  try {
    let url=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(prefix) {assert.ok(url.startsWith(prefix+'/'));url=url.slice(prefix.length);}
    const file=path.resolve('_site','.'+url+(url.endsWith('/')?'index.html':'')); assert.ok(file.startsWith(path.resolve('_site')+path.sep));
    const bytes=await fs.readFile(file);const headers={'Content-Type':types[path.extname(file)] || 'application/octet-stream','Accept-Ranges':'bytes'};
    const range=req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    if(range && file.endsWith('.geojson')) stationRangeRequests++;
    if(range) {const start=Number(range[1]),end=Math.min(bytes.length-1,range[2]?Number(range[2]):bytes.length-1);ranges++;res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${bytes.length}`});res.end(bytes.subarray(start,end+1));}
    else {res.writeHead(200,headers);res.end(bytes);}
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,base=origin+prefix;
const browserName=process.env.BROWSER || 'chromium';
const browser=await ({chromium,firefox,webkit}[browserName]).launch({headless:true});
const manifest=JSON.parse(await fs.readFile('public/assets/maps/manifest.json'));
const stationSources=new Map();
for(const layer of manifest.maps.flatMap(map=>map.layers).filter(layer=>layer.geojson)) stationSources.set(layer.id,JSON.parse(await fs.readFile(`public/assets/maps/${layer.geojson}`)));
const expectedStations=(definition,all=false)=>stationRecords(definition.layers.filter(layer=>layer.geojson && (all || layer.visible)).map(layer=>({definition:layer,data:stationSources.get(layer.id)})));
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  // Keep the permitted embeds but do not test YouTube's third-party player internals.
  await page.route(/^https:\/\/www\.youtube(?:-nocookie)?\.com\/embed\//,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>YouTube player test placeholder</title>'}));
  const errors=[],external=new Set(),failures=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(!request.url().startsWith(origin)) external.add(request.url());});
  page.on('response',response=>{if(response.url().startsWith(origin)&&response.status()>=400) failures.push(`${response.status()} ${response.url()}`);});
  const settled=async()=>{
    await page.waitForFunction(()=>[...document.querySelectorAll('.map-status')].every(el=>el.dataset.pending==='0' && el.textContent===''));
    await page.waitForFunction(()=>[...document.querySelectorAll('.map-symbol img,.map-swatch img')].every(img=>img.complete && img.naturalWidth>0));
    await page.waitForFunction(()=>[...document.querySelectorAll('canvas.map-vector-tile')].every(tile=>Number(getComputedStyle(tile).opacity)>.999));
  };
  const basemapSettled=()=>page.waitForFunction(()=>[...document.querySelectorAll('.leaflet-tile-pane img')].every(img=>img.complete && img.naturalWidth>0 && Number(getComputedStyle(img).opacity)>.999));
  const popupSettled=()=>page.waitForFunction(()=>[...document.querySelectorAll('.leaflet-popup')].some(popup=>Number(getComputedStyle(popup).opacity)>.999));
  const zoomIn=async()=>{
    const previous=await page.locator('canvas.map-vector-tile').evaluateAll(tiles=>Math.max(...tiles.map(tile=>Number(tile.dataset.zoom))));
    await page.locator('.leaflet-control-zoom-in').click();
    // Leaflet starts its zoom animation on a later frame. Waiting only for the
    // absence of its animation class can return before the zoom even begins.
    await page.waitForFunction(previous=>!document.querySelector('.leaflet-zoom-anim') && [...document.querySelectorAll('canvas.map-vector-tile')].some(tile=>Number(tile.dataset.zoom)>previous),previous);
    await settled();
  };
  const checkVisibleStations=async()=>{
    for(const host of await page.locator('[data-map]').all()) {
      const slug=await host.getAttribute('data-map');
      const definition=manifest.maps.find(m=>m.slug===slug),expected=expectedStations(definition);
      assert.equal(await host.locator('.map-symbol').count(),expected.length,`${browserName}/${slug}: incorrect default station count`);
      for(const layer of definition.layers.filter(l=>l.geojson && l.visible))
        assert.equal(await host.locator(`.map-symbol[data-layer="${layer.id}"]`).count(),expected.filter(record=>record.definition.id===layer.id).length,`${browserName}/${slug}: incorrect default station markers`);
      if(slug==='slo-karst') {
        assert.equal(await host.locator('.map-symbol[title="JLSP"]').count(),1,'JLSP must appear once, not once per source copy');
        assert.equal(await host.locator('.map-symbol svg circle').count(),0,'No invented fallback dots over station markers');
      }
    }
  };
  for(const route of ['/maps/stations/','/maps/slo-karst/','/data-sites/','/slo-karst-nfo/']) {
    await page.goto(base+route);
    await page.locator('[data-ready="true"]').first().waitFor();
    await settled();
    await checkVisibleStations();
    const host=page.locator('[data-map]').first();
    const slug=await host.getAttribute('data-map');
    const definition=manifest.maps.find(map=>map.slug===slug);
    const assertMarkers=async all=>{
      const expected=expectedStations(definition,all);
      for(const layer of definition.layers.filter(l=>l.geojson && (all || l.visible))) {
        assert.equal(await host.locator(`.map-symbol[data-layer="${layer.id}"]`).count(),expected.filter(record=>record.definition.id===layer.id).length,`${browserName}/${route}: incorrect records in ${layer.id}`);
      }
    };
    await assertMarkers(false);
    await host.locator('.map-symbol').first().waitFor();
    const station=host.locator('.map-symbol[title="JLSP"]').first();
    await (await station.count()?station:host.locator('.map-symbol').first()).click({force:true});
    await host.locator('.map-popup').waitFor();
    assert.ok(await host.locator('.map-popup .map-attributes tr').count()>0);
    if(await station.count()) assert.equal(await host.locator('.map-popup h3').textContent(),'JLSP','Popup must identify the station, not its school/building');
    assert.equal(await host.locator('.map-symbol.is-selected').count(),0,'Station clicks must not add a highlight');
    assert.ok(await host.locator('.map-popup th').evaluateAll(cells=>cells.every(cell=>getComputedStyle(cell).overflowWrap==='normal')),'Popup labels must not break inside words');
    if(await host.locator('.map-feature-navigation').count()) {
      const first=await host.locator('.map-popup h3').textContent();
      await host.locator('.map-feature-navigation').getByRole('button',{name:'Next',exact:true}).click();
      assert.equal(await host.locator('.is-selected').count(),0);
      await host.locator('.map-feature-navigation').getByRole('button',{name:'Previous',exact:true}).click();
      assert.equal(await host.locator('.map-popup h3').textContent(),first);
    }
    if(route==='/maps/stations/') {await popupSettled();await page.screenshot({path:`/tmp/epos-station-popup-${browserName}.png`});}
    await host.locator('.leaflet-popup-close-button').click();
    assert.equal(await host.locator('.map-symbol.is-selected').count(),0,'Selection must clear when popup closes');
    await host.locator('.map-panel summary').click();
    assert.ok(await host.locator('.map-swatch').count()>0);
    const checkbox=host.locator('.map-layer input').first();const checked=await checkbox.isChecked();await checkbox.setChecked(!checked);await checkbox.setChecked(checked);
    await host.getByRole('button',{name:/Attributes/}).first().click();
    await host.locator('dialog .map-attributes tr').nth(1).waitFor();
    await host.getByRole('searchbox').fill('no-matching-record-xyz');
    assert.match(await host.locator('dialog p').textContent(),/^0 of /);
    await host.getByRole('button',{name:'Close',exact:true}).click();
    // Exercise initially hidden archives as well as the default visible layers.
    for(const input of await host.locator('.map-layer input').all()) await input.check();
    await settled();
    await assertMarkers(true);
    assert.ok(await host.locator('canvas.map-vector-tile').count()>0,'Polygon/line tiles did not render');
    assert.ok(await host.locator('canvas.map-vector-tile').evaluateAll(tiles=>tiles.some(tile=>tile.hits?.length>0)),'Vector tiles contain no rendered features');
    await host.locator('.map-panel summary').click();
    const polygonPoint=await host.evaluate(host=>{
      const box=host.getBoundingClientRect();
      for(const tile of host.querySelectorAll('canvas.map-vector-tile')) {
        const rect=tile.getBoundingClientRect(),context=tile.getContext('2d');
        for(let y=32;y<256;y+=32) for(let x=32;x<256;x+=32) {
          const px=rect.left+x,py=rect.top+y;
          if(px<box.left+55 || px>box.right-30 || py<box.top+85 || py>box.bottom-35 || py>innerHeight-30 || py<85) continue;
          if(document.elementFromPoint(px,py)?.closest('.leaflet-marker-icon,.leaflet-control,.map-panel')) continue;
          if(tile.hits?.some(hit=>hit.type===3 && context.isPointInPath(hit.path,x,y,'evenodd'))) return {x:px,y:py};
        }
      }
    });
    assert.ok(polygonPoint,'No clickable polygon found');
    await host.evaluate(host=>{host._tilesBeforeClick=[...host.querySelectorAll('canvas.map-vector-tile')];});
    await page.mouse.click(polygonPoint.x,polygonPoint.y);
    await host.locator('.map-popup').waitFor();
    await settled();
    assert.equal(await host.locator('canvas[data-selected="true"]').count(),0,'Feature clicks must not paint a highlight');
    assert.ok(await host.evaluate(host=>host._tilesBeforeClick.some(tile=>tile.isConnected)),'Opening a popup rebuilt all vector tiles');
    if(route==='/maps/slo-karst/') {await popupSettled();await page.screenshot({path:`/tmp/epos-feature-selection-${browserName}.png`});}
    await host.locator('.leaflet-popup-close-button').click();
    assert.ok(await host.evaluate(host=>host._tilesBeforeClick.some(tile=>tile.isConnected)),'Closing a popup rebuilt all vector tiles');
    await host.locator('.leaflet-control-zoom-in').click();
    await host.getByRole('button',{name:'Reset map view'}).click();
    await settled();await assertMarkers(true);
    assert.equal(await page.locator('iframe').count(),route==='/data-sites/'?1:0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route+' overflow');
    console.log(`Desktop map, popup, legend, layer toggle, attributes and navigation: ${route}`);
  }
  await page.setViewportSize({width:390,height:844});
  for(const route of ['/maps/slo-karst/','/data-sites/']) {
    await page.goto(base+route);await page.locator('[data-ready="true"]').first().waitFor();await settled();await page.locator('.map-symbol').first().waitFor();
    await checkVisibleStations();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route+' mobile overflow');
    await basemapSettled();
    await page.screenshot({path:`/tmp/epos-${route.includes('maps')?'map':'story'}-mobile.png`,fullPage:route.includes('maps')});
    if(route==='/maps/slo-karst/') {
      const labels=page.locator('.map-reference-label[data-layer*="active_fault"] textPath');
      assert.equal(await labels.count(),0,'Fault labels should respect the reference minimum scale');
      for(let i=0;i<2;i++) await zoomIn();
      await labels.first().waitFor();
      await checkVisibleStations();
      await basemapSettled();
      await page.screenshot({path:'/tmp/epos-map-mobile-detail.png'});
      await page.mouse.move(180,500);await page.mouse.down();await page.mouse.move(240,380,{steps:8});await page.mouse.up();
      await settled();await labels.first().waitFor();
      const names=await labels.allTextContents();assert.equal(new Set(names).size,names.length,'Duplicate mobile labels after panning');
      await page.getByRole('button',{name:'Reset map view'}).click();await settled();
      await page.waitForFunction(()=>!document.querySelector('.map-reference-label[data-layer*="active_fault"]'));
      assert.equal(await labels.count(),0,'Stale labels after returning below the reference scale');
      await checkVisibleStations();
      const firstMarker=page.locator('.map-symbol[title="POST"]').first();
      await firstMarker.click({force:true});await page.locator('.map-popup').waitFor();
      assert.ok(await page.locator('.map-popup th').evaluateAll(cells=>cells.every(cell=>getComputedStyle(cell).display==='block' && getComputedStyle(cell).overflowWrap==='normal')),'Mobile attribute labels must stack without splitting words');
      await popupSettled();
      await page.screenshot({path:`/tmp/epos-mobile-popup-${browserName}.png`});
      await page.locator('.leaflet-popup-close-button').click();
    }
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base+'/maps/stations/');await page.locator('.map-symbol').first().waitFor();await settled();
  await basemapSettled();
  await page.screenshot({path:'/tmp/epos-stations-desktop.png'});
  await page.goto(base+'/maps/slo-karst/');await page.locator('.map-symbol').first().waitFor();await settled();await page.locator('.map-panel summary').click();
  await basemapSettled();
  const faultLabels=page.locator('.map-reference-label[data-layer*="active_fault"] textPath');
  await faultLabels.first().waitFor();
  assert.ok(await faultLabels.count()>=5,'Expected named fault segments along the lines');
  const names=await faultLabels.allTextContents();
  assert.ok(names.some(name=>/Idrija|Raša|Predjama/.test(name)),'Missing reference fault names');
  assert.equal(new Set(names).size,names.length,'Duplicate labels at tile boundaries');
  const faultToggle=page.locator('.map-layer').filter({hasText:'Active faults in Slovenia'}).locator('input');
  await faultToggle.uncheck();
  await page.waitForFunction(()=>!document.querySelector('.map-reference-label[data-layer*="active_fault"]'));
  await faultToggle.check();await settled();await faultLabels.first().waitFor();
  const carbonatePixels=await page.locator('canvas[data-layer*="CarbonateRocks"]').evaluateAll(tiles=>{
    let gray=0,colored=0;
    for(const tile of tiles) {
      const pixels=tile.getContext('2d').getImageData(0,0,tile.width,tile.height).data;
      for(let i=0;i<pixels.length;i+=4) if(pixels[i+3]>50) {
        if(pixels[i]===pixels[i+1] && pixels[i+1]===pixels[i+2]) gray++;else colored++;
      }
    }
    return {gray,colored};
  });
  assert.ok(carbonatePixels.gray>10000,'Reference gray carbonate polygons did not render');
  assert.equal(carbonatePixels.colored,0,'Carbonate polygons no longer match the grayscale reference');
  await page.screenshot({path:'/tmp/epos-map-desktop.png'});
  const seamPixels=await page.evaluate(async url=>{
    const {paintTile}=await import(url);
    const results=[];
    for(const ratio of [1,2]) {
      const canvas=document.createElement('canvas');canvas.width=canvas.height=256*ratio;
      const context=canvas.getContext('2d');
      const ring=[[-64,-64],[4160,-64],[4160,4160],[-64,4160],[-64,-64]].map(([x,y])=>({x,y}));
      const layer={extent:4096,length:1,feature:()=>({type:3,properties:{},loadGeometry:()=>[ring]})};
      const style=()=>({fillColor:'#ff0000',fillOpacity:.5,color:'#000000',opacity:1,weight:2});
      paintTile(context,layer,()=>({}),style,ratio);
      for(const x of [0,1,127,254,255]) results.push([...context.getImageData(x*ratio,128*ratio,1,1).data]);
      // MVT inner rings must remain holes, not acquire a second translucent fill.
      context.clearRect(0,0,canvas.width,canvas.height);
      const hole=[[1024,1024],[1024,3072],[3072,3072],[3072,1024],[1024,1024]].map(([x,y])=>({x,y}));
      layer.feature=()=>({type:3,properties:{},loadGeometry:()=>[ring,hole]});
      paintTile(context,layer,()=>({}),style,ratio);
      results.push([...context.getImageData(128*ratio,128*ratio,1,1).data]);
    }
    return results;
  },base+'/assets/js/map.js');
  assert.deepEqual(seamPixels,[...Array(5).fill([255,0,0,128]),[0,0,0,0],...Array(5).fill([255,0,0,128]),[0,0,0,0]],'Buffered tile edges or polygon holes introduce visible bands');
  console.log('Tile-edge transparency and polygon-hole regression passed at 1x and 2x pixel density.');
  await page.locator('.map-panel summary').click();
  // Exercise fresh-canvas overzoom above the archive's z12 maximum.
  for(let i=0;i<5;i++) await zoomIn();
  await basemapSettled();
  assert.ok(await page.locator('canvas.map-vector-tile').evaluateAll(tiles=>tiles.every(tile=>parseFloat(getComputedStyle(tile).width)===256)),'Overzoom enlarged tile bitmaps');
  assert.ok(await page.locator('canvas.map-vector-tile').evaluateAll(tiles=>tiles.some(tile=>Number(tile.dataset.zoom)>12)),'Overzoom was not exercised');
  await page.screenshot({path:'/tmp/epos-map-overzoom.png'});
  await page.goto(base+'/media/');assert.equal(await page.locator('iframe[src*="youtube.com/embed/"]').count(),2);
  // A separate site's document can embed the standalone map; it loads the same component.
  await page.setContent(`<iframe title="Embedded map" src="${base}/maps/slo-karst/" width="900" height="600"></iframe>`);
  await page.frameLocator('iframe').locator('[data-ready="true"]').waitFor();
  await page.frameLocator('iframe').locator('.map-symbol').first().waitFor();
  // The same label renderer must also work inside the small embeddable map.
  const embedded=page.frameLocator('iframe');
  await embedded.locator('.leaflet-control-zoom-in').click();
  await embedded.locator('.map-reference-label[data-layer*="active_fault"] textPath').first().waitFor();
  assert.ok(ranges>0,'PMTiles HTTP range requests were not exercised');
  assert.equal(stationRangeRequests,0,'Stations must not make tile/range requests');
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
  for(const url of external) assert.match(url,/^https:\/\/(?:server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Topo_Map\/MapServer\/tile\/|www\.youtube(?:-nocookie)?\.com\/embed\/)/);
  console.log(`${browserName}: browser checks passed at ${prefix || '/'}; ${ranges} local range requests. All station counts verified; only Esri topo tiles and permitted YouTube embeds requested externally.`);
} finally {await browser.close();server.close();}
