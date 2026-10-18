import {cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {page,securityHeaders} from '../src/ui.mjs';
export async function buildPages({output=resolve('dist'),apiBase='',customDomain='',authMode='bearer'}={}){
 if(!['cookie','bearer'].includes(authMode))throw new Error('PAGES_AUTH_MODE must be cookie or bearer');
 if(apiBase){const url=new URL(apiBase);const normalized=url.origin+url.pathname.replace(/\/$/,'');if(url.protocol!=='https:'||normalized!==apiBase||url.search||url.hash||url.username||url.password||!/^[a-zA-Z0-9/_-]*$/.test(url.pathname))throw new Error('PAGES_API_BASE must be an HTTPS URL with an optional simple path prefix, no trailing slash or credentials');}
 if(customDomain&&!/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(customDomain))throw new Error('Invalid PAGES_CUSTOM_DOMAIN');
 output=resolve(output);const root=fileURLToPath(new URL('..',import.meta.url));
 if(output===resolve(root)||resolve(root,'public').startsWith(output+'/'))throw new Error('Unsafe output directory');
 await rm(output,{recursive:true,force:true});await mkdir(output,{recursive:true});await cp(new URL('../public/',import.meta.url),output,{recursive:true});
 const assetNames=['app.js','api-client.js','style.css','accounts.js','password-fields.js','map-model.js','statuses.js','categories.js','help.js'];
 const assets=Object.fromEntries(await Promise.all(assetNames.map(async name=>[name,await readFile(new URL('../public/'+name,import.meta.url),'utf8')])));
 const version=Object.values(assets).reduce((hash,source)=>hash.update(source),createHash('sha256').update(page).update(JSON.stringify({apiBase,authMode,customDomain}))).digest('hex').slice(0,12);
 const csp=securityHeaders['Content-Security-Policy'].replace(/; frame-ancestors[^;]*/,'').replace("connect-src 'self'",`connect-src 'self'${apiBase?' '+new URL(apiBase).origin:''}`);
 // Relative files support both /taiwan-map/ and a custom domain root.
 const html=page.replace(/(href|src)="\/(?!api\/)/g,'$1="./').replace(/((?:href|src)="\.\/(?:app\.js|style\.css|config\.js))"/g,`$1?v=${version}"`).replace('<meta name="theme-color"',`<meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="strict-origin-when-cross-origin"><meta name="theme-color"`);
 await writeFile(resolve(output,'index.html'),html);
 for(const [name,source] of Object.entries(assets))if(name.endsWith('.js')){
  const versioned=source.replace(/from '(\.\/[a-z-]+\.js)'/g,(original,path)=>assets[path.slice(2)]?`from '${path}?v=${version}'`:original);
  await writeFile(resolve(output,name),versioned);
 }
 await writeFile(resolve(output,'config.js'),'// Public config, not a secret store.\nwindow.TAIWAN_CONFIG = Object.freeze('+JSON.stringify({apiBase,requiresApi:true,authMode})+');\n');
 await writeFile(resolve(output,'.nojekyll'),'');
 if(customDomain)await writeFile(resolve(output,'CNAME'),customDomain+'\n');
 return {output,apiConfigured:!!apiBase,customDomain:customDomain||null};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const deployment=JSON.parse(await readFile(new URL('../pages.config.json',import.meta.url),'utf8'));
 console.log(JSON.stringify(await buildPages({apiBase:process.env.PAGES_API_BASE||deployment.apiBase||'',customDomain:process.env.PAGES_CUSTOM_DOMAIN||deployment.customDomain||'',authMode:process.env.PAGES_AUTH_MODE||deployment.authMode||'bearer'})));
}
