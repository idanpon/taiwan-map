import {createRemoteJWKSet,jwtVerify} from 'jose';
const keys=createRemoteJWKSet(new URL('https://oauth.telegram.org/.well-known/jwks.json'),{timeoutDuration:5000});
export async function verifyTelegram(idToken,nonce,clientId,keySet=keys){
 const {payload}=await jwtVerify(idToken,keySet,{
  issuer:'https://oauth.telegram.org',audience:String(clientId),algorithms:['RS256'],
  requiredClaims:['sub','iat','exp','nonce'],maxTokenAge:'5 minutes',clockTolerance:10
 });
 if(payload.nonce!==nonce||typeof payload.sub!=='string'||!/^\d{1,64}$/.test(payload.sub))throw new Error('Invalid Telegram identity');
 return {subject:payload.sub,name:typeof payload.name==='string'?payload.name.slice(0,80):'Участник Telegram'};
}
