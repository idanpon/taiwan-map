export function cityOptions(places){
 const counts=new Map();
 for(const {city} of places)if(typeof city==='string'&&city.trim())counts.set(city,(counts.get(city)||0)+1);
 return [...counts].sort(([a],[b])=>a.localeCompare(b,'ru')).map(([name,count])=>({name,count}));
}
export function validStatusSymbol(value){
 return typeof value==='string'&&(value===''||(/^[\p{L}\p{N}\p{P}\p{S}]$/u.test(value)&&!/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Regional_Indicator}\p{Default_Ignorable_Code_Point}\u2800]/u.test(value)));
}
function luminance(color){
 const channels=color.slice(1).match(/../g).map(x=>parseInt(x,16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);
 return channels[0]*.2126+channels[1]*.7152+channels[2]*.0722;
}
export function statusAppearance(status){
 const color=/^#[0-9a-f]{6}$/i.test(status.color)?status.color:'#697568',light=luminance(color);
 return {...status,dimmed:Boolean(status.dimmed),opacity:status.dimmed?0.7:1,color,symbol:status.symbol||'',symbolColor:(light+.05)/.05>1.05/(light+.05)?'#000000':'#ffffff',textColor:(luminance('#f7f7f2')+.05)/(light+.05)>=3?color:'#354539'};
}
