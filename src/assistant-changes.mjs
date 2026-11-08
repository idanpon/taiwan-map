import { TRIP, SHARED_USER, fail } from './auth.mjs';
import { all, one, run } from './sqlite.mjs';
import { readTags, mergeTags } from '../public/place-tags.js';
import { validDate, validZone } from '../public/planning-model.js';
import { applyPlanningChange } from './planning.mjs';
import { guardPlanningStatus } from './planning-store.mjs';
import { computePreview } from './planning-decisions.mjs';

export function assertActor(db,user,write=false){
  const actor=one(db,'SELECT u.id,u.display_name,m.role FROM users u JOIN memberships m ON m.user_id=u.id WHERE u.id=? AND m.trip_id=? AND u.disabled=0',user?.id||'',TRIP);
  if(!actor)fail(401,'Войдите в действующий аккаунт карты.');
  if(write&&!['owner','admin','editor'].includes(actor.role))fail(403,'Доступ только для просмотра.');
  // The assistant always works with the shared trip, never a legacy private state.
  if(one(db,"SELECT value FROM app_meta WHERE key='accounts_v1'")?.value!=='shared')fail(409,'Сначала завершите настройку общих аккаунтов карты.');
  return actor;
}
export function readPlaces(db){
  return all(db,`SELECT p.*,COALESCE(s.version,0) state_version,s.status_id,COALESCE(s.note,'') note FROM places p LEFT JOIN user_place_states s ON s.place_id=p.id AND s.user_id=? WHERE p.trip_id=? ORDER BY p.id`,SHARED_USER,TRIP).map(({hours_json,tags_json,...p})=>({...p,hidden:Boolean(p.hidden),hours:JSON.parse(hours_json),tags:readTags(tags_json),links:all(db,'SELECT label,url,kind FROM place_links WHERE place_id=? ORDER BY url,label',p.id)}));
}
function place(db,id){const p=readPlaces(db).find(p=>p.id===id);if(!p)fail(404,'Место удалено или не найдено.');return p;}
const checkVersion=(actual,expected)=>{if(actual!==expected)fail(409,'Запись изменена. Прочитайте актуальные данные и подготовьте новое предложение.');};
function checkHours(h){
  if(!validZone(h.timezone))fail(400,'Проверьте часовой пояс часов работы.');
  if(new Set(h.weekly.map(d=>d.day)).size!==h.weekly.length)fail(400,'Дни расписания повторяются.');
  if(new Set(h.exceptions.map(d=>d.date)).size!==h.exceptions.length)fail(400,'Даты исключений повторяются.');
  for(const entry of [...h.weekly,...h.exceptions]){
    if(entry.date&&!validDate(entry.date))fail(400,'Некорректная дата расписания.');
    let end='';for(const [a,b] of entry.intervals){if(a>=b||a<end)fail(400,'Интервалы часов работы пересекаются или расположены неверно.');end=b;}
  }
  if((h.weekly.length||h.exceptions.length||h.always)&&(!h.source_url||!h.verified_at))fail(400,'Для часов работы нужны источник и дата проверки.');
  if(h.verified_at&&(!validDate(h.verified_at)||h.verified_at>new Date().toISOString().slice(0,10)))fail(400,'Некорректная дата проверки часов.');
}
function catalog(db,user,op,id){
  const create=op.kind==='place.create',old=create?null:place(db,id),d=op.data;
  if(old)checkVersion(old.catalog_version,op.version);
  const defaults={local_name:'',address:'',summary:'',tip:'',verified_at:'',hours:{timezone:'Asia/Taipei',label:'Не уточнено',weekly:[],exceptions:[]},links:[]};
  const value={...defaults,...old,...d};
  for(const key of ['name','city','category_id','lat','lon'])if(value[key]===undefined||value[key]===null||value[key]==='')fail(400,`Не заполнено поле ${key}. Сохраните черновик и уточните данные.`);
  if(!one(db,'SELECT id FROM categories WHERE id=?',value.category_id))fail(400,'Категория не найдена.');
  if(create||Object.hasOwn(d,'lat')||Object.hasOwn(d,'lon')){
    if(!d.coordinate_accuracy||!d.coordinate_source_url)fail(400,'Для новых координат укажите источник и честное описание точности.');
  }
  if(value.verified_at&&(!validDate(value.verified_at)||value.verified_at>new Date().toISOString().slice(0,10)))fail(400,'Некорректная дата проверки.');
  if(create||Object.hasOwn(d,'hours'))checkHours(value.hours);
  if(create){
    const normalized=s=>s.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
    const duplicate=readPlaces(db).find(p=>normalized(p.name)===normalized(value.name)&&normalized(p.city)===normalized(value.city)&&Math.hypot(p.lat-value.lat,p.lon-value.lon)<0.001);
    if(duplicate)fail(409,`Возможно, место уже существует: ${duplicate.name} (${duplicate.id}). Используйте обновление либо уточните название и филиал.`);
  }
  const fields=['name','local_name','city','category_id','lat','lon','address','summary','tip','verified_at','coordinate_accuracy','coordinate_source_url'];
  const vals=fields.map(f=>value[f]);
  if(create)run(db,`INSERT INTO places(id,trip_id,${fields.join(',')},hours_json,hidden,updated_at) VALUES(${Array(fields.length+5).fill('?').join(',')})`,id,TRIP,...vals,JSON.stringify(value.hours),Number(op.hidden),Date.now());
  else run(db,`UPDATE places SET ${fields.map(f=>f+'=?').join(',')},hours_json=?,catalog_version=catalog_version+1,updated_at=? WHERE id=?`,...vals,JSON.stringify(value.hours),Date.now(),id);
  if(create||Object.hasOwn(d,'links')){
    run(db,'DELETE FROM place_links WHERE place_id=?',id);
    for(const l of value.links)run(db,'INSERT INTO place_links VALUES(?,?,?,?,?)',crypto.randomUUID(),id,l.label,l.url,l.kind);
  }
}
export function applyOperations(db,user,payload){
  user=assertActor(db,user,true);
  const resolve=id=>id?.startsWith('$')?payload.ids[id.slice(1)]||fail(400,'Неизвестная ссылка внутри пакета.'):id;
  const warnings=[];
  for(const op of payload.operations){
    const id=op.id?resolve(op.id):payload.ids[op.key];
    if(['place.create','place.update'].includes(op.kind)){catalog(db,user,op,id);continue;}
    if(op.kind.startsWith('place.')){
      const p=place(db,id);
      if(op.kind==='place.state'){
        checkVersion(p.state_version,op.version);
        const status=Object.hasOwn(op.data,'status_id')?op.data.status_id:p.status_id;
        const note=op.data.note??p.note;
        if(status!==null&&!one(db,'SELECT 1 FROM statuses WHERE id=? AND trip_id=? AND archived=0',status,TRIP))fail(400,'Статус недоступен.');
        guardPlanningStatus(db,id,status,SHARED_USER);
        run(db,'INSERT INTO user_place_states(user_id,place_id,status_id,note,version,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,place_id) DO UPDATE SET status_id=excluded.status_id,note=excluded.note,version=excluded.version,updated_at=excluded.updated_at',SHARED_USER,id,status,note,p.state_version+1,Date.now());
        run(db,'INSERT INTO state_events VALUES(?,?,?,?,?,?,?)',crypto.randomUUID(),user.id,id,status,note,p.state_version+1,Date.now());
      }else if(op.kind==='place.tags'){
        checkVersion(p.tags_version,op.version);let tags;
        try{tags=mergeTags(p.tags,op.data);}catch(e){fail(400,e.message);}
        run(db,'UPDATE places SET tags_json=?,tags_version=tags_version+1,updated_at=? WHERE id=?',JSON.stringify(tags),Date.now(),id);
      }else{
        checkVersion(p.visibility_version,op.version);
        run(db,'UPDATE places SET hidden=?,visibility_version=visibility_version+1,updated_at=? WHERE id=?',Number(op.hidden),Date.now(),id);
      }
    }else if(op.kind==='decision.resolve'){
      const preview=computePreview(db,id,op.data);
      checkVersion(preview.version,op.version);
      warnings.push(...preview.warnings);
      applyPlanningChange(db,user,{path:`/api/planning/items/${id}/resolve`,method:'POST',body:preview});
    }else{
      const data=structuredClone(op.data);
      if(data.places)data.places=data.places.map(l=>({...l,place_id:resolve(l.place_id)}));
      if(data.dependencies)data.dependencies=data.dependencies.map(resolve);
      applyPlanningChange(db,user,{path:'/api/planning/items'+(op.kind==='plan.update'?'/'+id:''),method:op.kind==='plan.create'?'POST':'PUT',creationId:id,body:{...data,...(op.kind==='plan.update'?{version:op.version}:{})}});
    }
  }
  return warnings;
}
