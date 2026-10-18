import {installDialogBackdrop} from './dialogs.js';
import {validStatusSymbol,statusAppearance} from './map-model.js';
export function createStatusUI({api,$,esc,getData,onChange,toast}){
 let editing=null,busy=false;
 const form=$('status-form');
 installDialogBackdrop($('status-dialog'),{canClose:()=>!busy});
 function expand(open){
  form.hidden=!open;$('status-dialog').classList.toggle('status-editor-open',open);
  const button=$('status-new');button.textContent=open&&!editing?'− Свернуть форму':'＋ Новый статус';
  if(editing)button.removeAttribute('aria-expanded');else button.setAttribute('aria-expanded',String(open));
 }
 function preview(){
  const symbol=$('status-symbol').value.normalize('NFC'),valid=validStatusSymbol(symbol);
  $('status-symbol').setCustomValidity(valid?'':'Введите один текстовый знак без emoji или оставьте поле пустым.');
  const status=statusAppearance({color:$('status-color').value,symbol:valid?symbol:'',dimmed:$('status-dimmed').checked});
  $('status-preview-circle').textContent=status.symbol;$('status-preview-circle').style.backgroundColor=status.color;$('status-preview-circle').style.color=status.symbolColor;$('status-preview-circle').style.opacity=status.opacity;
  $('status-preview-label').textContent=$('status-name').value.trim()||'Ваш статус';
 }
 function renderList(){
  $('status-list').innerHTML=getData().statuses.map(s=>{const view=statusAppearance(s);return `<button type="button" class="status-option" data-edit-status="${esc(s.id)}" aria-label="Изменить статус «${esc(s.label)}»" aria-pressed="${editing?.id===s.id}"><span class="status-preview-circle" style="background:${view.color};color:${view.symbolColor};opacity:${view.opacity}" aria-hidden="true">${esc(view.symbol)}</span><span>${esc(s.label)}</span><span class="status-edit-label">Изменить</span></button>`}).join('');
 }
 function choose(status=null,open=true){
  editing=status?{...status}:null;
  $('status-name').value=status?.label||'';$('status-color').value=status?.color||'#597b68';$('status-symbol').value=status?.symbol||'';$('status-dimmed').checked=Boolean(status?.dimmed);
  $('status-form-title').textContent=status?'Изменить статус':'Новый статус';$('status-save').textContent=status?'Сохранить изменения':'Добавить статус';
  $('status-error').textContent='';expand(open);preview();renderList();
 }
 $('status-new').onclick=()=>{
  if(busy)return;
  if(!form.hidden&&!editing){expand(false);return}
  if(editing)choose();else expand(true);
  $('status-name').focus();
 };
 $('status-list').onclick=event=>{
  const button=event.target.closest('[data-edit-status]');if(!button||busy)return;
  const status=getData().statuses.find(s=>s.id===button.dataset.editStatus);if(status){choose(status);$('status-name').focus()}
 };
 $('close-status').onclick=()=>{if(!busy)$('status-dialog').close()};
 $('status-dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault()});
 form.oninput=preview;
 form.onsubmit=async event=>{
  event.preventDefault();if(busy||form.hidden)return;preview();if(!form.reportValidity())return;
  busy=true;$('status-error').textContent='';
  const payload={label:$('status-name').value,color:$('status-color').value,symbol:$('status-symbol').value.normalize('NFC'),dimmed:$('status-dimmed').checked,...(editing?{version:editing.version}:{})},wasEditing=Boolean(editing);
  const controls=$('status-dialog').querySelectorAll('button,input');controls.forEach(control=>control.disabled=true);
  let focusNew=false;
  try{
   const saved=await api('/api/statuses'+(editing?'/'+editing.id:''),{method:editing?'PUT':'POST',body:JSON.stringify(payload)});
   const data=getData();if(!data)return;
   const index=data.statuses.findIndex(s=>s.id===saved.id);if(index<0)data.statuses.push(saved);else data.statuses[index]=saved;
   onChange();choose(wasEditing?saved:null,wasEditing);focusNew=!wasEditing;toast(wasEditing?'Статус обновлён во всех местах.':'Новый статус добавлен.');
  }catch(error){
   $('status-error').textContent=error.message;
   if(error.status===409)try{const fresh=await api('/api/data');if(getData()){getData().statuses=fresh.statuses;onChange();renderList()}}catch{}
  }finally{busy=false;controls.forEach(control=>control.disabled=false);if(focusNew)$('status-new').focus({preventScroll:true})}
 };
 return {open(){if(!['admin','editor'].includes(getData()?.user.role))return;choose(null,false);$('status-dialog').showModal();$('statuses-title').focus({preventScroll:true})}};
}
