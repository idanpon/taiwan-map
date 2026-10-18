import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {buildPages} from '../scripts/build-pages.mjs';
import {spawnSync} from 'node:child_process';
test('Pages build supports repository subpaths and publishes no server code or catalog',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'taiwan-pages-'));const output=join(temp,'site');
 try{
  await buildPages({output,apiBase:'https://taiwan-api.example.com',customDomain:'taiwan.example.com'});
  const html=await readFile(join(output,'index.html'),'utf8'),config=await readFile(join(output,'config.js'),'utf8');
  const version=html.match(/app\.js\?v=([a-f0-9]{12})/)[1];
  assert.ok(html.includes('src="./config.js?v='+version+'"'));assert.ok(html.includes('src="./app.js?v='+version+'"'));assert.ok(html.includes('href="./style.css?v='+version+'"'));assert.ok(html.includes("connect-src 'self' https://taiwan-api.example.com"));assert.ok(!html.includes('frame-ancestors'));
  for(const match of html.matchAll(/(?:src|href)="(\.\/[^"#]*)"/g)){const file=match[1].slice(2).split('?')[0];if(file)await readFile(join(output,file))}
  assert.ok(config.includes('"requiresApi":true'));assert.ok(config.includes('"authMode":"bearer"'));assert.ok(html.includes('type="module" src="./app.js?v='));assert.ok((await readFile(join(output,'app.js'),'utf8')).includes("from './api-client.js?v="+version+"'"));await readFile(join(output,'api-client.js'));assert.ok(!html.includes('passwordHash'));assert.ok(!html.includes('APP_PASSWORD_HASH'));
  const names=await readdir(output);for(const forbidden of ['src','server','drizzle','places.mjs','.env'])assert.ok(!names.includes(forbidden));assert.equal(await readFile(join(output,'CNAME'),'utf8'),'taiwan.example.com\n');
  assert.ok((await readFile(join(output,'accounts.js'),'utf8')).includes("from './password-fields.js?v="+version+"'"));await readFile(join(output,'password-fields.js'));
  for(const module of ['map-model.js','statuses.js','categories.js','help.js','place-tags.js','place-tag-controls.js']){await readFile(join(output,module));assert.ok((await readFile(join(output,'app.js'),'utf8')).includes("from './"+module+"?v="+version+"'"));}
  assert.ok((await readFile(join(output,'statuses.js'),'utf8')).includes("from './map-model.js?v="+version+"'"));
  assert.ok((await readFile(join(output,'help.js'),'utf8')).includes("from './categories.js?v="+version+"'"));
  assert.ok((await readFile(join(output,'help.js'),'utf8')).includes("from './dialogs.js?v="+version+"'"));
  await readFile(join(output,'vendor/lucide-LICENSE.txt'));
  assert.ok(!html.includes('leaflet'));assert.ok(!names.includes('leaflet.js'));
  assert.ok(html.indexOf('theme-init.js?v=')<html.indexOf('rel="stylesheet"'));
  assert.ok(html.includes("worker-src 'self'"));assert.ok(html.includes('https://tiles.openfreemap.org'));
  assert.ok(html.includes('rel="apple-touch-icon" sizes="180x180" href="./apple-touch-icon.png?v='+version+'"'));
  assert.deepEqual(await readFile(join(output,'apple-touch-icon.png')),await readFile('public/apple-touch-icon.png'));
  assert.ok((await readFile(join(output,'accounts.js'),'utf8')).includes("from './dialogs.js?v="+version+"'"));
  assert.ok(html.includes('https://tile.openstreetmap.org'));assert.ok(html.includes('strict-origin-when-cross-origin'));
  for(const name of ['theme-init.js','theme.js','map-config.js','basemap.js','map-view.js','auth-startup.js','place-lifecycle.js','dialogs.js','vendor/maplibre-6.15.0/maplibre-gl.js','vendor/maplibre-6.15.0/maplibre-gl-worker.js','vendor/maplibre-6.15.0/maplibre-gl.css','vendor/maplibre-6.15.0/LICENSE.txt'])await readFile(join(output,name));
  assert.ok((await readFile(join(output,'map-view.js'),'utf8')).includes("from './basemap.js?v="+version+"'"));
  assert.ok((await readFile(join(output,'map-view.js'),'utf8')).includes("from './map-compass.js?v="+version+"'"));await readFile(join(output,'map-compass.js'));
  assert.ok((await readFile(join(output,'map-view.js'),'utf8')).includes("from './map-framing.js?v="+version+"'"));await readFile(join(output,'map-framing.js'));
  assert.match(html,/<button id="map-north"[^>]*aria-label="Север наверх"[^>]*hidden>/);
  assert.ok((await readFile(join(output,'basemap.js'),'utf8')).includes("from './map-config.js?v="+version+"'"));
  const vendorNames=await readdir(join(output,'vendor'));assert.ok(!vendorNames.some(name=>/leaflet/i.test(name)));
  await assert.rejects(buildPages({output,apiBase:'http://untrusted.example'}));await buildPages({output,apiBase:'https://api.example.com/taiwan',authMode:'cookie'});assert.ok((await readFile(join(output,'config.js'),'utf8')).includes('https://api.example.com/taiwan'));assert.ok((await readFile(join(output,'config.js'),'utf8')).includes('"authMode":"cookie"'));assert.ok((await readFile(join(output,'index.html'),'utf8')).includes("connect-src 'self' https://api.example.com"));await assert.rejects(buildPages({output,authMode:'invalid'}));await assert.rejects(buildPages({output,apiBase:'https://api.example.com/path?token=no'}));await assert.rejects(buildPages({output,customDomain:'bad\nexample.com'}));
  await buildPages({output});assert.ok((await readFile(join(output,'config.js'),'utf8')).includes('"apiBase":""'));assert.ok(!(await readdir(output)).includes('CNAME'));assert.ok(!(await readFile(join(output,'index.html'),'utf8')).includes('app.js?v='+version));
 }finally{await rm(temp,{recursive:true,force:true})}
});
test('CLI publishes the tracked public API configuration when repository variables are unset',async()=>{
 const temporary=await mkdtemp(join(tmpdir(),'taiwan-cli-'));
 try{
  const expected=JSON.parse(await readFile(new URL('../pages.config.json',import.meta.url),'utf8'));
  const result=spawnSync(process.execPath,[resolve('scripts/build-pages.mjs')],{cwd:temporary,env:{...process.env,PAGES_API_BASE:'',PAGES_CUSTOM_DOMAIN:'',PAGES_AUTH_MODE:''},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);const output=join(temporary,'dist');
  const config=await readFile(join(output,'config.js'),'utf8');assert.ok(config.includes(JSON.stringify(expected.apiBase)));assert.ok(config.includes('"authMode":"bearer"'));
  assert.ok((await readFile(join(output,'index.html'),'utf8')).includes("connect-src 'self' "+expected.apiBase));assert.ok(!(await readdir(output)).includes('CNAME'));assert.ok(!(await readdir(output)).includes('pages.config.json'));
 }finally{await rm(temporary,{recursive:true,force:true})}
});
