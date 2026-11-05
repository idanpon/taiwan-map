import {createECDH,createHash} from 'node:crypto';
import webpush from 'web-push';
import {validPushEndpoint,webPushKey} from '../src/notifications.mjs';

export function pushTransport(env,frontendOrigin,appOrigin){
 const {PUSH_VAPID_PUBLIC_KEY:publicKey,PUSH_VAPID_PRIVATE_KEY:privateKey,PUSH_VAPID_SUBJECT:subject}=env;
 if(!publicKey&&!privateKey&&!subject)return null;
 const key=webPushKey(privateKey,32);
 const ecdh=createECDH('prime256v1');
 if(!key||!webPushKey(publicKey,65)||typeof subject!=='string')throw new Error('Invalid Web Push configuration');
 ecdh.setPrivateKey(key);
 if(ecdh.getPublicKey().toString('base64url')!==publicKey)throw new Error('Web Push keys do not match');
 const contact=new URL(subject);
 if(!['https:','mailto:'].includes(contact.protocol)||contact.username||contact.password||
  contact.protocol==='https:'&&['localhost','127.0.0.1'].includes(contact.hostname))throw new Error('Invalid VAPID contact');
 // Payload paths are relative to the service worker scope. The sender needs
 // only the VAPID identity; application navigation stays on the receiving origin.
 if(!(frontendOrigin||appOrigin)?.startsWith('https:'))throw new Error('Web Push needs an HTTPS site');
 return {publicKey,async send(device,payload,ttl){
  if(!validPushEndpoint(device.endpoint))return 'failed';
  try{
   await webpush.sendNotification({endpoint:device.endpoint,keys:{p256dh:device.p256dh,auth:device.auth}},
    JSON.stringify(payload),{TTL:ttl,urgency:'normal',topic:createHash('sha256').update(payload.tag).digest('base64url').slice(0,32),
     timeout:8000,vapidDetails:{subject,publicKey,privateKey}});
   return 'sent';
  }catch(error){
   if(error.statusCode===404||error.statusCode===410)return 'expired';
   if(error.statusCode===429||error.statusCode>=500)return 'retry';
   // A network timeout can occur after acceptance; don't resend an uncertain
   // request. A known provider rejection can be retried safely.
   return 'failed';
  }
 }};
}
