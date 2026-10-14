import { bootstrapPage } from './app-bootstrap.js';
import { requireMoodboardsAccess } from './access/moodboards-access-guard.js';
import { MoodboardsListController } from './moodboards/moodboards-list-controller.js';
import { createMoodboardRepository } from './repositories/repository-factory.js';

const runtime = bootstrapPage('moodboards');

if (runtime !== null) {
    void startMoodboardsPage(runtime);
}

async function startMoodboardsPage(pageRuntime) {
    const root = document.querySelector('[data-page="moodboards"]');
    const accessPolicy = await requireMoodboardsAccess(pageRuntime, root);
    if (accessPolicy === null) {
        return;
    }

    const repository = createMoodboardRepository(pageRuntime.config);
    const controller = new MoodboardsListController({
        $: pageRuntime.$,
        root,
        repository,
        config: pageRuntime.config,
        accessPolicy,
    });

    await controller.init();
}
