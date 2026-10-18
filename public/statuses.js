import {validStatusSymbol,statusAppearance} from './map-model.js';
export function createStatusUI({api,$,esc,getData,onChange,toast}){
 let editing=null,busy=false;
 const form=$('status-form');
 function preview(){
  const symbol=$('status-symbol').value.normalize('NFC'),valid=validStatusSymbol(symbol);
  $('status-symbol').setCustomValidity(valid?'':'Введите один текстовый знак без emoji или оставьте поле пустым.');
  const status=statusAppearance({color:$('status-color').value,symbol:valid?symbol:''});
  $('status-preview-circle').textContent=status.symbol;$('status-preview-circle').style.backgroundColor=status.color;$('status-preview-circle').style.color=status.symbolColor;
  $('status-preview-label').textContent=$('status-name').value.trim()||'Ваш статус';
 }
 function renderList(){
  $('status-list').innerHTML=getData().statuses.map(s=>{const view=statusAppearance(s);return `<button type="button" class="status-option" data-edit-status="${esc(s.id)}" aria-label="Изменить статус «${esc(s.label)}»" aria-pressed="${editing?.id===s.id}"><span class="status-preview-circle" style="background:${view.color};color:${view.symbolColor}" aria-hidden="true">${esc(view.symbol)}</span><span>${esc(s.label)}</span><span class="status-edit-label">Изменить</span></button>`}).join('');
 }
 function choose(status=null){
  editing=status?{...status}:null;
  $('status-name').value=status?.label||'';$('status-color').value=status?.color||'#597b68';$('status-symbol').value=status?.symbol||'';
  $('status-form-title').textContent=status?'Изменить статус':'Новый статус';$('status-save').textContent=status?'Сохранить изменения':'Добавить статус';
  $('status-error').textContent='';preview();renderList();
 }
 $('status-new').onclick=()=>{if(!busy){choose();$('status-name').focus()}};
 $('status-list').onclick=event=>{
  const button=event.target.closest('[data-edit-status]');if(!button||busy)return;
  const status=getData().statuses.find(s=>s.id===button.dataset.editStatus);if(status){choose(status);$('status-name').focus()}
 };
 $('close-status').onclick=()=>{if(!busy)$('status-dialog').close()};
 $('status-dialog').addEventListener('cancel',event=>{if(busy)event.preventDefault()});
 form.oninput=preview;
 form.onsubmit=async event=>{
  event.preventDefault();if(busy)return;preview();if(!form.reportValidity())return;
  busy=true;$('status-error').textContent='';
  const payload={label:$('status-name').value,color:$('status-color').value,symbol:$('status-symbol').value.normalize('NFC'),...(editing?{version:editing.version}:{})},wasEditing=Boolean(editing);
  const controls=$('status-dialog').querySelectorAll('button,input');controls.forEach(control=>control.disabled=true);
  try{
   const saved=await api('/api/statuses'+(editing?'/'+editing.id:''),{method:editing?'PUT':'POST',body:JSON.stringify(payload)});
   const data=getData();if(!data)return;
   const index=data.statuses.findIndex(s=>s.id===saved.id);if(index<0)data.statuses.push(saved);else data.statuses[index]=saved;
   onChange();choose(wasEditing?saved:null);toast(wasEditing?'Статус обновлён во всех местах.':'Новый статус добавлен.');
  }catch(error){
   $('status-error').textContent=error.message;
   if(error.status===409)try{const fresh=await api('/api/data');if(getData()){getData().statuses=fresh.statuses;onChange();renderList()}}catch{}
  }finally{busy=false;controls.forEach(control=>control.disabled=false)}
 };
 return {open(){if(!['admin','editor'].includes(getData()?.user.role))return;choose();$('status-dialog').showModal();$('status-name').focus()}};
}
