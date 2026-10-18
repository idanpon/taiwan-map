let nextId=0;
const installed=new WeakSet();
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
  button.setAttribute('aria-label','Показать пароль');button.setAttribute('aria-pressed','false');button.textContent='Показать';
  wrap.append(button);
 }
}
export function resetPasswordFields(root){
 for(const input of root.querySelectorAll('input[data-password-field]')){
  input.value='';input.type='password';input.setCustomValidity('');
  const button=input.parentElement.querySelector('[data-password-toggle]');
  button.textContent='Показать';button.setAttribute('aria-label','Показать пароль');button.setAttribute('aria-pressed','false');
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
  button.textContent=visible?'Скрыть':'Показать';button.setAttribute('aria-label',visible?'Скрыть пароль':'Показать пароль');button.setAttribute('aria-pressed',String(visible));
 });
 root.addEventListener('input',event=>{
  if(!['password','password_confirmation'].includes(event.target.name))return;
  event.target.form?.elements.namedItem('password_confirmation')?.setCustomValidity('');
 });
}
