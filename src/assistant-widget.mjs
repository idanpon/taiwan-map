import { App } from '@modelcontextprotocol/ext-apps';
import { mountAssistant, unpack, node } from '../public/assistant-card.js';
const app=new App({name:'Taiwan Map · Предложение',version:'0.1.0'});
const root=document.getElementById('assistant-card');
const ui=mountAssistant(root,async(name,args)=>unpack(await app.callServerTool({name,arguments:args})),{
  openLink:url=>app.openLink({url}),
  onApplied:receipt=>app.sendMessage({role:'user',content:[{type:'text',text:`Taiwan Map подтвердил сохранение предложения ${receipt.proposal_id}. Квитанция: ${receipt.operation_id}.`}]})
});
const theme=context=>{const value=context?.theme==='dark'?'dark':'light';document.documentElement.dataset.theme=value;document.documentElement.style.colorScheme=value;};
app.ontoolresult=result=>{try{ui.set(unpack(result));}catch(e){root.replaceChildren(node('p',e.message,'assistant-error'));}};
app.onhostcontextchanged=theme;
try{await app.connect();theme(app.getHostContext());}
catch{root.replaceChildren(node('p','Карточка недоступна. Продолжите в чате или откройте ссылку предпросмотра на сайте.'));}
