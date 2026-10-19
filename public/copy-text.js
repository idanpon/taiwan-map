const fields=Object.freeze({
 name:{action:'Скопировать название',done:'Название скопировано'},
 local_name:{action:'Скопировать китайское название',done:'Китайское название скопировано'},
 address:{action:'Скопировать адрес',done:'Адрес скопирован'}
});
export function copyTextControl(text,field,esc){
 if(!fields[field]||!String(text??'').trim())return '';
 return `<button type="button" class="copy-text" data-copy-field="${field}" title="${fields[field].action}" aria-label="${esc(fields[field].action+': '+text)}">${esc(text)}</button>`;
}
export async function copyText(text,{navigator=globalThis.navigator,document=globalThis.document}={}){
 if(typeof text!=='string'||!text.trim())return false;
 try{if(navigator?.clipboard?.writeText){await navigator.clipboard.writeText(text);return true}}catch{}
 // Legacy fallback stays within the click action and never opens an editor/keyboard.
 if(!document?.execCommand||!document.body)return false;
 const active=document.activeElement,selection=document.getSelection?.(),ranges=[];
 if(selection)for(let i=0;i<selection.rangeCount;i++)ranges.push(selection.getRangeAt(i).cloneRange());
 const input=document.createElement('textarea');input.value=text;input.readOnly=true;input.tabIndex=-1;input.setAttribute('aria-hidden','true');
 Object.assign(input.style,{position:'fixed',top:'0',left:'0',width:'1px',height:'1px',padding:'0',border:'0',opacity:'0',fontSize:'16px'});
 try{document.body.append(input);input.focus({preventScroll:true});input.select();input.setSelectionRange(0,text.length);return document.execCommand('copy')===true}catch{return false}
 finally{input.remove();active?.focus?.({preventScroll:true});if(selection&&ranges.length){selection.removeAllRanges();for(const range of ranges)selection.addRange(range)}}
}
export function installPlaceCopy({root,getPlace,toast,write=copyText}){
 let request=0,blurTimer,keyboardSequence=0;
 // Keep keyboard focus visible if the user starts navigating before this expires.
 root.addEventListener('keydown',()=>{keyboardSequence++;clearTimeout(blurTimer)});
 root.addEventListener('click',async event=>{
  const button=event.target.closest('[data-copy-field]');if(!button||!root.contains(button))return;
  const field=button.dataset.copyField,place=getPlace();if(!fields[field]||!place)return;
  clearTimeout(blurTimer);
  const current=++request,keyboardAtClick=keyboardSequence;let copied=false;try{copied=await write(place[field])}catch{}
  if(current===request){
   toast(copied?fields[field].done:'Не удалось скопировать. Выделите текст и выберите «Скопировать».');
   // A tap/click may leave Safari's focus ring behind. Never move focus away
   // from another control or clear the keyboard user's navigation position.
   if(event.detail>0&&keyboardAtClick===keyboardSequence)blurTimer=setTimeout(()=>{
    if(button.ownerDocument?.activeElement===button)button.blur();
   },1400);
  }
 });
}
