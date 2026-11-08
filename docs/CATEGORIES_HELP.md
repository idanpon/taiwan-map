# Категории, дополнительные ярлыки и справка

`public/categories.js` — общие определения десяти категорий: ID, название,
цвет по умолчанию, идентификатор и контур Lucide, короткое пояснение.
Конфигурация используется начальным каталогом, импортом, фильтрами, маркерами
и справкой. Контуры сохранены локально; лицензия —
`public/vendor/lucide-LICENSE.txt`. Новые места должны ссылаться на один из
этих ID; отдельного публичного редактора мест нет.

Миграция `0004_place_categories.sql` переносит `cafe` в `food`, удаляет только
освободившуюся категорию `cafe`, обновляет названия/иконки и добавляет новые
категории. Цвета существующих категорий сохраняются; после объединения кафе
получают общий цвет еды. Другие поля мест, ссылки, записи состояний, история,
сессии и параметры статусов не меняются. Неизвестные старые категории не
удаляются автоматически. В проверенной рабочей базе были только шесть
известных категорий; после перехода их ровно десять.

Пустую базу миграция не заполняет: это сохраняет импорт в новый экземпляр.
Начальное заполнение создаёт десять категорий, а импорт старых экспортов
нормализует прежние ID и названия (`cafe`, `coffee`, «Кофе», «Кафе»,
«Рестораны», «Еда», «Искусство и музеи»). Неизвестный тип места при импорте
вызывает откат импорта вместо пропуска точки.

Кнопка «Справка» в шапке приложения открывает нативный dialog. Легенда
категорий строится из текущих данных API; описания типов берутся из общей
конфигурации. Статусы объясняются в общем виде, без перечня текущих названий
и оформления: их переименование не меняет справку. Удаление определений
статусов пока не реализовано; справка его не обещает. Инструкции
учитывают права пользователя; все текстовые разделы имеют одинаковую ширину.
Справка поясняет добавление мест через управляющий аккаунт ChatGPT и
[личный плагин](CHATGPT_PLUGIN.md): предпросмотр, подтверждение, частные
черновики и проверку результата. Ссылка `assistant.html` ведёт к предложениям
и отзыву подключения; до включения плагина владельцем функция недоступна.
Форму регистрации или свободного создания мест справка не добавляет.

Закрытие: ×, Escape, нажатие вне окна. Заголовок с × закреплён при прокрутке.
На узком экране легенда становится одноколоночной. Категории остаются
кнопками-капсулами с переносом; область фильтров на компьютере прокручивается
отдельно, чтобы оставалось место списку. На телефоне прокручивается вся панель.
Маленькие кружки статусов на карте и в списке имеют размер 14 px.

Перед обновлением: SQLite backup, проверка миграции на копии, backend,
затем Pages. Исходники должны оставаться доступны сервисному пользователю
(`umask 022` при обновлении Git); резервные копии и env сохраняются закрытыми.

## Дополнительные ярлыки

Три независимых ярлыка: photoSpot (camera), limitedDates (calendar-clock),
reservation (ticket). От нуля до трёх на место; иконки стоят компактной строкой
рядом с названием в карточке, с подсказками по наведению/нажатию. На маркерах
их нет. OR внутри выбранных ярлыков, AND между группами города/категории/статуса.
Сброс очищает и ярлыки. Завершившееся событие не скрывается и не меняет статус.

Простой период и свободный текст расписания независимы; текст в карточке
и редакторе изначально свёрнут. Начало или конец даты можно не задавать —
это правило ярлыка места, не календарного периода. Ссылка бронирования необязательна.
Редактор ярлыков расположен после статуса и заметки; сохранение у них общее.
Назначения ярлыков существующим местам не делаются автоматически.

### Данные, API и подготовленные пакеты


Three independent optional tags are stored in `places.tags_json` (migration
`0006_place_tags.sql`), alongside the existing category, status and note data.
`public/place-tags.js` is the shared definition, validation, date and rendering
module; Lucide paths are bundled locally under the existing ISC license.
Missing tags in old imports mean no tags. Export/restore includes disabled
metadata and `tags_version`; ordinary repeated CSV imports leave it untouched.

Place information continues to be managed through ChatGPT. Admins and editors
can additionally edit the three tags and their optional fields in the place card;
viewers see the tags without editing controls. The card uses one Save button for tags, notes and statuses in one SQLite
transaction with version checks and rollback on any conflict. The schedule
editor starts collapsed. Dates share a row from 380 CSS px and stack on smaller screens; padding lives
on the input wrapper to avoid Safari intrinsic-width overflow. To review a private
batch, use `server/update-place-tags.mjs` with this format:

```json
{"schema_version":1,"places":[{"id":"existing-place-id","version":1,"tags":{"photoSpot":true,"limitedDates":{"enabled":true,"startDate":"2026-12-29","endDate":"2027-01-05","scheduleText":"29–31 декабря: 10:00–20:00\n1 января: закрыто"},"reservation":{"enabled":true,"url":"https://example.com/booking"}}}]}
```

Use the real IDs and current `tags_version` from authenticated `/api/export`.
Do not assign tags without a reviewed request. Run on the current migrated DB:

```sh
DATABASE_PATH=/private/taiwan.sqlite node server/update-place-tags.mjs /private/tags.json --check
DATABASE_PATH=/private/taiwan.sqlite node server/update-place-tags.mjs /private/tags.json --apply /private/new-tags-backup.sqlite
```

Apply refuses an existing backup path, creates a private SQLite backup before
writes, and validates the entire batch again inside a transaction. Stale tag
versions abort the batch. Nested patches preserve other fields and disabled
values. The authenticated `PUT /api/places/:id/tags` route accepts
`{"version":1,"tags":{"photoSpot":true}}` for admin/editor management using the
same validation and conflict checks; viewer writes are rejected. This does not
introduce a general place editor; the card editor is restricted to these tags. Notes/statuses and visibility use independent
versions. Schedule text is limited to 2000 characters and booking URLs to 1024;
only HTTP/HTTPS without credentials is accepted. End dates are inclusive and
checked against calendar days in Asia/Taipei, never parsed from free text.

The existing `PUT /api/places/:id/state` also accepts optional `tags` (nested
patch) and `tags_version`. A stale note or tag version aborts the whole batch
before COMMIT. Legacy requests without tags remain supported. Only this route
allows up to 32 KiB for the combined note and schedule; other request limits
remain at 8 KiB. Field length limits are unchanged.
