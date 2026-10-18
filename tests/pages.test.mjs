import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {buildPages} from '../scripts/build-pages.mjs';
test('Pages build supports repository subpaths and publishes no server code or catalog',async()=>{
 const temp=await mkdtemp(join(tmpdir(),'taiwan-pages-'));const output=join(temp,'site');
 try{
  await buildPages({output,apiBase:'https://taiwan-api.example.com',customDomain:'taiwan.example.com'});
  const html=await readFile(join(output,'index.html'),'utf8'),config=await readFile(join(output,'config.js'),'utf8');
  assert.ok(html.includes('src="./config.js"'));assert.ok(html.includes('src="./app.js"'));assert.ok(html.includes('href="./style.css"'));assert.ok(html.includes("connect-src 'self' https://taiwan-api.example.com"));assert.ok(!html.includes('frame-ancestors'));
  for(const match of html.matchAll(/(?:src|href)="(\.\/[^"#]*)"/g)){const file=match[1].slice(2);if(file)await readFile(join(output,file))}
  assert.ok(config.includes('"requiresApi":true'));assert.ok(!html.includes('passwordHash'));assert.ok(!html.includes('APP_PASSWORD_HASH'));
  const names=await readdir(output);for(const forbidden of ['src','server','drizzle','places.mjs','.env'])assert.ok(!names.includes(forbidden));assert.equal(await readFile(join(output,'CNAME'),'utf8'),'taiwan.example.com\n');
  await assert.rejects(buildPages({output,apiBase:'http://untrusted.example'}));await buildPages({output,apiBase:'https://svobodadlaseti.shop/taiwan'});assert.ok((await readFile(join(output,'config.js'),'utf8')).includes('https://svobodadlaseti.shop/taiwan'));assert.ok((await readFile(join(output,'index.html'),'utf8')).includes("connect-src 'self' https://svobodadlaseti.shop"));await assert.rejects(buildPages({output,apiBase:'https://api.example.com/path?token=no'}));await assert.rejects(buildPages({output,customDomain:'bad\nexample.com'}));
  await buildPages({output});assert.ok((await readFile(join(output,'config.js'),'utf8')).includes('"apiBase":""'));assert.ok(!(await readdir(output)).includes('CNAME'));
 }finally{await rm(temp,{recursive:true,force:true})}
});
