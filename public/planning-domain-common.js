export class PlanningDomainError extends Error {
  constructor(code, message, status = 422) { super(message); this.code = code; this.status = status; }
}
export const invalid = (code, message, status) => { throw new PlanningDomainError(code, message, status); };
export const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function closed(value, keys) {
  if (!object(value) || Object.keys(value).some(k => !keys.includes(k)))
    invalid('INVALID_COMMAND', 'Неизвестное поле или неверная структура команды.', 400);
}
export function validId(id) { return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id); }
export function reference(value, ids, entity) {
  if (object(value)) {
    closed(value, ['command', 'entity', 'part']);
    if(value.part!==undefined&&(entity!=='service'||!Number.isSafeInteger(value.part)||value.part<0||value.part>=50))invalid('INVALID_REFERENCE','Неверный номер части услуги.');
    const key=value.part===undefined?entity:'service_'+value.part;
    if (value.entity !== entity || !Object.hasOwn(ids,value.command) || !ids[value.command]?.[key])
      invalid('INVALID_REFERENCE', 'Ссылка на команду не найдена или имеет другой тип.');
    return ids[value.command][key];
  }
  if (!validId(value)) invalid('INVALID_REFERENCE', 'Укажите ID записи или типизированную ссылку.');
  return value;
}
export function checkVersion(row, command) {
  if (!row || row.archived_at != null) invalid('TARGET_UNAVAILABLE', 'Связанная запись недоступна.', 404);
  if (row.version !== command.expected_version) invalid('VERSION_CONFLICT', 'Запись изменена. Обновите предварительный просмотр.', 409);
}
export function textField(value, name, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    invalid('INVALID_TEXT', 'Проверьте поле «' + name + '».');
}
export function validateIdentity(item, sources) {
  textField(item.title, 'Название', 300, true);
  textField(item.description, 'Описание', 10000); textField(item.note, 'Заметка', 5000);
  if (!['low', 'normal', 'high', 'critical'].includes(item.priority)) invalid('INVALID_PRIORITY', 'Неизвестный приоритет.');
  if (item.assignee_id !== null && !sources.users.some(u => u.id === item.assignee_id && !u.disabled))
    invalid('INVALID_ASSIGNEE', 'Ответственный недоступен.');
}
export const zoneValid = value => {
  try { return typeof value === 'string' && Boolean(new Intl.DateTimeFormat('en', { timeZone: value }).format()); } catch { return false; }
};
