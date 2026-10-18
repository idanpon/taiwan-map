import {deflateSync} from 'node:zlib';
import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {brandStrokes,iconBackground,iconForeground,favicon} from '../src/brand.mjs';
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0)}return (crc^0xffffffff)>>>0}
function chunk(type,bytes){const data=Buffer.concat([Buffer.from(type),bytes]),header=Buffer.alloc(4),tail=Buffer.alloc(4);header.writeUInt32BE(bytes.length);tail.writeUInt32BE(crc32(data));return Buffer.concat([header,data,tail])}
function nearStroke(x,y){return brandStrokes.some(([a,b,c,d])=>{const dx=c-a,dy=d-b,t=Math.max(0,Math.min(1,((x-a)*dx+(y-b)*dy)/(dx*dx+dy*dy)));return Math.hypot(x-a-t*dx,y-b-t*dy)<=1.75})}
export function appIcon(size=180){
 // Supersample the same vector strokes. No font or external rasterizer needed.
 const samples=4,raw=Buffer.alloc(size*(1+size*3));
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  let covered=0;for(let j=0;j<samples;j++)for(let i=0;i<samples;i++)if(nearStroke((x+(i+.5)/samples)*64/size,(y+(j+.5)/samples)*64/size))covered++;
  for(let c=0;c<3;c++)raw[y*(1+size*3)+1+x*3+c]=Math.round(iconBackground[c]+(iconForeground[c]-iconBackground[c])*covered/(samples*samples));
 }
 const header=Buffer.alloc(13);header.writeUInt32BE(size);header.writeUInt32BE(size,4);header[8]=8;header[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('sRGB',Buffer.from([0])),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 await writeFile(new URL('../public/favicon.svg',import.meta.url),favicon);
 await writeFile(new URL('../public/apple-touch-icon.png',import.meta.url),appIcon());
}
