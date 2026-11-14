import { body, json } from './auth.mjs';
import { readModel3, evaluatePlanning, createChangeset, getChangeset, updateChangeset, previewChangeset, applyChangeset, applyMetadataCommands } from './planning-command-service.mjs';
import { bookingRegistry } from './planning-bookings.mjs';

export async function handlePlanningDomain(request,db,user){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if(path==='/api/bookings'&&method==='GET')return json(bookingRegistry(db,user));
  const booking=path.match(/^\/api\/bookings\/([a-zA-Z0-9_-]+)(?:\/(events))?$/);
  if(booking&&method==='GET')return json(bookingRegistry(db,user,booking[1],{history:Boolean(booking[2])}));
  if(path==='/api/preparation'&&method==='GET'){
    const model=readModel3(db,user);
    return json({schema_version:3,revision:model.revision,tasks:model.derived.tasks,needs:model.derived.needs,deadlines:model.derived.deadlines});
  }
  if(path==='/api/planning'&&method==='GET'&&url.searchParams.get('model')==='3')return json(readModel3(db,user));
  if(path==='/api/planning/evaluate'&&method==='POST')return json(evaluatePlanning(db,user,await body(request,65536)));
  if(path==='/api/planning/commands'&&method==='POST')return json(applyMetadataCommands(db,user,await body(request,65536)));
  if(path==='/api/planning/changesets'&&method==='POST')return json(createChangeset(db,user,await body(request,65536)),201);
  const match=path.match(/^\/api\/planning\/changesets\/([a-zA-Z0-9-]+)(?:\/(preview|apply))?$/);
  if(!match)return null;
  if(!match[2]&&method==='GET')return json(getChangeset(db,user,match[1]));
  if(!match[2]&&method==='PUT')return json(updateChangeset(db,user,match[1],await body(request,65536)));
  if(match[2]&&method==='POST')return json((match[2]==='preview'?previewChangeset:applyChangeset)(db,user,match[1],await body(request,65536)));
  return null;
}
