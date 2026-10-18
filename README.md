# Taiwan Field Notes

Личная карта поездки в Тайвань: GitHub Pages для интерфейса, собственный VPS для авторизации, каталога и пользовательских данных. Прежняя временная версия остаётся рабочей до проверки нового размещения.

## Размещение

Исходники: https://github.com/idanpon/taiwan-map. Интерфейс собирается и публикуется workflow из main. Адрес API задаётся через Repository Variables после подготовки VPS. Прежняя временная версия остаётся доступной до завершения переключения; VPS и DNS настраиваются отдельно.

[Порядок размещения](docs/DEPLOYMENT.md). Частная диагностика VPS и персональные экспорты не входят в публичный репозиторий.

## Схема размещения

| Компонент | Предлагаемый адрес |
|---|---|
| Интерфейс | `https://taiwan.svobodadlaseti.shop` → GitHub Pages |
| API base | `https://svobodadlaseti.shop/taiwan` |
| Пример endpoint | `https://svobodadlaseti.shop/taiwan/api/data` |
| API-процесс | `127.0.0.1:18080`, Node.js 24 + SQLite, systemd |

Caddy уже обслуживает основной домен на внутреннем `127.0.0.1:8444`. В его существующий site добавляется `handle_path /taiwan/*`, который снимает `/taiwan` и проксирует `/api/...` на API-процесс. Это использует действующие домен, сертификат и SNI-маршрут. Точный порядок маршрутов и отсутствие занятого `/taiwan/*` ещё нужно проверить. Шаблон — `server/Caddy-route.snippet`; он не является изменением конфигурации VPS.

GitHub Pages и API имеют разные origins, но относятся к одному HTTPS site. API использует точный CORS allowlist, OPTIONS и `credentials: include`; cookie остаётся `HttpOnly; Secure; SameSite=Strict`, без Domain, с Path=/taiwan/api. Схема `github.io` + API на `svobodadlaseti.shop` будет cross-site и может не работать из-за third-party cookie restrictions. Для текущего механизма входа нужен custom domain интерфейса. Bearer-токены в localStorage и обходы настроек браузера не используются.

## GitHub Pages

1. Создать отдельный `idanpon/taiwan-map`, дать подключённому GitHub-приложению доступ и загрузить этот проект. На GitHub Free Pages нужен публичный репозиторий; возможности приватного зависят от тарифа.
2. Settings → Pages → Source → GitHub Actions. CI/environment `github-pages` должны разрешать публикацию.
3. Когда API и DNS готовы, задать Repository Variables: `PAGES_API_BASE=https://svobodadlaseti.shop/taiwan`, `PAGES_CUSTOM_DOMAIN=taiwan.svobodadlaseti.shop`. Это публичные адреса, не секреты.
4. Настроить custom domain и подтвердить владение в GitHub, затем CNAME `taiwan` → `idanpon.github.io` и HTTPS по документации GitHub. Workflow из main проверяет и публикует только `dist/`.

Без `PAGES_API_BASE` сборка показывает «Сервер данных ещё не подключён» и блокирует форму. Она не имитирует парольную защиту и не подменяет серверное сохранение localStorage. Относительные файлы работают и в `/taiwan-map/`, и в корне custom domain. Экспорт JSON идёт через API с cookies.

Публичные HTML/JS доступны без пароля — это оболочка. Все персональные данные, статусы и заметки выдаёт защищённый API после входа. В `dist/` нет backend-кода, seed-каталога, БД, пароля или хеша. В исходниках репозитория находятся только стартовые 10 публичных туристических мест; персональные экспорты туда не добавлять.

## VPS

Основной вариант для имеющихся ресурсов — systemd, без Docker и отдельного БД-сервера. `server/taiwan-map.service`: отдельный пользователь, код `/opt/taiwan-map`, данные `/var/lib/taiwan-map`, память до 192 MiB, loopback:18080. Перед установкой подтвердить Node 24+ и его путь в ExecStart. Env хранить в `/etc/taiwan-map.env`, root:root, 0600; ключи — `.env.example`.

`APP_PASSWORD_HASH` создаётся `node server/password.mjs`, пароль подаётся через stdin, а не через аргументы/историю shell. `APP_ORIGIN=https://svobodadlaseti.shop`, `FRONTEND_ORIGIN=https://taiwan.svobodadlaseti.shop`, `SESSION_COOKIE_PATH=/taiwan/api`. На время диагностики `TRUST_PROXY=0`; в схеме nginx TCP/SNI → Caddy реальный IP не подтверждён. Тогда лимит входов считается общим для источника-прокси. Перед регулярным использованием согласовать передачу реального IP или общий лимит. Нельзя доверять произвольному X-Forwarded-For либо включать PROXY protocol сразу для всех upstream.

Нельзя заменять существующие nginx/Caddy-конфиги: nginx занимает 443, Caddy — 80 и внутренний 8444, работают xray и другие сервисы. Docker Compose и примеры отдельного API-поддомена оставлены как альтернативы, не как основной способ для этого VPS.

## Перенос текущих данных

На старой карте скачать Export JSON и сохранить вне репозитория, например `export.private.json`. При остановленном API и пустой целевой базе:

```sh
DATABASE_PATH=/var/lib/taiwan-map/taiwan.sqlite node server/import.mjs /private/export.private.json
```

Импорт транзакционный, не меняет непустую БД, сохраняет каталог, ссылки, кастомные статусы, заметки и версии. Пароли/сессии и полная старая история не входят в JSON-экспорт. Финальный экспорт делать перед переключением; изменения после него в импорт не попадут. Исходный сайт отключать только после проверки нового.

## Архитектура

12 таблиц: поездки, пользователи, членство, категории, места, ссылки, статусы, текущие состояния, история, сессии, ограничитель входа, метаданные. Пока один общий профиль; будущие аккаунты имеют собственные состояния через user/place. Справочник статусов расширяемый, текущий основной статус один. Изменение состояния атомарно пишет историю и проверяет версию; устаревший клиент получает 409. CORS не заменяет авторизацию: сессия и членство проверяются сервером.

Часы: timezone/weekday intervals/exceptions/note/label и дата проверки. Источники просмотрены 18.10.2026; праздничный график не подтверждён. Геопозиция по кнопке остаётся в браузере и требует HTTPS.

SQLite: foreign keys, WAL, busy timeout, SQL-миграции с проверкой неизменности. Ежедневный snapshot после появления каталога, включая первый успешный вход, хранение 14 дней в `backups/`. Внешнее копирование не настроено; копии на том же VPS не защищают от его потери.

## Файлы и проверки

- `public/`, `src/ui.mjs`: HTML/CSS/JS, Leaflet 1.9.4, OSM tiles с атрибуцией и обычным кешированием, без bulk/offline загрузок.
- `scripts/build-pages.mjs`: сборка без npm-зависимостей; runtime тоже не требует сторонних npm-пакетов.
- `src/core.mjs`, `server/`: API, SQLite, systemd, импорт, read-only диагностика.
- `drizzle/`: SQL-миграции; `db/schema.ts` — описание схемы. Для разработки новых миграций нужен Drizzle generator, но запуск и Pages от него не зависят.
- `.github/workflows/pages.yml`: тесты на push/PR, публикация из main.

`npm test` проверяет вход/выход, persistence, членство, конфликты, limiter, CORS/OPTIONS/ошибки/запрещённые origins, импорт/откат и Pages-сборку без backend-файлов. `npm run build:pages` собирает интерфейс. Визуальный прогон в браузере и проверка самого VPS пока не выполнены.
