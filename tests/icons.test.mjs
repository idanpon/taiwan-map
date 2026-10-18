import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {inflateSync} from 'node:zlib';
import {appIcon} from '../scripts/generate-icons.mjs';import {favicon,brandMark,brandPath,iconBackground,iconForeground} from '../src/brand.mjs';
test('the committed iPhone icon is an opaque 180px PNG generated from the same eight-spoke vector as the site and favicon',async()=>{
 const png=await readFile('public/apple-touch-icon.png');assert.deepEqual(png,appIcon());
 assert.deepEqual([...png.subarray(0,8)],[137,80,78,71,13,10,26,10]);assert.equal(png.readUInt32BE(16),180);assert.equal(png.readUInt32BE(20),180);assert.equal(png[25],2);
 const idat=[];for(let p=8;p<png.length;){const length=png.readUInt32BE(p),type=png.toString('ascii',p+4,p+8);if(type==='IDAT')idat.push(png.subarray(p+8,p+8+length));p+=length+12}
 const raw=inflateSync(Buffer.concat(idat)),pixel=(x,y)=>[...raw.subarray(y*541+1+x*3,y*541+1+x*3+3)];
 assert.deepEqual(pixel(0,0),iconBackground);assert.deepEqual(pixel(179,179),iconBackground);
 for(const [x,y] of [[90,40],[40,90],[90,140],[140,90],[55,55],[125,55],[55,125],[125,125]])assert.deepEqual(pixel(x,y),iconForeground);
 assert.equal(await readFile('public/favicon.svg','utf8'),favicon);assert.ok(brandMark.includes(brandPath));assert.ok(!favicon.includes('<text'));
});
