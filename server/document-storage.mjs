import { mkdirSync, openSync, closeSync, readFileSync, fstatSync, lstatSync, renameSync, unlinkSync, readdirSync, constants, chmodSync, existsSync, realpathSync, fsyncSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { resolve, join, sep, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const MAX_DOCUMENT_BYTES=20*1024*1024;
export const documentHash=bytes=>createHash('sha256').update(bytes).digest('hex');
// Signature validation, not a malware scanner. All downloads are attachments.
export function detectDocumentMime(bytes){
  if(bytes.length>=12&&/^%PDF-[12]\.\d/.test(bytes.subarray(0,8).toString('ascii'))&&/%%EOF\s*$/.test(bytes.subarray(-1024).toString('latin1')))return 'application/pdf';
  if(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes.at(-2)===255&&bytes.at(-1)===217)return 'image/jpeg';
  if(bytes.length>=45&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.subarray(12,16).toString()==='IHDR'&&bytes.readUInt32BE(8)===13&&bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(20)>0&&bytes.subarray(-12).equals(Buffer.from([0,0,0,0,73,69,78,68,174,66,96,130])))return 'image/png';
  return null;
}
export function createDocumentStorage(directory,{maxBytes=MAX_DOCUMENT_BYTES,quotaBytes=512*1024*1024}={}){
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_DOCUMENT_BYTES||!Number.isSafeInteger(quotaBytes)||quotaBytes<maxBytes)throw new Error('Invalid document limits');
  const requested=resolve(directory);let ancestor=requested;
  while(!existsSync(ancestor))ancestor=dirname(ancestor);
  const root=resolve(realpathSync(ancestor),relative(ancestor,requested)),project=realpathSync(fileURLToPath(new URL('..',import.meta.url)));
  if(['public','dist','.git'].some(name=>root===join(project,name)||root.startsWith(join(project,name)+sep)))throw new Error('Document storage must be private');
  for(const dir of [root,join(root,'staging'),join(root,'assets')]){
    mkdirSync(dir,{recursive:true,mode:0o700});
    if(lstatSync(dir).isSymbolicLink()||!lstatSync(dir).isDirectory())throw new Error('Unsafe document directory');
    chmodSync(dir,0o700);
  }
  const path=(area,key)=>{if(!['staging','assets'].includes(area)||!/^[a-f0-9-]{36}$/.test(key))throw new Error('Invalid storage key');return join(root,area,key);};
  function read(area,key){
    const fd=openSync(path(area,key),constants.O_RDONLY|constants.O_NOFOLLOW);
    try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size>maxBytes)throw new Error('Invalid asset size');return readFileSync(fd);}finally{closeSync(fd);}
  }
  const verified=new Map();
  function inspect(asset,{includeBytes=false}={}){
    try{if(asset.status!=='ready')return {availability:'unavailable'};
      const stat=lstatSync(path('assets',asset.storage_key),{bigint:true});
      if(!stat.isFile()||stat.size!==BigInt(asset.byte_size))return {availability:'unavailable'};
      const signature=[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs,asset.sha256,asset.detected_mime].join(':');
      if(!includeBytes&&verified.get(asset.id)===signature)return {availability:'ready'};
      const bytes=read('assets',asset.storage_key);
      if(bytes.length!==asset.byte_size||documentHash(bytes)!==asset.sha256||detectDocumentMime(bytes)!==asset.detected_mime)return {availability:'unavailable'};
      if(verified.size>=256)verified.delete(verified.keys().next().value);verified.set(asset.id,signature);
      return {availability:'ready',...(includeBytes?{bytes}:{})};
    }catch{return {availability:'unavailable'};}
  }
  return {root,maxBytes,quotaBytes,path,read,inspect,
    async receive(key,stream,limit){
      const file=await open(path('staging',key),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);let size=0;
      try{for await(const chunk of stream){size+=chunk.byteLength;if(size>limit||size>maxBytes){const e=new Error('Upload too large');e.code='UPLOAD_TOO_LARGE';throw e;}await file.writeFile(chunk);}await file.sync();return size;}finally{await file.close();}
    },
    promote(key){
      renameSync(path('staging',key),path('assets',key));
      for(const area of ['staging','assets']){const fd=openSync(join(root,area),constants.O_RDONLY);try{fsyncSync(fd);}finally{closeSync(fd);}}
    },
    remove(area,key){try{unlinkSync(path(area,key));}catch(e){if(e.code!=='ENOENT')throw e;}},
    entries(area){return readdirSync(join(root,area)).filter(key=>/^[a-f0-9-]{36}$/.test(key)).map(key=>({key,mtime:lstatSync(path(area,key)).mtimeMs}));},
  };
}
