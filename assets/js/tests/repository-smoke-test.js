import { createMoodboardDocument, createMoodboardPage } from '../models/moodboard-document.js';
import { AutosaveManager } from '../editor/autosave-manager.js';
import {
    IndexedDbMoodboardRepository,
    RevisionConflictError,
} from '../repositories/indexeddb-moodboard-repository.js';

const $ = window.jQuery;
const config = window.MoodboardsConfig;
const testDatabaseName = `${config.storage.databaseName}-repository-smoke-test`;

function assert(condition, message) {
    if (!condition) {
        throw new Error(message);
    }
}

function deleteDatabase(databaseName) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(databaseName);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error || new Error('Не удалось удалить тестовую базу.'));
        request.onblocked = () => reject(new Error('Удаление тестовой базы заблокировано открытой вкладкой.'));
    });
}

async function putRawMoodboard(repository, record) {
    const database = await repository.open();
    const transaction = database.transaction(['moodboards'], 'readwrite');
    const completion = new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error || new Error('Тестовая транзакция отменена.'));
        transaction.onerror = () => reject(transaction.error || new Error('Тестовая транзакция завершилась с ошибкой.'));
    });
    transaction.objectStore('moodboards').put(record);
    await completion;
}

async function testRapidAutosave() {
    let documentState = createMoodboardDocument();
    let releaseFirstSave;
    let markFirstSaveStarted;
    const firstSaveStarted = new Promise((resolve) => {
        markFirstSaveStarted = resolve;
    });
    const savedSnapshots = [];
    const statuses = [];
    const store = {
        moodboardId: 'rapid-autosave',
        revision: 0,
        getDocument: () => structuredClone(documentState),
        setRevision(revision) {
            this.revision = revision;
        },
        setSaveStatus(status) {
            statuses.push(status);
        },
    };
    const repository = {
        async saveContent(id, documentSnapshot, revision) {
            assert(id === store.moodboardId, 'Autosave передал неверный ID доски.');
            savedSnapshots.push(structuredClone(documentSnapshot));
            if (savedSnapshots.length === 1) {
                markFirstSaveStarted();
                await new Promise((resolve) => {
                    releaseFirstSave = resolve;
                });
            }
            return { revision: revision + 1 };
        },
    };
    const autosave = new AutosaveManager({ store, repository });

    autosave.markChanged();
    const flushing = autosave.flush();
    await firstSaveStarted;

    documentState = createMoodboardDocument({
        elements: [{ id: 'text-intermediate', type: 'text', text: 'Промежуточное изменение' }],
    });
    autosave.markChanged();
    documentState = createMoodboardDocument({
        elements: [{ id: 'text-final', type: 'text', text: 'Последнее быстрое изменение' }],
    });
    autosave.markChanged();
    releaseFirstSave();
    assert(await flushing, 'flush() не завершил очередь сохранения.');

    assert(savedSnapshots.length === 2, 'Быстрые изменения не были объединены в один актуальный follow-up save.');
    assert(savedSnapshots[1].pages[0].elements[0]?.id === 'text-final', 'Autosave сохранил не последнее состояние документа.');
    assert(store.revision === 2, 'Локальная ревизия не обновилась после очереди autosave.');
    assert(statuses.at(-1) === 'saved', 'Финальный статус autosave должен быть saved.');
    await autosave.destroy({ flush: false });
}

function createPngBlob() {
    const canvas = document.createElement('canvas');
    canvas.width = 3;
    canvas.height = 2;
    const context = canvas.getContext('2d');
    context.fillStyle = '#bd6846';
    context.fillRect(0, 0, canvas.width, canvas.height);

    return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
            if (blob) {
                resolve(blob);
            } else {
                reject(new Error('Браузер не смог создать тестовый PNG Blob.'));
            }
        }, 'image/png');
    });
}

function addResult(name, success, detail = '') {
    const $item = $('<li>', {
        class: `smoke-test__result smoke-test__result--${success ? 'success' : 'failure'}`,
    });
    $('<span>', {
        class: 'smoke-test__icon',
        'aria-hidden': 'true',
        text: success ? '✓' : '×',
    }).appendTo($item);
    $('<strong>', { text: name }).appendTo($item);
    $('<span>', { class: 'smoke-test__detail', text: detail }).appendTo($item);
    $('[data-test-results]').append($item);
}

async function step(name, operation) {
    try {
        const detail = await operation();
        addResult(name, true, detail || 'OK');
    } catch (error) {
        addResult(name, false, error.message);
        throw error;
    }
}

async function runSmokeTest() {
    const $button = $('[data-action="run-smoke-test"]');
    const $summary = $('[data-test-summary]');
    const repositories = [];

    $button.prop('disabled', true).attr('aria-busy', 'true');
    $('[data-test-results]').empty();
    $summary
        .removeClass('smoke-test__summary--success smoke-test__summary--failure')
        .text('Выполняется проверка…');

    let createdId;
    let assetId;
    let duplicateId;

    try {
        await step('Доступность browser API', async () => {
            assert(IndexedDbMoodboardRepository.isSupported(), 'IndexedDB недоступна.');
            assert(typeof crypto.randomUUID === 'function', 'crypto.randomUUID() недоступен.');
            await deleteDatabase(testDatabaseName);
            return 'IndexedDB и UUID доступны';
        });

        const repositoryV1 = new IndexedDbMoodboardRepository({
            databaseName: testDatabaseName,
            version: 1,
        });
        repositories.push(repositoryV1);

        await step('create() и модель документа', async () => {
            const documentData = createMoodboardDocument();
            const created = await repositoryV1.create({ title: 'Smoke test', document: documentData });
            createdId = created.id;
            assert(created.archivedAt === null, 'Новая доска не должна находиться в архиве.');
            assert(created.revision === 0, 'Начальная ревизия должна быть равна 0.');
            assert(created.document.schemaVersion === 2, 'Новый документ должен использовать schemaVersion 2.');
            assert(created.document.pages[0].canvas.width === 1600, 'Некорректная ширина холста.');

            created.title = 'Изменённая внешняя копия';
            created.document.pages[0].canvas.width = 1;
            const untouched = await repositoryV1.get(createdId);
            assert(untouched.title === 'Smoke test', 'Repository вернул изменяемую внутреннюю ссылку.');
            assert(untouched.document.pages[0].canvas.width === 1600, 'Документ в хранилище изменился через внешнюю ссылку.');
            return `ID ${createdId}`;
        });

        await repositoryV1.close();

        const repository = new IndexedDbMoodboardRepository({
            databaseName: testDatabaseName,
            version: 2,
        });
        repositories.push(repository);

        await step('Перезагрузка и обновление схемы', async () => {
            const database = await repository.open();
            assert(database.objectStoreNames.contains('moodboards'), 'Нет хранилища moodboards.');
            assert(database.objectStoreNames.contains('assets'), 'Нет хранилища assets.');
            const persisted = await repository.get(createdId);
            assert(persisted?.title === 'Smoke test', 'Запись не сохранилась после повторного открытия базы.');
            return 'Данные сохранены при переходе с версии 1 на 2';
        });

        await step('list(), get() и updateMeta()', async () => {
            const listed = await repository.list();
            assert(listed.length === 1 && listed[0].id === createdId, 'list() вернул неверные данные.');
            const updated = await repository.updateMeta(createdId, { title: 'Обновлённый MoodBoard' });
            assert(updated.title === 'Обновлённый MoodBoard', 'Название не обновилось.');
            const fetched = await repository.get(createdId);
            assert(fetched.title === 'Обновлённый MoodBoard', 'get() не вернул обновлённую запись.');
            return 'CRUD метаданных работает';
        });

        await step('Архивирование и восстановление', async () => {
            const archived = await repository.setArchived(createdId, true);
            assert(typeof archived.archivedAt === 'string', 'Дата архивирования не установлена.');
            assert(!Number.isNaN(Date.parse(archived.archivedAt)), 'Дата архивирования некорректна.');

            const persisted = await repository.get(createdId);
            assert(persisted.archivedAt === archived.archivedAt, 'Статус архива не сохранился.');

            let archivedError = null;
            try {
                await repository.updateMeta(createdId, { title: 'Нельзя переименовать' });
            } catch (error) {
                archivedError = error;
            }
            assert(archivedError?.code === 'MOODBOARD_ARCHIVED', 'Архивная доска осталась доступна для редактирования.');

            const restored = await repository.setArchived(createdId, false);
            assert(restored.archivedAt === null, 'Доска не восстановлена из архива.');
            return 'Статус сохраняется, редактирование блокируется, восстановление работает';
        });

        await step('Пустая и повреждённая запись', async () => {
            const empty = await repository.create({ title: 'Пустая доска' });
            const persistedEmpty = await repository.get(empty.id);
            assert(persistedEmpty.document.pages[0].elements.length === 0, 'Корректная пустая доска не читается.');
            assert(await repository.delete(empty.id), 'Тестовая пустая доска не удалена.');

            const legacy = await repository.create({
                title: 'Legacy schema',
                document: {
                    schemaVersion: 1,
                    canvas: { width: 1600, height: 1000, background: '#ffffff' },
                    elements: [],
                },
            });
            assert(
                legacy.document.schemaVersion === 2 && legacy.document.pages.length === 1,
                'Документ schemaVersion 1 не мигрировал в один лист schemaVersion 2.',
            );
            assert(await repository.delete(legacy.id), 'Legacy-тестовая доска не удалена.');

            const corruptId = 'corrupt-record';
            await putRawMoodboard(repository, {
                id: corruptId,
                title: '',
                document: null,
                revision: 'broken',
                createdAt: '',
                updatedAt: '',
            });
            let getError = null;
            let listError = null;
            try {
                await repository.get(corruptId);
            } catch (error) {
                getError = error;
            }
            try {
                await repository.list();
            } catch (error) {
                listError = error;
            }
            assert(getError?.code === 'CORRUPT_RECORD', 'get() не распознал повреждённую запись.');
            assert(listError?.code === 'CORRUPT_RECORD', 'list() не распознал повреждённую запись.');
            assert(await repository.delete(corruptId), 'Повреждённую запись нельзя безопасно удалить.');
            return 'Пустая доска поддерживается, повреждение имеет код CORRUPT_RECORD';
        });

        await step('Autosave после быстрых операций', async () => {
            await testRapidAutosave();
            return 'Сохраняется последний снимок, параллельные записи не запускаются';
        });

        const imageBlob = await createPngBlob();
        await step('addAsset() и getAsset()', async () => {
            const asset = await repository.addAsset(createdId, imageBlob);
            assetId = asset.id;
            assert(asset.width === 3 && asset.height === 2, 'Неверно определены размеры изображения.');
            const storedAsset = await repository.getAsset(assetId);
            assert(storedAsset?.blob instanceof Blob, 'Blob изображения не прочитан из IndexedDB.');
            assert(storedAsset.blob.type === 'image/png', 'MIME-тип изображения не сохранился.');
            return `${storedAsset.width}×${storedAsset.height}, ${storedAsset.blob.size} байт`;
        });

        await step('saveContent() и контроль ревизий', async () => {
            const documentData = createMoodboardDocument({
                pages: [
                    createMoodboardPage({
                        id: 'page-1',
                        name: 'Лист 1',
                        elements: [{ id: 'image-1', type: 'image', assetId }],
                    }),
                    createMoodboardPage({
                        id: 'page-2',
                        name: 'Материалы',
                        elements: [{ id: 'text-2', type: 'text', text: 'Второй лист' }],
                    }),
                ],
            });
            const saved = await repository.saveContent(createdId, documentData, 0);
            assert(saved.revision === 1, 'Ревизия не увеличилась после сохранения.');

            let conflict = null;
            try {
                await repository.saveContent(createdId, documentData, 0);
            } catch (error) {
                conflict = error;
            }
            assert(conflict instanceof RevisionConflictError, 'Устаревшая ревизия не вызвала конфликт.');

            const afterConflict = await repository.get(createdId);
            assert(afterConflict.revision === 1, 'Конфликт оставил частично изменённую запись.');
            await repository.updateMeta(createdId, { title: 'После конфликта' });
            return 'Атомарное сохранение, revision 1';
        });

        await step('savePreview()', async () => {
            const updated = await repository.savePreview(createdId, imageBlob);
            assert(updated.previewBlob instanceof Blob, 'Blob превью не сохранился.');
            const persisted = await repository.get(createdId);
            assert(persisted.previewBlob?.type === 'image/png', 'Превью не читается из MoodBoard.');
            return `${persisted.previewBlob.size} байт`;
        });

        await step('duplicate()', async () => {
            const duplicate = await repository.duplicate(createdId);
            duplicateId = duplicate.id;
            assert(duplicate.id !== createdId, 'Дубликат получил исходный ID.');
            assert(duplicate.revision === 0, 'Дубликат должен начинаться с ревизии 0.');
            assert(duplicate.archivedAt === null, 'Дубликат должен создаваться активным.');
            assert(duplicate.previewBlob instanceof Blob, 'Превью не скопировано.');
            assert(duplicate.document.pages.length === 2, 'Листы документа не скопированы.');

            const copiedAssetId = duplicate.document.pages[0].elements[0].assetId;
            assert(copiedAssetId !== assetId, 'Дубликат ссылается на исходный asset.');
            const copiedAsset = await repository.getAsset(copiedAssetId);
            assert(copiedAsset?.moodboardId === duplicateId, 'Ассет дубликата не создан.');
            return `Новая запись ${duplicateId}`;
        });

        await step('savePreview(null)', async () => {
            const updated = await repository.savePreview(createdId, null);
            assert(updated.previewBlob === null, 'Превью не очищено в возвращённой записи.');
            const persisted = await repository.get(createdId);
            assert(persisted.previewBlob === null, 'Очищенное превью осталось в MoodBoard.');
            return 'Дефолтное превью восстановлено';
        });

        await step('Валидация без незавершённых транзакций', async () => {
            let validationFailed = false;
            try {
                await repository.create({
                    title: 'Некорректный документ',
                    document: { schemaVersion: 1, canvas: {}, elements: 'not-an-array' },
                });
            } catch (_) {
                validationFailed = true;
            }
            assert(validationFailed, 'Некорректный документ был принят.');
            const records = await repository.list();
            assert(records.length === 2, 'Ошибка валидации оставила частичную запись.');
            return 'После ошибки repository продолжает работу';
        });

        await step('Отсутствующий asset и каскадное удаление', async () => {
            assert(await repository.deleteAsset(assetId), 'Исходный asset не удалён.');
            assert(await repository.getAsset(assetId) === null, 'Удалённый asset всё ещё доступен.');
            const withMissingAsset = await repository.get(createdId);
            assert(
                withMissingAsset.document.pages[0].elements[0]?.assetId === assetId,
                'Документ должен сохранять ссылку, чтобы редактор показал понятную ошибку отсутствующего asset.',
            );
            assert(await repository.delete(createdId), 'Исходный MoodBoard не удалён.');

            const duplicate = await repository.get(duplicateId);
            const duplicateAssetId = duplicate.document.pages[0].elements[0].assetId;
            assert(await repository.delete(duplicateId), 'Дубликат не удалён.');
            assert(await repository.getAsset(duplicateAssetId) === null, 'Каскадное удаление asset не сработало.');
            assert((await repository.list()).length === 0, 'После удаления остались записи.');
            return 'CRUD и каскадное удаление работают';
        });

        $summary
            .addClass('smoke-test__summary--success')
            .text('Все проверки успешно выполнены.');
    } catch (error) {
        $summary
            .addClass('smoke-test__summary--failure')
            .text(`Проверка остановлена: ${error.message}`);
    } finally {
        for (const repository of repositories) {
            await repository.close();
        }
        try {
            await deleteDatabase(testDatabaseName);
        } catch (_) {
            // Результат очистки не меняет результат проверяемых операций.
        }
        $button.prop('disabled', false).removeAttr('aria-busy');
    }
}

$(() => {
    $('[data-action="run-smoke-test"]')
        .off('click.repositorySmokeTest')
        .on('click.repositorySmokeTest', runSmokeTest);
    runSmokeTest();
});
