# Контракт интеграции MoodBoards с RoomPlan

Статус: **baseline v1, готов к согласованию frontend/backend**.  
Дата фиксации: 2026-09-04.  
Машиночитаемая часть: [`openapi/moodboards-api.openapi.json`](openapi/moodboards-api.openapi.json).  
Каноническая схема содержимого: [`JSON-DOCUMENT.md`](JSON-DOCUMENT.md).

Этот документ фиксирует границу между клиентом MoodBoards и RoomPlan. Слова «должен», «нельзя» и «только» являются нормативными. Изменение несовместимого поведения требует новой версии API или явно описанной миграции.

## 1. Область контракта

Контракт покрывает:

- проверку доступа и тарифных ограничений;
- список, создание, чтение, переименование, архивирование, восстановление, дублирование и удаление досок;
- сохранение JSON-документа с optimistic locking;
- загрузку и получение изображений;
- сохранение preview;
- пользовательские настройки редактора;
- выпуск и отзыв публичных read-only ссылок;
- единый формат ошибок, request ID, CSRF, идемпотентность и лимиты.

В baseline v1 не входят совместное редактирование, комментарии, realtime/WebSocket, частичные document patches, серверный рендер PNG/PDF и production backend внутри этого репозитория.

## 2. Транспорт и версия

- Базовый URL: `/api` на том же origin, что и RoomPlan.
- Формат JSON: UTF-8, `Content-Type: application/json`.
- Даты: UTC ISO 8601 (`2026-09-04T12:34:56.000Z`).
- ID: непрозрачные строки; клиент не извлекает из них смысл.
- Клиент отправляет `Accept: application/json` для JSON endpoint.
- API возвращает `X-Request-Id` во всех ответах. Входящий корректный `X-Request-Id` может быть сохранён; иначе сервер генерирует новый.
- Несовместимое изменение URL, обязательных полей или семантики выпускается как новая major-версия контракта.

Успешные ответы возвращают ресурс напрямую либо коллекцию `{ "items": [], "nextCursor": null }`. Унифицированный envelope применяется только к ошибкам.

## 3. Авторизация, CSRF и права

Private endpoint используют существующую серверную сессию RoomPlan через same-origin `HttpOnly`, `Secure`, `SameSite=Lax` cookie. Название cookie является внутренней деталью RoomPlan и не читается frontend.

- Bootstrap endpoint `GET /user/moodboards-access` доступен без обязательной сессии: при её отсутствии он возвращает `200` с тарифом `guest`, `is_authorized: false` и эффективными feature flags. При наличии cookie он использует сессию RoomPlan.
- Неавторизованный private-запрос: `401 AUTH_REQUIRED`.
- Пользователь без функции MoodBoards: `403 FEATURE_NOT_AVAILABLE`.
- Чужая или несуществующая доска/asset: одинаковый `404 RESOURCE_NOT_FOUND`; API не раскрывает существование чужого ресурса.
- Все небезопасные private-методы (`POST`, `PUT`, `PATCH`, `DELETE`) требуют `X-CSRF-Token`.
- CSRF token передаётся RoomPlan в серверной runtime-конфигурации страницы. Он не хранится в документе, IndexedDB, URL или логах.
- Public endpoint не использует пользовательскую сессию и объявляет `security: []`.
- CORS для baseline v1 не включается. Запросы ожидаются только с origin RoomPlan.

В v1 редактировать доску может только владелец. Роли collaborator/editor не определены.

| Операция | Активная своя | Архивная своя | Чужая | Public token |
|---|---:|---:|---:|---:|
| Читать | да | да | нет | snapshot only |
| Менять содержимое/название/preview/assets | да | нет | нет | нет |
| Архивировать | да | — | нет | нет |
| Восстановить | — | да | нет | нет |
| Дублировать | да | нет | нет | нет |
| Удалить окончательно | да | да | нет | нет |
| Создать/отозвать share | да | нет | нет | нет |

## 4. Тарифы и feature flags

Источник истины — `GET /api/user/moodboards-access`, а не вычисление прав на клиенте по названию тарифа.

- `guest`, `free`: `moodboards_allowed: false`;
- `basic`, `premium`, `pro`: `moodboards_allowed: true`;
- `max_moodboards` задаётся backend и включает активные и архивные доски;
- при достижении лимита создание и дублирование возвращают `403 MOODBOARD_LIMIT_REACHED` с `details.limit` и `details.current`;
- frontend может скрывать или блокировать действия, но backend повторно проверяет право для каждого запроса.

## 5. Transport DTO и Repository

HTTP DTO и внутренний `MoodboardRepository` связаны адаптером, но не обязаны совпадать побайтно.

- `GET /moodboards` возвращает лёгкие `MoodboardSummary` без полного документа.
- `GET /moodboards/{id}` и команды создания/дублирования возвращают `MoodboardRecord` с документом.
- Переименование, архивирование и preview возвращают `MoodboardSummary`; сохранение документа возвращает только `MoodboardSaveResult`. HTTP-адаптер при необходимости объединяет DTO с уже известным локальным документом, поэтому backend не эхо-возвращает большой JSON после autosave.
- HTTP использует `previewUrl`; адаптер или UI не должны требовать `previewBlob` для сетевого режима.
- `AssetMetadata.downloadUrl` используется для загрузки Blob. `assetId` в JSON остаётся стабильной связью.
- Любой входящий документ проходит каноническую миграцию и валидацию до передачи в `EditorStore`.

`MoodboardRepository` сохраняет асинхронную семантику и стабильные error codes независимо от storage driver.

## 6. Ревизии и сохранение

`revision` — неотрицательное целое, версия только содержимого `document`.

1. Новая доска создаётся с `revision: 0`.
2. Клиент отправляет `PUT /moodboards/{id}/content` с `{ document, revision }`, где `revision` равна последней загруженной/сохранённой версии.
3. Backend в одной транзакции проверяет текущую revision, валидирует документ, сохраняет его и увеличивает revision на 1.
4. При несовпадении ничего не записывается и возвращается `409 REVISION_CONFLICT`.
5. Ответ конфликта содержит `expectedRevision` (передано клиентом) и `actualRevision` (на сервере), но не перезаписывает локальный документ автоматически.

Переименование, preview и состояние архива обновляют `updatedAt`, но не меняют content revision. В v1 metadata использует last-write-wins. Autosave передаёт полный документ; PATCH/operation log отложены до измерения реальных payload.

## 7. Идемпотентность

`Idempotency-Key` обязателен для:

- `POST /moodboards`;
- `POST /moodboards/{id}/duplicate`;
- `POST /moodboards/{id}/assets`;
- `POST /moodboards/{id}/shares`.

Ключ — UUID/непрозрачная строка 16–128 символов. Область уникальности: пользователь + HTTP method + canonical path. Backend хранит результат минимум 24 часа.

- повтор с тем же ключом и тем же payload возвращает исходный статус и ресурс;
- повтор с другим payload возвращает `409 IDEMPOTENCY_KEY_REUSED`;
- сетевой retry разрешён только для идемпотентных методов или запросов с таким ключом.

## 8. Assets и preview

- В v1 принимаются только декодируемые JPEG, PNG и WebP.
- Максимальный входной файл: 30 MiB.
- Максимум: 40 мегапикселей и 16 384 px по любой стороне до серверной нормализации.
- MIME определяется по содержимому, а не только по имени и заголовку.
- SVG, HEIC, анимированные изображения и исполняемое содержимое отклоняются.
- Backend удаляет metadata, выполняет безопасное декодирование и сохраняет фактические `width`, `height`, `mimeType`, `size`.
- Asset принадлежит одной доске. Доступ проверяется через доску-владельца.
- Дублирование атомарно создаёт независимые asset records. Физическая дедупликация Blob допустима и невидима клиенту.
- Удаление доски атомарно удаляет/помечает её assets и shares.
- `DELETE /assets/{id}` разрешён только для неиспользуемого asset; используемый возвращает `409 ASSET_IN_USE`.
- Preview принимает только PNG до 5 MiB. Пустая доска может удалить preview и использовать дефолтную карточку.

Private download URL может вести через приложение или object storage. Если используется signed URL, срок и обновление URL не влияют на стабильный `assetId`.

## 9. Публичные ссылки

`POST /moodboards/{id}/shares` создаёт read-only snapshot и возвращает `shareId`, `url`, `createdAt`, `expiresAt`.

- Secret token содержит не менее 256 бит энтропии и передаётся только внутри `url`.
- Backend хранит hash token, не исходное значение.
- Управление/отзыв выполняется по `shareId`, а не по secret token.
- Public snapshot не содержит `userId`, внутренний `moodboardId`, тариф или приватные URL.
- Public assets выдаются только через token-scoped endpoint.
- Отозванная или истёкшая ссылка возвращает `410 SHARE_GONE`; неизвестный token — `404 RESOURCE_NOT_FOUND`.
- Ответ snapshot использует `Cache-Control: private, no-store`; public assets — `private, max-age=300` и повторную проверку token.
- Public API не предоставляет save, upload, archive, duplicate или delete.
- Экспорт PNG/PDF в viewer выполняется клиентом из snapshot.

Baseline создаёт новый snapshot при каждом новом idempotency key. Повтор с тем же ключом возвращает тот же share.

## 10. Пользовательские настройки

`GET/PUT /user/moodboard-settings` хранит настройки отдельно от документа. Backend определяет пользователя по сессии.

- schema version настроек: `1`;
- неизвестные поля игнорируются при чтении, но не возвращаются;
- отсутствующие поля нормализуются значениями по умолчанию;
- `imageEraserSize`: целое 8–256, по умолчанию 64;
- обновление заменяет полный нормализованный объект настроек.

## 11. Ошибки

Все ошибки имеют вид:

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "Документ уже изменён",
    "details": {
      "expectedRevision": 3,
      "actualRevision": 4
    },
    "requestId": "01J7..."
  }
}
```

`message` пригоден для интерфейса, но клиентская логика опирается только на `code`. `details` не содержит stack trace, SQL, путей файлов, секретов и персональных данных.

| HTTP | Code | Поведение клиента |
|---:|---|---|
| 400 | `INVALID_ARGUMENT`, `INVALID_JSON` | не повторять без исправления |
| 401 | `AUTH_REQUIRED` | показать вход/обновить сессию |
| 403 | `FEATURE_NOT_AVAILABLE`, `MOODBOARD_LIMIT_REACHED`, `CSRF_FAILED` | блокирующий UX/обновить access |
| 404 | `RESOURCE_NOT_FOUND` | показать отсутствие ресурса |
| 409 | `REVISION_CONFLICT`, `IDEMPOTENCY_KEY_REUSED`, `ASSET_IN_USE`, `MOODBOARD_ARCHIVED` | не перезаписывать молча |
| 410 | `SHARE_GONE` | публичная ссылка недоступна |
| 413 | `PAYLOAD_TOO_LARGE` | уменьшить документ/файл |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | отклонить файл |
| 422 | `INVALID_DOCUMENT`, `INVALID_IMAGE` | показать validation error |
| 429 | `RATE_LIMITED` | повторить после `Retry-After` |
| 500 | `INTERNAL_ERROR` | безопасное общее сообщение |
| 503 | `SERVICE_UNAVAILABLE` | retry с backoff |

## 12. Лимиты baseline v1

| Ограничение | Значение |
|---|---:|
| Название доски | 1–160 символов после trim |
| Листы | 1–40 |
| Название листа/слоя/группы | 1–80 символов |
| Элементы всего | 10 000 |
| JSON document | 10 MiB в несжатом UTF-8 |
| Asset upload | 30 MiB |
| Preview PNG | 5 MiB |
| Public share lifetime | 1–365 дней, по умолчанию 30 |
| List page size | 1–100, по умолчанию 50 |

Превышение лимита проверяется до изменения данных. Frontend должен получить те же значения через runtime config/access, но сервер остаётся источником истины.

## 13. Observability и приватность

- Каждый запрос связывается через `X-Request-Id`/`error.requestId`.
- Логи содержат route template, status, duration, error code, user ID в серверном формате и размер payload.
- Нельзя логировать document JSON, текст объектов, ссылки пользователя, бинарные assets, CSRF/session/share tokens.
- Метрики минимум: latency/error rate по endpoint, `409`, autosave failures, upload failures, quota/rate limit, share access `404/410`.
- Background removal остаётся отдельным сервисом, но ошибки прокси используют тот же error envelope и request ID.

## 14. Условия готовности backend

- OpenAPI проходит автоматическую валидацию и контрактные тесты.
- Все private endpoint проверяют session, ownership, feature flags и CSRF для mutations.
- Save/duplicate/delete выполняются транзакционно; конкурентный save воспроизводимо возвращает `409`.
- Idempotency проверена повторной отправкой после simulated timeout.
- Upload проверен на неверный MIME, повреждённый файл, oversized и decompression bomb.
- Public token нельзя использовать для private endpoint; отзыв немедленно даёт `410`.
- Frontend успешно проходит одинаковый repository contract suite для IndexedDB и HTTP.
- Пройдены E2E Chrome, Edge и Firefox: create → edit → autosave → reload → export → share/view.

## 15. Решения вне публичного контракта

До production rollout команда RoomPlan выбирает реализацию следующих деталей, не меняя описанную семантику:

- физическое имя session cookie и способ выдачи CSRF token;
- СУБД, object storage и CDN;
- формат внутренних ID;
- срок хранения audit/metrics и deleted assets;
- reverse-proxy route, который монтирует `/api`.

Эти значения нельзя зашивать в canvas-модули. Они задаются backend/runtime-конфигурацией и инфраструктурой RoomPlan.
