import { createHash } from 'node:crypto';
import { TRIP, fail, Problem } from './auth.mjs';
import { all, one } from './sqlite.mjs';
import { itemById, currentPlace } from './planning-store.mjs';
const conflict = (message, details = {}) => {
  const error = new Problem(409, message);
  error.details = details;
  throw error;
};

export function computePreview(db, id, input) {
  const item = itemById(db, id);
  if (item.kind !== 'decision') fail(400, 'Это не решение.');
  const mode = input.mode || 'resolve';
  if (!['resolve', 'reopen'].includes(mode)) fail(400, 'Неизвестное действие.');
  if (
    (mode === 'resolve' && !['open', 'in_progress'].includes(item.state)) ||
    (mode === 'reopen' && item.state !== 'done')
  )
    conflict('Состояние решения изменилось. Обновите запись.');
  if (
    mode === 'resolve' &&
    !one(db, 'SELECT 1 FROM planning_options WHERE id=? AND item_id=?', input.option_id, id)
  )
    fail(400, 'Выберите вариант.');
  const overrides = input.alternatives ?? {};
  if (
    !overrides ||
    Array.isArray(overrides) ||
    typeof overrides !== 'object' ||
    Object.values(overrides).some((v) => !['keep', 'hide'].includes(v))
  )
    fail(400, 'Альтернативы можно только скрыть или оставить.');
  const links = all(db, 'SELECT * FROM planning_item_places WHERE item_id=?', id),
    effects = [],
    warnings = [],
    related = [];
  const latest =
    mode === 'reopen'
      ? one(
          db,
          "SELECT payload FROM planning_events WHERE item_id=? AND action='resolve' ORDER BY created_at DESC,rowid DESC LIMIT 1",
          id,
        )
      : null;
  const previousEffects = latest ? JSON.parse(latest.payload).effects : [];
  for (const placeId of [...new Set(links.map((l) => l.place_id).filter(Boolean))]) {
    const p = currentPlace(db, placeId);
    if (!p) continue;
    const references = all(
      db,
      `SELECT i.id,i.title,i.kind,i.state,i.selected_option_id,l.option_id,l.affects_visit FROM planning_item_places l JOIN planning_items i ON i.id=l.item_id WHERE l.place_id=? AND i.trip_id=?`,
      placeId,
      TRIP,
    );
    related.push({
      place_id: placeId,
      name: p.name,
      items: [
        ...new Map(
          references.map((r) => [r.id, { id: r.id, title: r.title, kind: r.kind, state: r.state }]),
        ).values(),
      ],
    });
    let targetStatus = p.status_id,
      targetHidden = p.hidden;
    if (mode === 'reopen') {
      const effect = previousEffects.find((e) => e.id === placeId);
      if (effect) {
        if (effect.after.status_id !== effect.before.status_id) {
          if (
            p.state_version === effect.after.state_version &&
            p.status_id === effect.after.status_id
          )
            targetStatus = effect.before.status_id;
          else warnings.push(p.name + ': статус менялся позднее; сохранён текущий.');
        }
        if (effect.after.hidden !== effect.before.hidden) {
          if (
            p.visibility_version === effect.after.visibility_version &&
            p.hidden === effect.after.hidden
          )
            targetHidden = effect.before.hidden;
          else warnings.push(p.name + ': видимость менялась позднее; сохранена текущая.');
        }
      }
      if (
        links.some((l) => l.place_id === placeId && l.affects_visit) &&
        ['want', null].includes(targetStatus)
      ) {
        const auto = one(
          db,
          `SELECT CAST(json_extract(effect.value,'$.after.state_version') AS INTEGER) version FROM planning_events ev,json_each(ev.payload,'$.effects') effect WHERE ev.trip_id=? AND json_extract(effect.value,'$.id')=? AND json_extract(effect.value,'$.after.status_id')='want' AND json_extract(effect.value,'$.before.status_id') IS NOT 'want' ORDER BY version DESC LIMIT 1`,
          TRIP,
          placeId,
        );
        const subsequent =
          auto &&
          one(
            db,
            "SELECT 1 FROM state_events WHERE place_id=? AND version>? AND status_id IS NOT 'want' LIMIT 1",
            placeId,
            auto.version,
          );
        if (targetStatus === null || (auto && !subsequent)) {
          if (one(db, "SELECT 1 FROM statuses WHERE id='maybe' AND trip_id=? AND archived=0", TRIP))
            targetStatus = 'maybe';
          else warnings.push(p.name + ': статус вопроса недоступен; текущий статус сохранён.');
        } else
          warnings.push(
            p.name +
              ': появился незакрытый выбор; позднейший ручной статус сохранён. Проверьте его при обсуждении решения.',
          );
      }
    } else {
      const affecting = references.filter(
        (r) => r.affects_visit && r.kind === 'decision' && r.state !== 'cancelled',
      );
      const pending = [
        ...new Map(
          affecting.filter((r) => r.id !== id && r.state !== 'done').map((r) => [r.id, r]),
        ).values(),
      ];
      const opinions = [
        ...new Set(affecting.filter((r) => r.id === id || r.state === 'done').map((r) => r.id)),
      ].map((decisionId) => {
        const rows = affecting.filter((r) => r.id === decisionId),
          selected = decisionId === id ? input.option_id : rows[0].selected_option_id;
        return rows.some((r) => r.option_id === selected);
      });
      const own = links.filter((l) => l.place_id === placeId && l.affects_visit),
        chosen = own.some((l) => l.option_id === input.option_id);
      if (pending.length)
        warnings.push(
          p.name + ': остаётся под вопросом — ' + pending.map((r) => r.title).join('; '),
        );
      else if (opinions.includes(true) && opinions.includes(false))
        warnings.push(
          p.name + ': результаты решений противоречат друг другу; статус и видимость сохранены.',
        );
      else if (own.length && chosen) {
        if (!p.status_id || ['maybe', 'want'].includes(p.status_id)) {
          if (one(db, "SELECT 1 FROM statuses WHERE id='want' AND trip_id=? AND archived=0", TRIP))
            targetStatus = 'want';
          else
            warnings.push(
              p.name + ': статус «Хотим посетить» недоступен; текущий статус сохранён.',
            );
        } else warnings.push(p.name + ': сохранён текущий пользовательский статус.');
        if (p.hidden)
          warnings.push(p.name + ': место уже скрыто; вернуть его можно в скрытых местах.');
      } else if (own.length && !chosen && !opinions.includes(true))
        targetHidden = (overrides[placeId] || own[0].unselected_action) === 'hide' ? 1 : p.hidden;
    }
    effects.push({
      id: placeId,
      name: p.name,
      before: {
        status_id: p.status_id,
        hidden: p.hidden,
        state_version: p.state_version,
        visibility_version: p.visibility_version,
      },
      after: {
        status_id: targetStatus,
        hidden: targetHidden,
        state_version: p.state_version + Number(targetStatus !== p.status_id),
        visibility_version: p.visibility_version + Number(targetHidden !== p.hidden),
      },
    });
  }
  for (const l of links.filter((l) => !l.place_id))
    warnings.push(l.place_name + ': место удалено и не будет восстановлено.');
  const snapshot = {
    item,
    items: all(
      db,
      'SELECT id,version,state,selected_option_id FROM planning_items WHERE trip_id=? ORDER BY id',
      TRIP,
    ),
    links: all(db, 'SELECT * FROM planning_item_places ORDER BY id'),
    statuses: all(db, 'SELECT id,version,archived FROM statuses WHERE trip_id=? ORDER BY id', TRIP),
    effects,
  };
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify({
        snapshot,
        mode,
        option_id: input.option_id || null,
        alternatives: overrides,
      }),
    )
    .digest('hex');
  const next_steps = all(
    db,
    'SELECT i.id,i.title,i.state FROM planning_items i JOIN planning_dependencies d ON d.item_id=i.id WHERE d.depends_on_id=? AND i.trip_id=? ORDER BY i.title',
    id,
    TRIP,
  );
  return {
    mode,
    item_id: id,
    next_steps,
    version: item.version,
    option_id: input.option_id || null,
    alternatives: overrides,
    effects,
    warnings,
    related,
    fingerprint,
  };
}
