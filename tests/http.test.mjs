import test from 'node:test';import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {mkdtemp,rm,readdir} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {once} from 'node:events';import {createServer} from 'node:net';import {passwordHash} from '../src/core.mjs';
test('Node HTTP adapter accepts cross-origin login, state, scoped logout, and backs up seeded data',async()=>{
 const probe=createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const dir=await mkdtemp(join(tmpdir(),'taiwan-http-')),origin=`http://127.0.0.1:${port}`,frontend='https://taiwan.example.com';
 const child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,APP_PASSWORD_HASH:await passwordHash('http-test-password'),APP_ORIGIN:origin,FRONTEND_ORIGIN:frontend,SESSION_COOKIE_PATH:'/taiwan/api',DATABASE_PATH:join(dir,'taiwan.sqlite'),PORT:String(port),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 try{
  await Promise.race([new Promise((resolve,reject)=>{const timer=setInterval(()=>{if(output.includes('listening on port')){clearInterval(timer);resolve()}else if(child.exitCode!==null){clearInterval(timer);reject(new Error(output))}},20)}),new Promise((_,reject)=>setTimeout(()=>reject(new Error('HTTP startup timed out')),5000).unref())]);
  assert.equal((await fetch(origin+'/api/health')).status,200);
  let r=await fetch(origin+'/api/login',{method:'POST',headers:{Origin:frontend,'Content-Type':'application/json'},body:JSON.stringify({password:'http-test-password'})});assert.equal(r.status,200);const cookie=r.headers.get('set-cookie');assert.match(cookie,/Path=\/taiwan\/api/);assert.equal(r.headers.get('access-control-allow-origin'),frontend);
  r=await fetch(origin+'/api/data',{headers:{Origin:frontend,Cookie:cookie.split(';')[0]}});assert.equal(r.status,200);assert.equal((await r.json()).places.length,10);assert.ok((await readdir(join(dir,'backups'))).some(n=>n.endsWith('.sqlite')));
  r=await fetch(origin+'/api/logout',{method:'POST',headers:{Origin:frontend,Cookie:cookie.split(';')[0]}});assert.equal(r.status,200);assert.match(r.headers.get('set-cookie'),/Path=\/taiwan\/api/);assert.match(r.headers.get('set-cookie'),/Max-Age=0/);
  assert.equal((await fetch(origin+'/api/data',{headers:{Origin:frontend,Cookie:cookie.split(';')[0]}})).status,401);
 }finally{child.kill('SIGTERM');if(child.exitCode===null)await once(child,'exit');await rm(dir,{recursive:true,force:true})}
});
