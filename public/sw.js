// Web Push only. Requests and caches are left to the browser.
const scope=new URL(self.registration.scope);
const planner=new URL('planning.html',scope);
function target(path){
 if(typeof path!=='string'||!/^planning\.html(?:#item=[a-zA-Z0-9-]+)?$/.test(path))return planner.href;
 return new URL(path,scope).href;
}
self.addEventListener('push',event=>{
 let data;
 try{data=event.data?.json()}catch{}
 if(!data||typeof data.title!=='string')return;
 event.waitUntil(self.registration.showNotification(data.title.slice(0,160),{
  body:typeof data.body==='string'?data.body.slice(0,260):'',
  icon:new URL('apple-touch-icon.png',scope).href,
  tag:typeof data.tag==='string'?data.tag.slice(0,100):'taiwan-reminder',
  data:{url:target(data.path)}
 }));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const saved=event.notification.data?.url;
 const path=typeof saved==='string'&&saved.startsWith(scope.href)?saved.slice(scope.href.length):'';
 const url=target(path);
 event.waitUntil((async()=>{
  const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const exact=windows.find(client=>client.url===url);
  if(exact)return exact.focus();
  return self.clients.openWindow(url);
 })());
});
