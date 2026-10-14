# Подготовка к HTTP-интеграции

Production backend в демо отсутствует. Этот документ описывает текущую repository-границу и подготовку проекта. Нормативный baseline интеграции с RoomPlan зафиксирован в [`ROOMPLAN-INTEGRATION-CONTRACT.md`](ROOMPLAN-INTEGRATION-CONTRACT.md), а точные HTTP-схемы — в [`openapi/moodboards-api.openapi.json`](openapi/moodboards-api.openapi.json). При расхождении черновой таблицы ниже с OpenAPI приоритет имеют нормативный контракт и OpenAPI.

## ApiClient и RepositoryFactory

`assets/js/api/api-client.js` — единая транспортная граница будущего API. Клиент добавляет `Accept`, `X-Request-Id`, same-origin credentials и, для изменяющих запросов, `X-CSRF-Token`. Запросы create/upload/duplicate могут получить стабильный `Idempotency-Key`. Клиент ограничивает время запроса, повторяет только безопасные или идемпотентные операции и преобразует HTTP, network, timeout, abort и некорректный JSON в `ApiClientError` со стабильными полями `code`, `status`, `details` и `requestId`.

Autosave выполняет отдельный от транспортного retry: повторяет network/timeout, `408`, `425`, `429` и временные `5xx`, учитывает `Retry-After` (не более 30 секунд), но не зацикливает `400`/`401`/`403`/`404`/`409`/`422`, ошибки CSRF, валидации и отменённые запросы. При любом отказе несохранённый recovery draft остаётся доступен.

`assets/js/repositories/repository-factory.js` изолирует приватное хранилище списка и редактора. Значение `storage.driver: indexeddb` остаётся значением по умолчанию. Фабрика проверяет полный `MoodboardRepository` и содержит встроенные drivers `indexeddb` и `http`. HTTP driver создаёт runtime `HttpMoodboardRepository` с общим `ApiClient`; наличие адаптера не означает наличие production backend.

Public viewer отделён от приватного repository. `PublicRepositoryFactory` выдаёт только контракт `getSnapshot()`/`getAsset()`. Локальный demo-адаптер фильтрует поля записи и запрещает чтение assets, на которые snapshot не ссылается. HTTP-адаптер обращается только к `/public/moodboards/{token}` и `/public/moodboards/{token}/assets/{assetId}`, отправляет `credentials: omit` и не имеет методов изменения данных. Новые ссылки используют query-параметр `token`; `id` поддерживается только как временная совместимость локального демо.

После появления backend переключение выполняется конфигурацией без изменения entry point:

```php
'storage' => [
    'driver' => 'http',
],
'api' => [
    'baseUrl' => '/api',
    'timeoutMs' => 15000,
    'retryCount' => 1,
    'csrfToken' => $csrfToken,
    'requireCsrf' => true,
],
```

Для production-конфигурации `api.requireCsrf` должен быть включён, а `api.csrfToken` — сформирован сервером для текущей сессии. Секретные API-ключи в публичную runtime-конфигурацию добавлять нельзя.

## Repository interface

Все методы асинхронны и возвращают независимые от внутреннего состояния объекты.

| Метод | Результат |
|---|---|
| `list()` | Массив записей, новые сверху |
| `create({ title, document? })` | Созданная запись с `revision: 0` |
| `get(id)` | Запись либо `null` |
| `updateMeta(id, { title })` | Обновлённая запись |
| `setArchived(id, archived)` | Запись с установленным `archivedAt` или `null` |
| `saveContent(id, document, revision)` | Запись с увеличенной `revision` |
| `delete(id)` | `true`, если запись существовала |
| `duplicate(id)` | Новая запись и независимые копии assets |
| `addAsset(moodboardId, blob)` | Метаданные asset вместе с Blob |
| `getAsset(assetId)` | Asset вместе с Blob либо `null` |
| `deleteAsset(assetId)` | `true`, если asset существовал |
| `savePreview(moodboardId, blobOrNull)` | Запись с новым PNG preview; `null` очищает preview |

Форма записи:

```json
{
  "id": "board-id",
  "title": "Название",
  "document": {
    "schemaVersion": 2,
    "pages": [
      {
        "id": "page-id",
        "name": "Лист 1",
        "canvas": { "width": 1600, "height": 1000, "background": "#ffffff" },
        "elements": []
      }
    ]
  },
  "revision": 4,
  "previewBlob": null,
  "previewUrl": null,
  "archivedAt": null,
  "createdAt": "2026-08-20T12:00:00.000Z",
  "updatedAt": "2026-08-20T12:05:00.000Z"
}
```

`archivedAt` равен `null` для активной доски и ISO-дате для архивной. Архивные доски доступны для чтения, восстановления и безвозвратного удаления, но не для редактирования, загрузки assets, обновления preview или дублирования.

Preview имеет две формы в зависимости от driver: IndexedDB возвращает `previewBlob`, а HTTP DTO — `previewUrl`. UI принимает оба поля, выбирает непустой локальный Blob первым, разрешает для URL только HTTP(S) и показывает placeholder при отсутствии либо ошибке загрузки. Внешние URL не передаются в `URL.revokeObjectURL`. Ошибки repository должны иметь стабильные `code` и `details`. Минимальный набор: `INVALID_ARGUMENT`, `MOODBOARD_NOT_FOUND`, `MOODBOARD_ARCHIVED`, `REVISION_CONFLICT`, `CORRUPT_RECORD`, `INVALID_ASSET_TYPE`, `INVALID_IMAGE`, `NETWORK_ERROR`, `REPOSITORY_ERROR`.

## Repository пользовательских настроек

`MoodboardSettingsRepository` отделён от JSON-документа и repository досок. Его асинхронный контракт содержит два метода:

| Метод | Результат |
|---|---|
| `load()` | Нормализованные настройки текущего пользователя |
| `save(settings)` | Сохранённые нормализованные настройки |

Текущая локальная реализация хранит запись schemaVersion 1 с полями `showGrid`, `showCanvasSheet`, `showElementDimensions`, `alwaysSnap`, `showBindingGuides`, `darkMode`, `focusMode` и `imageEraserSize`, используя отдельный ключ для каждого `userId` и guest scope. `imageEraserSize` хранит выбранную толщину ручного ластика в диапазоне 8–256 px. Будущий HTTP-адаптер должен определять пользователя по серверной сессии, а не принимать произвольный `userId` от клиента.

## Предлагаемые endpoints

| Метод и URL | Назначение | Успех |
|---|---|---|
| `GET /api/user/moodboards-access` | Авторизация, тариф и лимиты MoodBoards | `200`, `401`, `403` |
| `GET /api/user/moodboard-settings` | Получить пользовательские настройки редактора | `200` |
| `PUT /api/user/moodboard-settings` | Сохранить нормализованные настройки редактора | `200`, `400` |
| `GET /api/moodboards` | Список досок | `200` |
| `POST /api/moodboards` | Создать доску | `201` |
| `GET /api/moodboards/{id}` | Получить доску | `200`, `404` |
| `PATCH /api/moodboards/{id}` | Переименовать | `200` |
| `PUT /api/moodboards/{id}/archive` | Архивировать или восстановить `{ archived }` | `200`, `404` |
| `PUT /api/moodboards/{id}/content` | Сохранить `{ document, revision }` | `200`, `409` |
| `DELETE /api/moodboards/{id}` | Удалить доску и assets | `204`, `404` |
| `POST /api/moodboards/{id}/duplicate` | Дублировать атомарно | `201` |
| `POST /api/moodboards/{id}/assets` | Загрузить `multipart/form-data` | `201` |
| `GET /api/assets/{assetId}` | Получить бинарный asset | `200`, `404` |
| `DELETE /api/assets/{assetId}` | Удалить asset | `204`, `404` |
| `PUT /api/moodboards/{id}/preview` | Сохранить `image/png` | `200` |
| `DELETE /api/moodboards/{id}/preview` | Очистить preview и использовать дефолт карточки | `200`, `204` |
| `POST /api/moodboards/{id}/shares` | Создать или перевыпустить публичный read-only token | `201`, `403`, `404` |
| `DELETE /api/moodboards/{id}/shares/{shareId}` | Отозвать публичную ссылку, не передавая secret token в private API | `204`, `403`, `404` |
| `GET /api/public/moodboards/{token}` | Получить публичный read-only снимок с assets | `200`, `404`, `410` |
| `GET /api/public/moodboards/{token}/assets/{assetId}` | Получить разрешённый snapshot бинарный asset | `200`, `404`, `410` |

Для `saveContent` backend сравнивает переданную `revision` с текущей в одной транзакции. При несовпадении возвращает `409`:

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "Документ уже изменён",
    "details": { "expectedRevision": 3, "actualRevision": 4 }
  }
}
```

Assets и документ при duplicate/delete изменяются одной серверной операцией. Ограничения размера, MIME и фактическое декодирование изображения проверяются повторно на сервере, независимо от frontend-проверки.

В демо контракт доступа имитирует `/moodboards/api/mock-user-status.php`. Ответ содержит `is_authorized`, `tariff_plan`, `features.moodboards_allowed` и `features.max_moodboards`. Frontend использует feature-флаги как источник истины и не выводит права только из названия тарифа. MoodBoards разрешены для `basic`, `premium` и `pro`, а `guest` и `free` блокируются. По умолчанию используется `pro`; query-параметр `mock_tariff=guest|free|basic|premium|pro` и плавающий переключатель «Демо-тариф» предназначены исключительно для ручного тестирования.

## Ограничения демо

- Данные доступны только в IndexedDB текущего origin и профиля браузера.
- Демонстрационная публичная ссылка содержит UUID локальной доски и не переносит данные: она работает только на том же origin и в том же профиле браузера. Отдельного публичного token, срока действия, отзыва и серверного snapshot в демо нет.
- Нет аккаунтов, прав доступа, совместного редактирования, синхронизации между устройствами и серверных резервных копий.
- История undo/redo живёт только в памяти, ограничена 100 командами и сбрасывается после reload.
- Асинхронная запись при аварийном закрытии вкладки не гарантируется браузером; надёжная синхронизация требует серверного протокола/очереди.
- Квота IndexedDB зависит от браузера и свободного места; демо не управляет квотой и очисткой orphan assets.
- Поддерживаются JPEG, PNG и WebP; SVG, HEIC, анимация и цветовые профили не нормализуются.
- Нет серверной валидации, антивирусной проверки, rate limiting, аудита и observability.
- Preview, PNG и PDF генерируются на клиенте; результат зависит от доступности шрифтов и декодирования изображений.
- Интерфейс рассчитан на desktop 1024–1920 px и не является мобильным редактором.

## Checklist интеграции

- [x] Ввести общий `ApiClient`, фабрику repository и перевести runtime entry point на фабрику без смены текущего IndexedDB-драйвера.
- [x] Сделать `HttpMoodboardRepository` runtime-модулем и зарегистрировать встроенный driver `http` в фабрике.
- [x] Отделить viewer от приватного `MoodboardRepository`: отдельная public-фабрика, read-only snapshot и token-scoped asset loader.
- [ ] Утвердить JSON schema и стратегию миграций `schemaVersion`.
- [x] Зафиксировать OpenAPI, лимиты payload и единый envelope ошибок.
- [ ] Реализовать авторизацию и проверку доступа для каждой доски и asset.
- [ ] Подключить HTTP-реализацию `MoodboardSettingsRepository`, серверную валидацию и миграции версии настроек.
- [ ] Реализовать отдельные криптографически стойкие публичные tokens: выдачу, срок действия, отзыв и аудит; не раскрывать внутренний UUID доски как credential.
- [ ] Отдавать публичный read-only snapshot и его assets без пользовательской сессии, не открывая private repository endpoints.
- [ ] Добавить rate limiting, cache policy и `404`/`410` для неизвестных и отозванных публичных ссылок.
- [ ] Сделать `saveContent`, duplicate и delete транзакционными.
- [ ] Зафиксировать серверные правила архива, восстановления и окончательного удаления.
- [ ] Сопоставить revision с optimistic locking (`409 REVISION_CONFLICT`).
- [ ] Добавить идемпотентные ключи для create, upload и duplicate.
- [ ] Проверять MIME, сигнатуру, размеры, лимит пикселей и размер файла на backend.
- [ ] Выбрать object storage, lifecycle orphan assets и политику удаления.
- [ ] Определить CDN/CORS/cache headers для assets и preview.
- [x] Добавить ограниченный retry/backoff autosave для network/timeout и временных HTTP-ошибок с учётом `Retry-After`.
- [ ] Добавить offline-очередь и UX разрешения revision-конфликтов.
- [ ] Настроить CSRF-защиту или token-based API, CSP и security headers.
- [ ] Добавить логи, метрики, трассировку и алерты ошибок сохранения.
- [ ] Выполнить миграционное и контрактное тестирование обоих repository.
- [x] Провести автоматический E2E baseline в поддерживаемых Chrome, Edge и Firefox; ручную визуальную матрицу разрешений вести отдельно в `ACCEPTANCE-CHECKLIST.md`.
- [ ] Проверить accessibility, производительность больших досок и лимиты памяти.
- [ ] Настроить backup/restore и проверить восстановление повреждённой записи.

Runtime-адаптер находится в `assets/js/repositories/http-moodboard-repository.js` и зарегистрирован в `RepositoryFactory`. `examples/http-moodboard-repository.js` оставлен только как совместимый re-export старого пути.
