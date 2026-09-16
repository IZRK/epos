import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const prefix=(process.env.PATH_PREFIX || '').replace(/\/$/,'');
const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.mp4':'video/mp4','.pmtiles':'application/octet-stream'};
let ranges=0;
const server=createServer(async(req,res)=>{
  try {
    let url=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(prefix) {assert.ok(url.startsWith(prefix+'/'));url=url.slice(prefix.length);}
    const file=path.resolve('_site','.'+url+(url.endsWith('/')?'index.html':'')); assert.ok(file.startsWith(path.resolve('_site')+path.sep));
    const bytes=await fs.readFile(file);const headers={'Content-Type':types[path.extname(file)] || 'application/octet-stream','Accept-Ranges':'bytes'};
    const range=req.headers.range?.match(/bytes=(\d+)-(\d*)/);
    if(range) {const start=Number(range[1]),end=Math.min(bytes.length-1,range[2]?Number(range[2]):bytes.length-1);ranges++;res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${bytes.length}`});res.end(bytes.subarray(start,end+1));}
    else {res.writeHead(200,headers);res.end(bytes);}
  } catch {res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,base=origin+prefix;
const browser=await chromium.launch({headless:true});
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
  };
  for(const route of ['/maps/stations/','/maps/slo-karst/','/data-sites/','/slo-karst-nfo/']) {
    await page.goto(base+route);
    await page.locator('[data-ready="true"]').first().waitFor();
    await settled();
    const host=page.locator('[data-map]').first();
    await host.locator('.map-symbol').first().waitFor();
    await host.locator('.map-symbol').first().click({force:true});
    await host.locator('.map-popup').waitFor();
    assert.ok(await host.locator('.map-popup .map-attributes tr').count()>0);
    await host.locator('.leaflet-popup-close-button').click();
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
    assert.ok(await host.locator('path.leaflet-interactive').count()>0,'Polygon/line overlays did not render');
    await host.locator('.map-panel summary').click();
    await host.locator('.leaflet-control-zoom-in').click();
    await host.getByRole('button',{name:'Reset map view'}).click();
    assert.equal(await page.locator('iframe').count(),route==='/data-sites/'?1:0);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route+' overflow');
    console.log(`Desktop map, popup, legend, layer toggle, attributes and navigation: ${route}`);
  }
  await page.setViewportSize({width:390,height:844});
  for(const route of ['/maps/slo-karst/','/data-sites/']) {
    await page.goto(base+route);await page.locator('[data-ready="true"]').first().waitFor();await settled();await page.locator('.map-symbol').first().waitFor();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),route+' mobile overflow');
    await page.screenshot({path:`/tmp/epos-${route.includes('maps')?'map':'story'}-mobile.png`,fullPage:route.includes('maps')});
  }
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(base+'/maps/slo-karst/');await page.locator('.map-symbol').first().waitFor();await settled();await page.locator('.map-panel summary').click();
  await page.screenshot({path:'/tmp/epos-map-desktop.png'});
  await page.goto(base+'/media/');assert.equal(await page.locator('iframe[src*="youtube.com/embed/"]').count(),2);
  // A separate site's document can embed the standalone map; it loads the same component.
  await page.setContent(`<iframe title="Embedded map" src="${base}/maps/slo-karst/" width="900" height="600"></iframe>`);
  await page.frameLocator('iframe').locator('[data-ready="true"]').waitFor();
  await page.frameLocator('iframe').locator('.map-symbol').first().waitFor();
  assert.ok(ranges>0,'PMTiles HTTP range requests were not exercised');
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);
  for(const url of external) assert.match(url,/^https:\/\/(?:server\.arcgisonline\.com\/ArcGIS\/rest\/services\/World_Topo_Map\/MapServer\/tile\/|www\.youtube(?:-nocookie)?\.com\/embed\/)/);
  console.log(`Browser checks passed at ${prefix || '/'}; ${ranges} local range requests. Only Esri topo tiles and permitted YouTube embeds requested externally.`);
} finally {await browser.close();server.close();}
