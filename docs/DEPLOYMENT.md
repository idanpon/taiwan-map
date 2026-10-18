# Порядок размещения

Основная схема: GitHub Pages отдаёт интерфейс с custom domain, API работает на VPS под systemd; frontend и API принадлежат одному HTTPS site. Между origins используется точный CORS allowlist и credentials: include. По одной статической странице нельзя обеспечить серверное хранение и проверку пароля.

## GitHub

- Новый отдельный репозиторий, подключённое GitHub-приложение должно иметь к нему доступ.
- Загрузить исходники и выбрать Pages → GitHub Actions.
- Workflow тестирует код и публикует только dist/. Не загружать env, приватные отчёты, экспорты или базу.
- Variables: PAGES_API_BASE — HTTPS base URL API, с необязательным path prefix, без завершающего слеша; PAGES_CUSTOM_DOMAIN — hostname страницы.
- Сначала подтвердить свой custom domain в GitHub, затем добавить CNAME/DNS и включить HTTPS. Разные registrable domains для UI и API потребуют другого механизма входа; third-party cookies не гарантируются.

## VPS

- Подтвердить Node 24+, путь к node и свободный локальный порт. Не обновлять runtime других служб вслепую.
- Создать отдельного системного пользователя taiwan-map, код /opt/taiwan-map, данные /var/lib/taiwan-map, env /etc/taiwan-map.env root:root 0600.
- Проверить и установить server/taiwan-map.service. Порт доступен только на loopback. Runtime не требует npm-зависимостей.
- Задать APP_PASSWORD_HASH через stdin-helper, APP_ORIGIN, FRONTEND_ORIGIN и SESSION_COOKIE_PATH. В шаблоне используется путь /taiwan/api.
- Сначала изучить существующий reverse proxy. server/Caddy-route.snippet — только маршрут внутри подходящего существующего virtual host. Он не заменяет конфиг nginx/Caddy. При наличии внешнего TCP/SNI demux нужно отдельно проверить client-IP forwarding; не включать PROXY protocol глобально.
- Пока service остановлен, импортировать финальный экспорт в пустую SQLite через server/import.mjs. Не коммитить экспорт. Старый сайт до приёмки оставить активным.
- Запустить службу, проверить health, CORS, пароль, сохранение после рестарта, экспорт и доступ с Safari/iPhone. Убедиться, что существующие службы продолжают работать.
- Настроить копирование SQLite-снимков за пределы VPS и проверить восстановление. Локальные снимки не защищают от потери сервера.

## Если чего-то ещё нет

До настройки API сборка Pages намеренно показывает сообщение, что сервер данных не подключён, и блокирует вход. Она не сохраняет статусы в localStorage. Ни репозиторий, ни DNS, ни VPS не создаются и не изменяются самими этими исходниками — нужны соответствующие административные действия.
