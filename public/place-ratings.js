// Lucide star, see vendor/lucide-LICENSE.txt.
const star='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>';
const averageFormat=new Intl.NumberFormat('ru',{maximumFractionDigits:1});
const pathFor=place=>'/api/places/'+encodeURIComponent(place.id)+'/ratings';

function node(tag,className='',text=''){
 const element=document.createElement(tag);
 element.className=className;
 element.textContent=text;
 return element;
}

function stars(onPick){
 const element=node('div','place-rating-stars');
 element.setAttribute('role','group');
 element.setAttribute('aria-label','Ваша оценка');
 const buttons=Array.from({length:5},(_,index)=>{
  const score=index+1,button=node('button','ui-button ui-button--quiet ui-button--icon place-rating-star');
  button.type='button';
  button.setAttribute('aria-label',score+' из 5 звёзд');
  button.innerHTML=star;
  button.onclick=()=>onPick(score);
  element.append(button);
  return button;
 });
 function update(rating){
  buttons.forEach((button,index)=>{
   button.setAttribute('aria-pressed',String(rating===index+1));
   button.toggleAttribute('data-filled',rating>=index+1);
  });
 }
 update(null);
 return {element,update};
}

function errorMessage(){
 const error=node('div','ui-error');
 error.setAttribute('role','alert');
 return error;
}

export function createPlaceRatings({api,notice}){
 const saving=new Set();
 let card;

 async function save(place,rating){
  if(saving.has(place.id))throw new Error('Дождитесь сохранения оценки.');
  saving.add(place.id);
  try{
   const result=await api(pathFor(place),{method:'PUT',body:JSON.stringify({rating})});
   Object.assign(place,result);
   if(card?.place===place&&card.root.isConnected){
    card.refresh();
    if(card.details.open)void card.loadAuthors();
   }
  }finally{saving.delete(place.id)}
 }

 function offer(places,{warning}={}){
  const candidates=places.filter(place=>place.my_rating===null);
  if(!candidates.length)return false;

  function show(index){
   const place=candidates[index],content=node('div','place-rating-prompt'),error=errorMessage();
   if(index===0&&warning)error.textContent=warning;
   let shown;
   const input=stars(async rating=>{
    if(!shown.active||saving.has(place.id))return;
    error.textContent='';
    shown.setWaiting(true);
    input.element.setAttribute('aria-busy','true');
    try{
     await save(place,rating);
     if(!shown.active)return;
     if(index+1<candidates.length)show(index+1);
     else shown.dismiss();
    }catch(problem){error.textContent=problem.message}
    finally{
     input.element.removeAttribute('aria-busy');
     shown.setWaiting(false);
    }
   });
   content.append(input.element,error);
   const progress=candidates.length>1?(index+1)+' из '+candidates.length+' · ':'';
   shown=notice.show(progress+'Оценить «'+place.name+'»',{content,tone:index===0&&warning?'warning':'neutral'});
  }

  show(0);
  return true;
 }

 function mountCard(root,place){
  const summary=node('div','place-rating-summary');
  summary.setAttribute('role','status');
  root.append(summary);

  const canRate=Object.hasOwn(place,'my_rating');
  const personal=node('div','place-rating-personal');
  const details=node('details','place-rating-details');
  const authors=node('div','place-rating-authors');
  const error=errorMessage();
  const remove=node('button','ui-button ui-button--quiet ui-button--compact','Убрать мою оценку');
  remove.type='button';
  remove.onclick=()=>change(null);
  const input=stars(change);
  let request;

  async function change(rating){
   if(saving.has(place.id))return;
   error.textContent='';
   personal.setAttribute('aria-busy','true');
   try{await save(place,rating)}
   catch(problem){error.textContent=problem.message}
   finally{personal.removeAttribute('aria-busy')}
  }

  async function loadAuthors(){
   request?.abort();
   request=new AbortController();
   const {signal}=request;
   authors.textContent='Загрузка…';
   try{
    const {ratings}=await api(pathFor(place),{signal});
    if(signal.aborted||!root.isConnected)return;
    if(!ratings.length){authors.textContent='Оценок пока нет.';return}
    const list=node('ul');
    for(const rating of ratings)list.append(node('li','',rating.name+' · '+rating.rating+' из 5'));
    authors.replaceChildren(list);
   }catch(problem){if(!signal.aborted)authors.textContent=problem.message}
  }

  if(canRate){
   personal.append(node('div','','Ваша оценка'),input.element,remove,error);
   details.append(node('summary','','Оценки участников'),authors);
   details.addEventListener('toggle',()=>{
    if(details.open)void loadAuthors();
    else request?.abort();
   });
   root.append(personal,details);
  }

  function refresh(){
   root.hidden=place.average_rating===undefined||
    (place.average_rating===null&&place.status_id!=='visited');
   summary.textContent=place.average_rating==null?'Оценок пока нет.':
    'Средняя оценка '+averageFormat.format(place.average_rating)+' из 5';
   personal.hidden=place.status_id!=='visited'&&place.my_rating==null;
   input.update(place.my_rating);
   remove.hidden=place.my_rating==null;
  }

  card={root,place,details,refresh,loadAuthors};
  refresh();
 }

 return {offer,mountCard,refreshCard(place){if(card?.place===place)card.refresh()}};
}
