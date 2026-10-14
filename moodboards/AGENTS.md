# AGENTS.md

Инструкции действуют для всего репозитория `moodboards/`. Цель — быстро находить нужный модуль и не перечитывать проект целиком.

## Быстрый контекст

- Автономное desktop-first демо MoodBoards без production backend и без этапа сборки.
- PHP формирует оболочки страниц; клиент — нативные ES-модули, jQuery 4 и Konva 10 из `assets/vendor/`.
- `window.MoodboardsConfig` формируется из `includes/config.php` в `includes/header.php`. В config нельзя добавлять секреты.
- Данные досок и Blob изображений хранятся в IndexedDB; пользовательские настройки — в localStorage.
- CSS-фреймворков и runtime build-step нет. `package.json` и Playwright используются только для E2E; не добавлять Bootstrap/Tailwind и новые зависимости без прямого запроса.
- Публичные пути начинаются с `/moodboards/`; PHP-сервер запускается из родительского каталога: `php -S 127.0.0.1:8080 -t .`.

## Куда идти по задаче

| Зона | Основные файлы |
|---|---|
| Список досок, архив, шаблоны | `index.php`, `assets/js/moodboards-page.js`, `assets/js/moodboards/moodboards-list-controller.js`, `assets/js/moodboards/moodboard-templates.js`, `assets/css/moodboards.css` |
| Оболочка и панели редактора | `editor.php`, `assets/js/editor/ui-controller.js`, `assets/css/editor.css` |
| Координация редактора, импорт, экспорт, autosave | `assets/js/editor/editor-app.js` |
| Konva, drag/resize/rotate/draw/export | `assets/js/editor/canvas-adapter.js` |
| Zoom/pan/fit/мини-карта | `assets/js/editor/viewport-controller.js` |
| Команды, undo/redo | `editor-command-registry.js`, `command-manager.js`, `history-manager.js` |
| Состояние и листы | `editor-store.js`, `page-order-utils.js` |
| Стрелки и привязки | `arrow-utils.js`, `arrow-binding-utils.js`, `binding-guide-utils.js` |
| Фреймы, слои, selection, placement | соответствующие `*-utils.js` в `assets/js/editor/` |
| Preview | `preview-manager.js`; отдельный скрытый `CanvasAdapter` создаётся в `editor-app.js` |
| JSON-модель и миграции | `assets/js/models/moodboard-document.js`, спецификация `docs/JSON-DOCUMENT.md` |
| API/IndexedDB/HTTP repository | `assets/js/api/api-client.js`, `assets/js/repositories/`; `examples/` содержит только совместимый re-export |
| Тарифы и доступ | `assets/js/access/`, `api/mock-user-status.php` |
| Read-only просмотр | `view.php`, `assets/js/viewer/app.js`, `assets/js/repositories/public-*.js`, `assets/css/viewer.css` |
| Общие стили и токены | `assets/css/base.css` |
| Браузерный E2E baseline | `e2e/moodboards.spec.mjs`, `e2e/fixtures.mjs`, `playwright.config.mjs` |

Точки входа: `assets/js/moodboards-page.js`, `assets/js/editor/app.js`, `assets/js/viewer/app.js`. Общая инициализация — `assets/js/app-bootstrap.js`.

## Инварианты, которые нельзя ломать

- Источник истины — JSON-документ schema v2: `pages[]`, у каждого листа собственные `canvas` и `elements`.
- Порядок `page.elements` равен Z-index: первый сзади, последний спереди.
- Активный лист, selection и viewport — UI state, не часть JSON.
- Konva — только представление. Итог действия записывается в документ через `CommandManager`; не сохранять `scaleX`, `scaleY`, `draggable` и другие runtime-атрибуты Konva.
- Любое пользовательское изменение документа должно поддерживать undo/redo и запускать autosave. История содержимого изолирована по листам.
- Repository остаётся асинхронным и возвращает независимые копии. Изображения хранятся отдельными Blob и связываются через `assetId`.
- Список и редактор получают приватный repository через `RepositoryFactory`. Viewer получает только `getSnapshot/getAsset` через `PublicRepositoryFactory`; не передавать ему приватный repository. Сетевые repository используют общий `ApiClient`.
- Object URL всегда освобождать. Не регистрировать события повторно; для jQuery использовать namespace и снимать handlers в `destroy()`.
- Preview строится на отдельном canvas, выбирает заполненный лист и должен включать все его объекты без переключения рабочей сцены.
- Карточка принимает локальный `previewBlob` или серверный HTTP(S) `previewUrl`; отзывать через `URL.revokeObjectURL` можно только URL, созданные самим приложением из Blob.
- Внешние ссылки допускают только `http:`/`https:`. Пользовательский текст вставлять через `textContent`/`.text()`, не через HTML.
- Лимиты и runtime-параметры брать из `includes/config.php`; сейчас максимум 40 листов, минимальная ширина UI — 500 px.
- Сохранять доступность: `aria-label` у icon-only кнопок, `focus-visible`, корректные disabled/pressed/expanded состояния, без layout shift.

## Экономное исследование

1. Начинать с `rg -n "символ|data-role|data-action"` по предполагаемому модулю.
2. Читать только небольшое окно вокруг совпадения (`Get-Content ... | Select-Object -Skip N -First N`).
3. Не читать целиком `canvas-adapter.js`, `ui-controller.js`, `editor.php` и README, если задача локальная.
4. Не открывать `assets/vendor/*.min.js`, бинарные preview, `temp_templates/` и большие JSON шаблонов без прямой необходимости. Runtime-шаблоны находятся в `assets/templates/`.
5. Документы читать по маршруту: формат данных — `JSON-DOCUMENT.md`; нормативный HTTP-контракт — `ROOMPLAN-INTEGRATION-CONTRACT.md` и `openapi/moodboards-api.openapi.json`; repository/checklist — `INTEGRATION.md`; ручная приёмка — `ACCEPTANCE-CHECKLIST.md`.
6. Перед правкой проверить `git status --short`; не затрагивать и не откатывать несвязанные изменения пользователя.

## Проверки

Модульные регрессионные тесты запускаются напрямую Node из корня репозитория:

```powershell
Get-ChildItem tests -Filter *.test.mjs | ForEach-Object {
    node $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "Test failed: $($_.Name)" }
}
```

Критический браузерный baseline запускается отдельно и сам поднимает PHP-сервер:

```powershell
npm install
npx playwright install chromium
npm run test:e2e
```

Для Chrome, Edge и Firefox используется `npm run test:e2e:browsers` после `npx playwright install firefox`. Не смешивать `tests/*.test.mjs` и Playwright-спеки в одном каталоге.

Минимум после изменений:

- JS: `node --check <изменённый-файл.js>`.
- PHP: `php -l <изменённый-файл.php>`; если PHP не в PATH, в текущем workspace доступен `..\.tools\php-8.4.24\php.exe`.
- Все релевантные `.test.mjs`, а при изменении общих модулей — весь набор.
- `git diff --check`.
- Для IndexedDB вручную открыть `/moodboards/repository-smoke-test.php`, если менялся repository/схема.
- Для визуальных или pointer-изменений проверить локально ширины 500, 1024, 1440 и 1920 px, light/dark, пустое и переполненное состояние, если браузер доступен.

Добавлять небольшой регрессионный тест в `tests/` для исправленного поведения. Тесты могут импортировать чистые функции; сложный DOM/Konva допустимо проверять узким source assertion только когда полноценный браузерный harness отсутствует.

## Стиль изменений

- Переиспользовать CSS-переменные из `base.css`; новые общие токены добавлять туда, локальные — в CSS страницы.
- Предпочитать небольшие чистые helpers большим новым веткам внутри контроллеров.
- Не менять JSON-контракт без миграции, валидации, теста и обновления `docs/JSON-DOCUMENT.md`.
- Не реализовывать production backend: сохранять repository abstraction и обновлять пример HTTP/API-документацию при изменении контракта.
- Не коммитить без прямого запроса. При запросе коммитов разделять накопленные изменения по функциям и сначала прогонять проверки.
