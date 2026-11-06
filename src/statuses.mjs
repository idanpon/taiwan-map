import { TRIP, stmt, body, fail, json } from './auth.mjs';
import { validStatusSymbol } from '../public/map-model.js';

export async function handleStatuses(request, db, user) {
  const path = new URL(request.url).pathname;
  const statusMatch = path.match(/^\/api\/statuses\/([a-zA-Z0-9-]+)$/);
  if (
    (path === '/api/statuses' && request.method === 'POST') ||
    (statusMatch && request.method === 'PUT')
  ) {
    if (!['owner', 'admin', 'editor'].includes(user.role)) fail(403, 'Нужны права редактирования.');
    const b = await body(request),
      label = typeof b.label === 'string' ? b.label.trim() : '',
      symbol =
        typeof b.symbol === 'string'
          ? b.symbol.normalize('NFC')
          : b.symbol === undefined
            ? ''
            : b.symbol;
    if (
      !label ||
      label.length > 40 ||
      typeof b.color !== 'string' ||
      !/^#[0-9a-f]{6}$/i.test(b.color)
    )
      fail(400, 'Название: 1–40 символов; цвет: #RRGGBB.');
    if (!validStatusSymbol(symbol))
      fail(
        400,
        'Символ: одна буква, цифра или текстовый знак, либо пустое поле. Emoji, пробелы и невидимые знаки не поддерживаются.',
      );
    if (b.dimmed !== undefined && typeof b.dimmed !== 'boolean')
      fail(400, 'Некорректная настройка полупрозрачности.');
    if (statusMatch) {
      if (!Number.isSafeInteger(b.version) || b.version < 1)
        fail(400, 'Некорректная версия статуса.');
      const current = await stmt(
        db,
        'SELECT id,sort_order,dimmed FROM statuses WHERE id=? AND trip_id=? AND archived=0',
        statusMatch[1],
        TRIP,
      ).first();
      if (!current) fail(404, 'Статус не найден.');
      const dimmed = b.dimmed === undefined ? current.dimmed : Number(b.dimmed);
      const updated = await stmt(
        db,
        `UPDATE statuses SET label=?,color=?,symbol=?,dimmed=?,version=version+1 WHERE id=? AND trip_id=? AND archived=0 AND version=? AND NOT EXISTS (SELECT 1 FROM statuses WHERE trip_id=? AND label=? AND archived=0 AND id<>?)`,
        label,
        b.color,
        symbol,
        dimmed,
        current.id,
        TRIP,
        b.version,
        TRIP,
        label,
        current.id,
      ).run();
      if (!updated.meta.changes)
        fail(
          409,
          'Статус уже изменён или такое название занято. Выберите статус в списке заново и повторите изменения.',
        );
      return json({
        id: current.id,
        label,
        color: b.color,
        symbol,
        dimmed: Boolean(dimmed),
        version: b.version + 1,
        sort_order: current.sort_order,
      });
    }
    const id = crypto.randomUUID(),
      sort_order = Date.now(),
      dimmed = Number(b.dimmed ?? false);
    const created = await stmt(
      db,
      `INSERT INTO statuses(id,trip_id,label,color,symbol,dimmed,sort_order,created_by) SELECT ?,?,?,?,?,?,?,? WHERE (SELECT COUNT(*) FROM statuses WHERE trip_id=? AND archived=0)<100 AND NOT EXISTS (SELECT 1 FROM statuses WHERE trip_id=? AND label=? AND archived=0)`,
      id,
      TRIP,
      label,
      b.color,
      symbol,
      dimmed,
      sort_order,
      user.id,
      TRIP,
      TRIP,
      label,
    ).run();
    if (!created.meta.changes) fail(409, 'Такой статус уже есть или достигнут лимит 100 статусов.');
    return json(
      { id, label, color: b.color, symbol, dimmed: Boolean(dimmed), version: 1, sort_order },
      201,
    );
  }
  return null;
}
