export function cityOptions(places){
 const counts=new Map();
 for(const {city} of places)if(typeof city==='string'&&city.trim())counts.set(city,(counts.get(city)||0)+1);
 return [...counts].sort(([a],[b])=>a.localeCompare(b,'ru')).map(([name,count])=>({name,count}));
}
function verifiedDate(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;
 const date=new Date(value+'T12:00:00Z');return !Number.isNaN(date.valueOf())&&date.toISOString().slice(0,10)===value?date:null;
}
export function hoursVerification(value){
 const date=verifiedDate(value);
 return date?'Часы проверены '+date.toLocaleDateString('ru-RU',{timeZone:'UTC'})+'. В праздники возможны изменения.':'Часы работы ещё не проверены.';
}
export function hoursOverview(places){
 const verified=places.filter(p=>verifiedDate(p.verified_at));
 if(verified.length!==places.length)return `Часы проверены у ${verified.length} из ${places.length} мест`;
 const dates=[...new Set(verified.map(p=>p.verified_at))];
 return dates.length===1?'Часы проверены '+verifiedDate(dates[0]).toLocaleDateString('ru-RU',{timeZone:'UTC'}):'Часы работы: см. карточки мест';
}
export function validStatusSymbol(value){
 return typeof value==='string'&&(value===''||(/^[\p{L}\p{N}\p{P}\p{S}]$/u.test(value)&&!/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}\p{Default_Ignorable_Code_Point}\u2800]/u.test(value)));
}
function luminance(color){
 const channels=color.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
 return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
}
export function statusAppearance(status,theme='light'){
 const color=/^#[0-9a-f]{6}$/i.test(status.color)?status.color:'#697568',light=luminance(color);
 return {...status,dimmed:Boolean(status.dimmed),opacity:status.dimmed?0.7:1,color,symbol:status.symbol||'',symbolColor:(light+.05)/.05>1.05/(light+.05)?'#000000':'#ffffff',textColor:theme==='dark'?((light+.05)/(luminance('#202d3b')+.05)>=4.5?color:'#dce7ef'):((luminance('#ffffff')+.05)/(light+.05)>=4.5?color:'#354539')};
}
