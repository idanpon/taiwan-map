import { z } from 'zod';
import { Problem } from './auth.mjs';

export const id = z.string().regex(/^[a-zA-Z0-9-]{1,80}$/);
const reference = z.string().regex(/^\$?[a-zA-Z0-9-]{1,80}$/);
const url = z.string().max(2000).refine(value => {
  try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password; }
  catch { return false; }
}, 'Нужен HTTP/HTTPS URL без учётных данных.');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const interval = z.tuple([z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/), z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/)]);
const hours = z.object({
  timezone: z.string().max(100), label: z.string().max(1000), note: z.string().max(2000).optional(),
  weekly: z.array(z.object({day:z.number().int().min(0).max(6),intervals:z.array(interval).max(10)}).strict()).max(7),
  exceptions: z.array(z.object({date,intervals:z.array(interval).max(10),note:z.string().max(1000).optional()}).strict()).max(100),
  always:z.boolean().optional(), verified_at:date.optional(), source_url:url.optional(),
}).strict();
const links = z.array(z.object({label:z.string().min(1).max(160),url,kind:z.enum(['official','source','booking','other']).default('source')}).strict()).max(20);
export const placeFields = z.object({
  name:z.string().trim().min(1).max(200), local_name:z.string().max(200), city:z.string().trim().min(1).max(160),
  category_id:id, lat:z.number().finite().min(-90).max(90), lon:z.number().finite().min(-180).max(180),
  address:z.string().max(1000),summary:z.string().max(2000),tip:z.string().max(3000),
  hours, verified_at:z.union([date,z.literal('')]), coordinate_accuracy:z.string().trim().min(1).max(300),
  coordinate_source_url:url, links,
}).partial().strict();
const tags = z.object({
  photoSpot:z.boolean().optional(),
  limitedDates:z.object({enabled:z.boolean().optional(),startDate:z.string().max(10).optional(),endDate:z.string().max(10).optional(),scheduleText:z.string().max(2000).optional()}).strict().optional(),
  reservation:z.object({enabled:z.boolean().optional(),url:z.string().max(1024).optional()}).strict().optional(),
}).strict();
const option = z.object({id:id.optional(),label:z.string().min(1).max(160),description:z.string().max(5000).optional()}).strict();
const placeLink = z.object({place_id:reference.nullable().optional(),place_name:z.string().max(200).optional(),option_id:id.nullable().optional(),affects_visit:z.boolean().optional(),unselected_action:z.enum(['keep','hide']).optional()}).strict();
export const planFields = z.object({
  kind:z.enum(['task','visit','decision']),title:z.string().trim().min(1).max(160),description:z.string().max(10000),note:z.string().max(5000),
  state:z.enum(['open','in_progress','done','cancelled']),priority:z.enum(['low','normal','high','critical']),
  assignee_id:id.nullable(),date_start:date.nullable(),date_end:date.nullable(),starts_at:z.string().max(40).nullable(),ends_at:z.string().max(40).nullable(),
  event_timezone:z.string().max(100),sort_order:z.number().int(),fixed_external:z.boolean(),source_urls:z.array(url).max(20),
  options:z.array(option).max(20),places:z.array(placeLink).max(200),dependencies:z.array(reference).max(100),ack_dependencies:z.boolean(),timezone_revision:z.number().int(),
}).partial().strict();
const base={key:id, reason:z.string().trim().min(1).max(1000)};
export const operationSchema=z.discriminatedUnion('kind',[
  z.object({...base,kind:z.literal('place.create'),data:placeFields,hidden:z.boolean().default(false)}).strict(),
  z.object({...base,kind:z.literal('place.update'),id,version:z.number().int().min(1),data:placeFields}).strict(),
  z.object({...base,kind:z.literal('place.state'),id:reference,version:z.number().int().min(0),data:z.object({status_id:id.nullable().optional(),note:z.string().max(2000).optional()}).strict()}).strict(),
  z.object({...base,kind:z.literal('place.tags'),id:reference,version:z.number().int().min(1),data:tags}).strict(),
  z.object({...base,kind:z.literal('place.visibility'),id:reference,version:z.number().int().min(1),hidden:z.boolean()}).strict(),
  z.object({...base,kind:z.literal('plan.create'),data:planFields}).strict(),
  z.object({...base,kind:z.literal('plan.update'),id,version:z.number().int().min(1),data:planFields}).strict(),
  z.object({...base,kind:z.literal('decision.resolve'),id,version:z.number().int().min(1),data:z.object({mode:z.enum(['resolve','reopen']).default('resolve'),option_id:id.nullable().optional(),alternatives:z.record(id,z.enum(['keep','hide'])).optional()}).strict()}).strict(),
]);
export const proposalSchema=z.object({
  id:z.string().uuid().describe('Stable client-generated UUID. Reuse this ID for retries.'),
  version:z.number().int().min(1).optional(),
  title:z.string().trim().min(1).max(160),
  operations:z.array(operationSchema).min(1).max(30),
  uncertainties:z.array(z.string().max(1000)).max(20).default([]),
}).strict();
export function parse(schema,value){
  const result=schema.safeParse(value);
  if(!result.success)throw new Problem(400,result.error.issues.map(i=>`${i.path.join('.')}: ${i.message}`).slice(0,8).join('; '));
  return result.data;
}
