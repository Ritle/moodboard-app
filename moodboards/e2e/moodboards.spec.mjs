import { readFile } from 'node:fs/promises';

import {
    canvasBox,
    createBoard,
    downloadFromExport,
    drawRectangle,
    expect,
    getBoardRecord,
    openIndex,
    pointIn,
    test,
    uploadTestImage,
    waitForEditor,
    waitForElementCount,
} from './fixtures.mjs';

test('создание доски, возврат в список и повторное открытие', async ({ page }) => {
    const boardId = await createBoard(page);
    await expect(page.locator('[data-role="document-title"]')).toHaveText('Новый проект 1');

    await page.locator('.editor-topbar__logo').click();
    await page.waitForURL(/index\.php/);
    const boardLink = page.getByRole('link', { name: /Открыть мудборд «Новый проект 1»/ });
    await expect(boardLink).toBeVisible();
    await boardLink.click();

    await page.waitForURL(new RegExp(`editor\\.php\\?id=${boardId}`));
    await waitForEditor(page);
});

test('создание, переименование, копирование и удаление листа', async ({ page }) => {
    const boardId = await createBoard(page);
    await page.getByRole('button', { name: /Текущий лист: Лист 1/ }).click();
    await page.getByRole('button', { name: 'Создать новый лист' }).click();
    await expect(page.locator('[data-role="active-page-name"]')).toHaveText('Лист 2');

    await page.getByRole('button', { name: /Текущий лист: Лист 2/ }).click();
    await page.getByRole('button', { name: 'Переименовать лист «Лист 2»' }).click();
    const renameInput = page.getByRole('textbox', { name: 'Новое название листа «Лист 2»' });
    await renameInput.fill('Коллаж');
    await renameInput.press('Enter');
    await expect(page.locator('[data-role="active-page-name"]')).toHaveText('Коллаж');

    if (await page.locator('[data-role="pages-popover"]').isHidden()) {
        await page.locator('[data-action="toggle-pages"]').click();
    }
    await page.getByRole('button', { name: 'Копировать лист «Коллаж»' }).click();
    await expect(page.locator('[data-role="active-page-name"]')).toHaveText('Коллаж — копия');
    await page.getByRole('button', { name: /Текущий лист: Коллаж — копия/ }).click();
    await page.getByRole('button', { name: 'Удалить лист «Коллаж — копия»' }).click();
    await page.locator('[data-action="confirm-delete-page"]').click();

    await expect.poll(async () => (await getBoardRecord(page, boardId))?.document.pages.length).toBe(2);
});

test('загрузка PNG создаёт изображение и сохраняет assetId', async ({ page }) => {
    const boardId = await createBoard(page);
    await uploadTestImage(page);
    await waitForElementCount(page, boardId, 1);

    const record = await getBoardRecord(page, boardId);
    const [image] = record.document.pages[0].elements;
    expect(image.type).toBe('image');
    expect(image.assetId).toBeTruthy();
    expect(image.width).toBeGreaterThan(0);
    expect(image.height).toBeGreaterThan(0);
});

test('resize и перемещение множественного выделения меняют всю группу', async ({ page }) => {
    const boardId = await createBoard(page);
    const first = await drawRectangle(page, { x: 0.28, y: 0.35 }, { x: 0.37, y: 0.48 });
    await waitForElementCount(page, boardId, 1);

    await page.mouse.move(first.end.x, first.end.y);
    await page.mouse.down();
    await page.mouse.move(first.end.x + 45, first.end.y + 30, { steps: 5 });
    await page.mouse.up();
    await drawRectangle(page, { x: 0.52, y: 0.42 }, { x: 0.62, y: 0.54 });
    await waitForElementCount(page, boardId, 2);

    const before = await getBoardRecord(page, boardId);
    const beforeElements = before.document.pages[0].elements;
    expect(beforeElements[0].width).toBeGreaterThan(100);

    await page.keyboard.press('Control+A');
    await expect(page.locator('[data-role="selected-type"]')).toContainText('2');
    const dragStart = pointIn(await canvasBox(page), 0.46, 0.46);
    await page.mouse.move(dragStart.x, dragStart.y);
    await page.mouse.down();
    await page.mouse.move(dragStart.x + 70, dragStart.y + 45, { steps: 8 });
    await page.mouse.up();

    await expect.poll(async () => (await getBoardRecord(page, boardId))?.revision).toBeGreaterThan(before.revision);
    const after = await getBoardRecord(page, boardId);
    const afterElements = after.document.pages[0].elements;
    const deltas = afterElements.map((element, index) => ({
        x: element.x - beforeElements[index].x,
        y: element.y - beforeElements[index].y,
    }));
    expect(Math.abs(deltas[0].x)).toBeGreaterThan(1);
    expect(Math.abs(deltas[0].x - deltas[1].x)).toBeLessThan(0.5);
    expect(Math.abs(deltas[0].y - deltas[1].y)).toBeLessThan(0.5);
});

test('undo и redo восстанавливают состояние активного листа', async ({ page }) => {
    const boardId = await createBoard(page);
    await drawRectangle(page, { x: 0.35, y: 0.35 }, { x: 0.46, y: 0.5 });
    await waitForElementCount(page, boardId, 1);

    await page.keyboard.press('Control+Z');
    await waitForElementCount(page, boardId, 0);
    await page.keyboard.press('Control+Shift+Z');
    await waitForElementCount(page, boardId, 1);
});

test('autosave переживает reload редактора', async ({ page }) => {
    const boardId = await createBoard(page);
    await drawRectangle(page, { x: 0.4, y: 0.38 }, { x: 0.53, y: 0.53 });
    await waitForElementCount(page, boardId, 1);
    await expect(page.locator('[data-role="save-status"]')).toHaveAttribute('data-status', 'saved');

    await page.reload();
    await waitForEditor(page);
    const record = await getBoardRecord(page, boardId);
    expect(record.document.pages[0].elements).toHaveLength(1);
    await expect(page.locator('[data-role="contextual-toolbar"]')).toBeHidden();
});

test('экспорт активного листа создаёт валидные PNG и PDF', async ({ page }) => {
    const boardId = await createBoard(page);
    await drawRectangle(page, { x: 0.32, y: 0.33 }, { x: 0.5, y: 0.55 });
    await waitForElementCount(page, boardId, 1);

    const png = await downloadFromExport(page, 'png');
    const pngBytes = await readFile(await png.path());
    expect(png.suggestedFilename()).toMatch(/\.png$/i);
    expect(pngBytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');

    const pdf = await downloadFromExport(page, 'pdf');
    const pdfBytes = await readFile(await pdf.path());
    expect(pdf.suggestedFilename()).toMatch(/\.pdf$/i);
    expect(pdfBytes.subarray(0, 5).toString()).toBe('%PDF-');
});

test('публичный просмотр остаётся read-only и разрешает экспорт', async ({ page }) => {
    const boardId = await createBoard(page);
    await drawRectangle(page, { x: 0.36, y: 0.35 }, { x: 0.5, y: 0.52 });
    await waitForElementCount(page, boardId, 1);

    await page.goto(`view.php?token=${encodeURIComponent(boardId)}&mock_tariff=pro`);
    await expect(page.locator('[data-role="viewer-canvas-shell"]')).toBeVisible();
    await expect(page.locator('[data-role="viewer-title"]')).toHaveText('Новый проект 1');
    await expect(page.getByRole('button', { name: 'Выбрать формат экспорта' })).toBeEnabled();
    await expect(page.locator('[data-role="viewer-zoom-value"]')).toBeVisible();
    await expect(page.locator('.action-panel')).toHaveCount(0);

    await page.getByRole('button', { name: 'Выбрать формат экспорта' }).click();
    await expect(page.getByRole('menuitem', { name: /Экспорт в PNG/ })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Экспорт в PDF/ })).toBeVisible();
});

test('ручной ластик записывает маску изображения и поддерживает undo', async ({ page }) => {
    const boardId = await createBoard(page);
    await uploadTestImage(page);
    await waitForElementCount(page, boardId, 1);

    const imageToolbarActions = await page.locator('[data-object-toolbar="image"] [data-object-action]')
        .evaluateAll((controls) => controls.map((control) => control.dataset.objectAction));
    expect(imageToolbarActions.slice(0, 2)).toEqual(['remove-background', 'toggle-image-eraser']);
    const eraserButton = page.locator('[data-object-action="toggle-image-eraser"]');
    await eraserButton.click();
    const box = await canvasBox(page);
    const start = pointIn(box, 0.5, 0.5);
    const end = pointIn(box, 0.508, 0.505);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    await page.getByRole('button', { name: 'Готово' }).click();

    await expect.poll(async () => {
        const record = await getBoardRecord(page, boardId);
        return record?.document.pages[0].elements[0].eraseMask?.strokes.length || 0;
    }, { timeout: 20_000 }).toBe(1);
    await page.keyboard.press('Control+Z');
    await expect.poll(async () => {
        const record = await getBoardRecord(page, boardId);
        return record?.document.pages[0].elements[0].eraseMask?.strokes.length || 0;
    }, { timeout: 20_000 }).toBe(0);
});

test('экспорт и импорт JSON восстанавливают проект', async ({ page }) => {
    const boardId = await createBoard(page, { mode: true });
    await drawRectangle(page, { x: 0.34, y: 0.34 }, { x: 0.49, y: 0.51 });
    await waitForElementCount(page, boardId, 1);

    const jsonDownloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Экспортировать проект в JSON' }).click();
    const jsonDownload = await jsonDownloadPromise;
    const exported = await readFile(await jsonDownload.path());
    const payload = JSON.parse(exported.toString('utf8'));
    expect(payload.format).toBe('roomplan-moodboard-project');
    expect(payload.project.document.pages[0].elements).toHaveLength(1);

    await page.keyboard.press('Delete');
    await waitForElementCount(page, boardId, 0);
    await page.locator('[data-role="project-json-input"]').setInputFiles({
        name: 'project.json',
        mimeType: 'application/json',
        buffer: exported,
    });
    await expect(page.locator('[data-role="project-json-confirm"]')).toBeVisible();
    await page.getByRole('button', { name: 'Импортировать', exact: true }).click();
    await expect(page.locator('[data-role="notification"]')).toContainText('JSON-проект импортирован');
    await waitForElementCount(page, boardId, 1);
});

test('после рисования стрелки сразу доступны три маркера управления', async ({ page }) => {
    const boardId = await createBoard(page);
    const box = await canvasBox(page);
    await page.getByRole('button', { name: 'Нарисовать стрелку или линию' }).click();
    const start = pointIn(box, 0.3, 0.42);
    const end = pointIn(box, 0.64, 0.56);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    await waitForElementCount(page, boardId, 1);

    await expect.poll(() => page.evaluate(() => (
        (window.Konva?.stages || []).reduce((count, stage) => (
            count + stage.find((node) => node.getAttr('arrowControlHandle') === true).length
        ), 0)
    ))).toBe(3);
});

test('clipping, сетка и перенос объектов между фреймами сохраняются', async ({ page }) => {
    const boardId = await createBoard(page);
    const box = await canvasBox(page);
    const drawFrame = async (startRatio, endRatio) => {
        await page.getByRole('button', { name: 'Нарисовать фрейм' }).click();
        const start = pointIn(box, startRatio.x, startRatio.y);
        const end = pointIn(box, endRatio.x, endRatio.y);
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(end.x, end.y, { steps: 6 });
        await page.mouse.up();
        return { start, end };
    };

    await drawFrame({ x: 0.2, y: 0.26 }, { x: 0.42, y: 0.58 });
    await waitForElementCount(page, boardId, 1);
    const firstFrameId = (await getBoardRecord(page, boardId)).document.pages[0].elements
        .find(({ type }) => type === 'frame').id;

    const shapeBounds = await drawRectangle(page, { x: 0.25, y: 0.35 }, { x: 0.33, y: 0.45 });
    await waitForElementCount(page, boardId, 2);
    await expect.poll(async () => {
        const record = await getBoardRecord(page, boardId);
        return record.document.pages[0].elements.find(({ type }) => type === 'shape')?.frameId;
    }).toBe(firstFrameId);

    await drawFrame({ x: 0.55, y: 0.26 }, { x: 0.78, y: 0.58 });
    await waitForElementCount(page, boardId, 3);
    const secondFrameId = (await getBoardRecord(page, boardId)).document.pages[0].elements
        .filter(({ type }) => type === 'frame')
        .find(({ id }) => id !== firstFrameId).id;

    const frameToolbar = page.locator('[data-object-toolbar="frame"]');
    const frameMoreTrigger = page.locator('[data-role="contextual-more-trigger"]');
    const frameMoreMenu = page.locator('[data-role="contextual-more-menu"]');
    await expect(frameMoreMenu).toBeHidden();
    await frameMoreTrigger.click();
    await expect(frameMoreMenu).toBeVisible();
    await frameMoreMenu.locator('[data-object-property="backgroundColor"]').evaluate((input) => {
        input.focus();
        input.value = '#ffcc88';
        input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await frameMoreMenu.locator('[data-object-property="backgroundOpacity"]').selectOption('0.5');
    await frameMoreMenu.locator('[data-object-property="layoutGridColumns"]').selectOption('4');
    const clipToggle = frameMoreMenu.locator('[data-role="frame-clip-toggle"]');
    await expect(clipToggle).toBeChecked();
    await clipToggle.click();
    await expect(clipToggle).not.toBeChecked();
    await frameMoreTrigger.click();
    await expect(frameMoreMenu).toBeVisible();
    await clipToggle.click();
    await expect(clipToggle).toBeChecked();
    await page.keyboard.press('Escape');
    await expect(frameMoreMenu).toBeHidden();

    const source = {
        x: (shapeBounds.start.x + shapeBounds.end.x) / 2,
        y: (shapeBounds.start.y + shapeBounds.end.y) / 2,
    };
    const target = pointIn(box, 0.66, 0.42);
    await page.mouse.move(source.x, source.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 10 });
    await page.mouse.up();

    await expect.poll(async () => {
        const record = await getBoardRecord(page, boardId);
        const elements = record.document.pages[0].elements;
        const movedShape = elements.find(({ type }) => type === 'shape');
        const frame = elements.find(({ id }) => id === secondFrameId);
        return {
            frameId: movedShape?.frameId,
            frameBeforeShape: elements.indexOf(frame) < elements.indexOf(movedShape),
            backgroundColor: frame?.backgroundColor,
            backgroundOpacity: frame?.backgroundOpacity,
            layoutGridColumns: frame?.layoutGridColumns,
            clipContent: frame?.clipContent,
        };
    }, { timeout: 20_000 }).toEqual({
        frameId: secondFrameId,
        frameBeforeShape: true,
        backgroundColor: '#ffcc88',
        backgroundOpacity: 0.5,
        layoutGridColumns: 4,
        clipContent: true,
    });

    await page.reload();
    await waitForEditor(page);
    const restored = await getBoardRecord(page, boardId);
    expect(restored.document.pages[0].elements.find(({ type }) => type === 'shape').frameId).toBe(secondFrameId);
    expect(restored.document.pages[0].elements.find(({ id }) => id === secondFrameId)).toMatchObject({
        backgroundColor: '#ffcc88',
        backgroundOpacity: 0.5,
        layoutGridColumns: 4,
        clipContent: true,
    });

    const restoredBox = await canvasBox(page);
    const restoredFramePoint = pointIn(restoredBox, 0.76, 0.56);
    await page.mouse.click(restoredFramePoint.x, restoredFramePoint.y);
    await expect(frameToolbar).toBeVisible();
    await frameMoreTrigger.click();
    await expect(frameMoreMenu).toBeVisible();
    await expect(frameMoreMenu.locator('[data-object-property="backgroundOpacity"]')).toHaveValue('0.5');
});
