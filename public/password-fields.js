let nextId=0;
const installed=new WeakSet();
const eye='<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>';
const eyeOff='<path d="m3 3 18 18M10.6 5.1A12 12 0 0 1 12 5c6.5 0 10 7 10 7a19 19 0 0 1-3 3.9M6.3 6.3A22 22 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5.7-1.7M9.9 9.9a3 3 0 0 0 4.2 4.2"/>';
function updateToggle(button,visible){
 const label=visible?'Скрыть пароль':'Показать пароль';
 button.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'+(visible?eyeOff:eye)+'</svg>';
 button.setAttribute('aria-label',label);button.title=label;button.setAttribute('aria-pressed',String(visible));
}
export function enhancePasswordFields(root){
 for(const input of root.querySelectorAll('input[type="password"]')){
  if(input.dataset.passwordField)continue;
  input.dataset.passwordField='true';
  if(!input.id)input.id='account-password-'+(++nextId);
  const wrap=input.ownerDocument.createElement('span');wrap.className='password-input';
  const label=input.parentElement.tagName==='LABEL'?input.parentElement:null;
  if(label){label.htmlFor=input.id;label.after(wrap)}else input.before(wrap);
  wrap.append(input);
  const button=input.ownerDocument.createElement('button');button.type='button';button.className='password-toggle';
  button.dataset.passwordToggle='true';button.setAttribute('aria-controls',input.id);
  updateToggle(button,false);
  wrap.append(button);
 }
}
export function resetPasswordFields(root){
 for(const input of root.querySelectorAll('input[data-password-field]')){
  input.value='';input.type='password';input.setCustomValidity('');
  const button=input.parentElement.querySelector('[data-password-toggle]');
  updateToggle(button,false);
 }
}
export function confirmPassword(form){
 const confirmation=form.elements.namedItem('password_confirmation');
 if(!confirmation)return true;
 const matches=form.elements.namedItem('password').value===confirmation.value;
 confirmation.setCustomValidity(matches?'':'Пароли не совпадают.');
 if(!matches)confirmation.reportValidity();
 return matches;
}
export function installPasswordFields(root){
 enhancePasswordFields(root);
 if(installed.has(root))return;installed.add(root);
 root.addEventListener('click',event=>{
  const button=event.target.closest('[data-password-toggle]');if(!button)return;
  event.preventDefault();
  const input=button.ownerDocument.getElementById(button.getAttribute('aria-controls'));
  const start=input.selectionStart,end=input.selectionEnd,visible=input.type==='password';
  input.type=visible?'text':'password';
  if(start!==null&&end!==null)input.setSelectionRange(start,end);
  updateToggle(button,visible);
 });
 root.addEventListener('input',event=>{
  if(!['password','password_confirmation'].includes(event.target.name))return;
  event.target.form?.elements.namedItem('password_confirmation')?.setCustomValidity('');
 });
}
