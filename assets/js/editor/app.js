import { bootstrapPage } from '../app-bootstrap.js';
import { requireMoodboardsAccess } from '../access/moodboards-access-guard.js';
import { createMoodboardRepository } from '../repositories/repository-factory.js';
import { LocalStorageMoodboardSettingsRepository } from '../settings/moodboard-user-settings-repository.js';
import { EditorApp } from './editor-app.js';

const runtime = bootstrapPage('editor');

if (runtime !== null) {
    void startEditor(runtime);
}

async function startEditor(pageRuntime) {
    const root = document.querySelector('[data-page="editor"]');
    const accessPolicy = await requireMoodboardsAccess(pageRuntime, root);
    if (accessPolicy === null) {
        return;
    }

    const repository = createMoodboardRepository(pageRuntime.config);
    const settingsRepository = new LocalStorageMoodboardSettingsRepository({
        namespace: pageRuntime.config.storage.databaseName,
        userId: accessPolicy.userId,
        legacyStorageKey: `${pageRuntime.config.storage.databaseName}-editor-settings-v1`,
    });
    const editor = new EditorApp({
        ...pageRuntime,
        accessPolicy,
        repository,
        settingsRepository,
        root,
    });

    await editor.init();
}
