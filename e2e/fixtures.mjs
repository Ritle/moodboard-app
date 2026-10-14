import { expect, test as base } from '@playwright/test';

export const test = base.extend({
    page: async ({ page }, use) => {
        const errors = [];
        page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
        page.on('console', (message) => {
            if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
                errors.push(`console.error: ${message.text()}`);
            }
        });
        page.on('requestfailed', (request) => {
            const url = new URL(request.url());
            if (url.pathname.startsWith('/moodboards/')) {
                errors.push(`requestfailed: ${url.pathname} — ${request.failure()?.errorText || 'unknown error'}`);
            }
        });
        await use(page);
        expect(errors, 'В браузере не должно быть необработанных JavaScript-ошибок').toEqual([]);
    },
});

export { expect };

export async function openIndex(page) {
    await page.goto('index.php?mock_tariff=pro');
    const passwordInput = page.getByPlaceholder('Пароль');
    if (await passwordInput.isVisible().catch(() => false)) {
        await passwordInput.fill(process.env.MOODBOARDS_DEMO_PASSWORD || 'demo123');
        await Promise.all([
            page.waitForNavigation(),
            page.getByRole('button', { name: 'Войти' }).click(),
        ]);
    }
    const createButton = page.getByRole('button', { name: 'Создать новый мудборд' });
    await expect(createButton).toBeVisible();
    await expect(createButton).toBeEnabled();
}

export async function waitForEditor(page) {
    await expect(page.locator('[data-role="canvas-shell"]')).toBeVisible();
    await expect(page.locator('.canvas-workspace')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('[data-action="toggle-pages"]')).toBeEnabled();
}

export async function createBoard(page, { mode = false } = {}) {
    await openIndex(page);
    await page.getByRole('button', { name: 'Создать новый мудборд' }).click();
    await page.waitForURL(/editor\.php\?id=[^&]+/);
    const boardId = new URL(page.url()).searchParams.get('id');
    expect(boardId).toBeTruthy();
    if (mode) {
        await page.goto(`editor.php?id=${encodeURIComponent(boardId)}&mock_tariff=pro&mode=view`);
    }
    await waitForEditor(page);
    return boardId;
}

export async function getBoardRecord(page, boardId) {
    return page.evaluate(async (id) => {
        const { IndexedDbMoodboardRepository } = await import(
            '/moodboards/assets/js/repositories/indexeddb-moodboard-repository.js'
        );
        const storage = window.MoodboardsConfig.storage;
        const repository = new IndexedDbMoodboardRepository({
            databaseName: storage.databaseName,
            version: storage.version,
        });
        try {
            const record = await repository.get(id);
            if (!record) {
                return null;
            }
            return {
                id: record.id,
                title: record.title,
                revision: record.revision,
                document: record.document,
            };
        } finally {
            await repository.close();
        }
    }, boardId);
}

export async function waitForElementCount(page, boardId, count) {
    await expect.poll(async () => {
        const record = await getBoardRecord(page, boardId);
        const activeName = await page.locator('[data-role="active-page-name"]').textContent();
        const activePage = record?.document.pages.find(({ name }) => name === activeName)
            || record?.document.pages[0];
        return activePage?.elements.length ?? -1;
    }, {
        message: `Ожидалось ${count} элементов на активном листе`,
        timeout: 20_000,
    }).toBe(count);
}

export async function canvasBox(page) {
    const box = await page.locator('[data-role="canvas-container"]').boundingBox();
    expect(box).not.toBeNull();
    return box;
}

export function pointIn(box, xRatio, yRatio) {
    return {
        x: box.x + box.width * xRatio,
        y: box.y + box.height * yRatio,
    };
}

export async function drawRectangle(page, startRatio, endRatio) {
    await page.getByRole('button', { name: 'Открыть набор фигур' }).click();
    await page.getByRole('menuitem', { name: 'Добавить квадрат' }).click();
    const box = await canvasBox(page);
    const start = pointIn(box, startRatio.x, startRatio.y);
    const end = pointIn(box, endRatio.x, endRatio.y);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 6 });
    await page.mouse.up();
    return { start, end };
}

export async function uploadTestImage(page) {
    const encodedPng = await page.evaluate(() => {
        const canvas = document.createElement('canvas');
        canvas.width = 80;
        canvas.height = 60;
        const context = canvas.getContext('2d');
        context.fillStyle = '#3183ff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#ffcd6b';
        context.fillRect(20, 15, 40, 30);
        return canvas.toDataURL('image/png').split(',')[1];
    });
    await page.locator('[data-role="image-input"]').setInputFiles({
        name: 'e2e-image.png',
        mimeType: 'image/png',
        buffer: Buffer.from(encodedPng, 'base64'),
    });
    await expect(page.locator('[data-role="notification"]')).toContainText('Изображение добавлено');
}

export async function downloadFromExport(page, format) {
    const trigger = page.getByRole('button', { name: 'Выбрать формат экспорта' });
    await expect(trigger).toBeEnabled();
    if (await page.locator('[data-role="export-menu"]').isHidden()) {
        await trigger.click();
    }
    const downloadPromise = page.waitForEvent('download');
    await page.locator(`[data-action="export-format"][data-format="${format}"]`).click();
    const download = await downloadPromise;
    await expect(trigger).toBeEnabled();
    return download;
}
