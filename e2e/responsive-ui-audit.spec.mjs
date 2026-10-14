import {
    canvasBox,
    createBoard,
    drawRectangle,
    expect,
    test,
    waitForElementCount,
} from './fixtures.mjs';

const widths = [500, 1024, 1280, 1440, 1920];
const viewportHeight = 900;

function colorChannels(value) {
    const match = String(value || '').match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/i);
    return match ? match.slice(1, 4).map(Number) : null;
}

function relativeLuminance(channels) {
    const normalized = channels.map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return normalized[0] * 0.2126 + normalized[1] * 0.7152 + normalized[2] * 0.0722;
}

function contrastRatio(foreground, background) {
    const fg = colorChannels(foreground);
    const bg = colorChannels(background);
    if (!fg || !bg) {
        return 0;
    }
    const first = relativeLuminance(fg);
    const second = relativeLuminance(bg);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

async function expectInsideViewport(locator, label) {
    await expect(locator, `${label} должен быть видим`).toBeVisible();
    const box = await locator.boundingBox();
    expect(box, `${label}: bounding box отсутствует`).not.toBeNull();
    const viewport = locator.page().viewportSize();
    expect.soft(box.x, `${label} выходит за левую границу`).toBeGreaterThanOrEqual(-1);
    expect.soft(box.y, `${label} выходит за верхнюю границу`).toBeGreaterThanOrEqual(-1);
    expect.soft(box.x + box.width, `${label} выходит за правую границу`).toBeLessThanOrEqual(viewport.width + 1);
    expect.soft(box.y + box.height, `${label} выходит за нижнюю границу`).toBeLessThanOrEqual(viewport.height + 1);
}

async function expectNoOwnOverflow(locator, label) {
    const dimensions = await locator.evaluate((element) => ({
        clientWidth: element.clientWidth,
        clientHeight: element.clientHeight,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight,
        overflowX: getComputedStyle(element).overflowX,
        overflowY: getComputedStyle(element).overflowY,
    }));
    expect.soft(
        dimensions.scrollWidth - dimensions.clientWidth,
        `${label}: горизонтальное переполнение ${JSON.stringify(dimensions)}`,
    ).toBeLessThanOrEqual(1);
}

async function expectVisibleControlsInside(locator, label) {
    const result = await locator.evaluate((root) => {
        const rootRect = root.getBoundingClientRect();
        const controls = [...root.querySelectorAll('button, input, select, textarea, [role="button"], [role="menuitem"]')]
            .filter((element) => {
                const style = getComputedStyle(element);
                return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
            })
            .map((element) => {
                const box = element.getBoundingClientRect();
                return {
                    label: element.getAttribute('aria-label') || element.textContent.trim().slice(0, 60),
                    left: box.left,
                    right: box.right,
                    top: box.top,
                    bottom: box.bottom,
                };
            });
        return {
            root: { left: rootRect.left, right: rootRect.right, top: rootRect.top, bottom: rootRect.bottom },
            outside: controls.filter((control) => (
                control.left < rootRect.left - 1
                || control.right > rootRect.right + 1
                || control.top < rootRect.top - 1
                || control.bottom > rootRect.bottom + 1
            )),
        };
    });
    expect.soft(result.outside, `${label}: контролы выходят за контейнер ${JSON.stringify(result)}`).toEqual([]);
}

async function rect(locator) {
    const box = await locator.boundingBox();
    expect(box).not.toBeNull();
    return box;
}

function expectStableRect(before, after, label, tolerance = 1) {
    for (const key of ['x', 'y', 'width', 'height']) {
        expect.soft(
            Math.abs(before[key] - after[key]),
            `${label}: ${key} сместился с ${before[key]} до ${after[key]}`,
        ).toBeLessThanOrEqual(tolerance);
    }
}

function overlapArea(first, second) {
    const width = Math.max(0, Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x));
    const height = Math.max(0, Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y));
    return width * height;
}

async function attachScreenshot(page, name) {
    await test.info().attach(name, {
        body: await page.screenshot({ fullPage: false }),
        contentType: 'image/png',
    });
}

async function clickForAudit(locator, width) {
    if (width === 500) {
        await locator.evaluate((element) => element.click());
        return;
    }
    await locator.click();
}

for (const width of widths) {
    test(`responsive UI ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: viewportHeight });
        await page.addInitScript(() => {
            window.__moodboardsLayoutShifts = [];
            if (typeof PerformanceObserver !== 'function') {
                return;
            }
            try {
                const observer = new PerformanceObserver((list) => {
                    for (const entry of list.getEntries()) {
                        if (!entry.hadRecentInput) {
                            window.__moodboardsLayoutShifts.push(entry.value);
                        }
                    }
                });
                observer.observe({ type: 'layout-shift', buffered: true });
            } catch (_) {
                // Firefox does not expose LayoutShift entries; geometric assertions remain active.
            }
        });

        const boardId = await createBoard(page);
        const shell = page.locator('.editor-shell');
        const topbar = page.locator('.editor-topbar');
        const topbarActions = page.locator('.editor-topbar__actions');
        const canvasShell = page.locator('[data-role="canvas-shell"]');
        const actionPanel = page.locator('.action-panel');

        await expect(page.locator('.viewport-warning')).toBeHidden();
        await expectInsideViewport(topbar, 'Top bar');
        await expectInsideViewport(actionPanel, 'Action Panel');
        await expectNoOwnOverflow(topbar, 'Top bar');
        await expectNoOwnOverflow(actionPanel, 'Action Panel');
        await expectVisibleControlsInside(actionPanel, 'Action Panel');
        expect.soft(
            overlapArea(await rect(page.locator('.editor-topbar__start')), await rect(topbarActions)),
            'Левая и правая группы Top bar перекрываются',
        ).toBe(0);
        const documentOverflow = await page.evaluate(() => ({
            html: document.documentElement.scrollWidth - window.innerWidth,
            body: document.body.scrollWidth - window.innerWidth,
        }));
        expect.soft(documentOverflow.html, 'Страница имеет горизонтальный scroll').toBeLessThanOrEqual(1);
        expect.soft(documentOverflow.body, 'Body имеет горизонтальный scroll').toBeLessThanOrEqual(1);

        const stableActions = await rect(topbarActions);
        const stableCanvas = await rect(canvasShell);
        await expect(page.locator('[data-action="undo"]')).toBeDisabled();
        await expect(page.locator('[data-action="redo"]')).toBeDisabled();

        const settingsTrigger = page.locator('[data-action="toggle-settings"]');
        await clickForAudit(settingsTrigger, width);
        const settingsPopover = page.locator('[data-role="settings-popover"]');
        await expectInsideViewport(settingsPopover, 'Настройки');
        await expectNoOwnOverflow(settingsPopover, 'Настройки');
        const projectName = page.locator('[data-role="project-name"]');
        const longProjectName = `Очень длинное название проекта ${'интерьер '.repeat(24)}`.slice(0, 160);
        await projectName.fill(longProjectName);
        await projectName.press('Enter');
        await expect(page.locator('[data-role="document-title"]')).toHaveText(longProjectName);
        await expect(page.locator('[data-role="save-status"]')).toHaveAttribute('data-status', 'saved');
        await clickForAudit(settingsTrigger, width);
        expectStableRect(stableActions, await rect(topbarActions), 'Top bar actions после переименования');
        expectStableRect(stableCanvas, await rect(canvasShell), 'Canvas после переименования');

        const pageTrigger = page.locator('[data-action="toggle-pages"]');
        await clickForAudit(pageTrigger, width);
        const pagesPopover = page.locator('[data-role="pages-popover"]');
        await expectInsideViewport(pagesPopover, 'Список листов');
        const renamePage = page.getByRole('button', { name: 'Переименовать лист «Лист 1»' });
        await renamePage.click();
        const pageName = page.getByRole('textbox', { name: 'Новое название листа «Лист 1»' });
        const longPageName = `Длинное название листа ${'планировка '.repeat(12)}`.slice(0, 80);
        await pageName.fill(longPageName);
        await pageName.press('Enter');
        await expect(page.locator('[data-role="active-page-name"]')).toHaveText(longPageName);
        await expectNoOwnOverflow(pageTrigger, 'Кнопка листов с длинным названием');
        await clickForAudit(pageTrigger, width);
        expectStableRect(stableActions, await rect(topbarActions), 'Top bar actions после имени листа');

        const exportTrigger = page.locator('[data-action="toggle-export"]');
        await clickForAudit(exportTrigger, width);
        const exportMenu = page.locator('[data-role="export-menu"]');
        await expectInsideViewport(exportMenu, 'Меню экспорта');
        await expectNoOwnOverflow(exportMenu, 'Меню экспорта');
        await clickForAudit(exportTrigger, width);

        await page.getByRole('button', { name: 'Открыть набор фигур' }).click();
        const shapesPopover = page.locator('[data-role="action-popover"][data-action-popover-panel="shapes"]');
        await expectInsideViewport(shapesPopover, 'Popover фигур');
        await page.getByRole('button', { name: 'Открыть набор фигур' }).click();
        await drawRectangle(page, { x: 0.34, y: 0.32 }, { x: 0.58, y: 0.57 });
        await waitForElementCount(page, boardId, 1);
        await expect(page.locator('[data-action="undo"]')).toBeEnabled();
        await expect(page.locator('[data-action="redo"]')).toBeDisabled();

        const toolbar = page.locator('[data-role="contextual-toolbar"]');
        await expectInsideViewport(toolbar, 'Контекстный toolbar');
        await expectVisibleControlsInside(toolbar, 'Контекстный toolbar');
        const moreTrigger = page.locator('[data-role="contextual-more-trigger"]');
        await moreTrigger.click();
        const moreMenu = page.locator('[data-role="contextual-more-menu"]');
        await expectInsideViewport(moreMenu, 'Дополнительные инструменты');
        await expectNoOwnOverflow(moreMenu, 'Дополнительные инструменты');
        await moreTrigger.click();

        const layerTrigger = page.locator('[data-action="toggle-layer-map"]');
        await clickForAudit(layerTrigger, width);
        const layerMap = page.locator('[data-role="layer-map-popover"]');
        await expectInsideViewport(layerMap, 'Карта слоёв');
        await expectNoOwnOverflow(layerMap, 'Карта слоёв');
        await expect(layerMap.locator('[data-layer-node-id]')).toHaveCount(1);
        await page.locator('[data-action="toggle-layer-map-navigation"]').click();
        const layerNavigation = page.locator('[data-role="layer-map-navigation"]');
        await expect(layerNavigation).toBeVisible();
        const layerSearch = page.locator('[data-role="layer-map-search"]');
        await layerSearch.focus();
        await expect(layerSearch).toBeFocused();
        const searchFocusStyle = await layerSearch.evaluate((element) => ({
            inputOutline: getComputedStyle(element).outlineStyle,
            inputShadow: getComputedStyle(element).boxShadow,
            wrapperBorder: getComputedStyle(element.closest('.layer-map__search')).borderColor,
        }));
        expect(searchFocusStyle.inputOutline).toBe('none');
        expect(searchFocusStyle.inputShadow).toBe('none');
        expect(searchFocusStyle.wrapperBorder).not.toBe('rgb(223, 223, 223)');
        await attachScreenshot(page, `${test.info().project.name}-${width}-light`);

        if (width === 500) {
            await layerTrigger.focus();
            await page.keyboard.press('Tab');
            await page.keyboard.press('Shift+Tab');
        } else {
            await layerTrigger.hover();
        }
        await expect.poll(() => layerTrigger.evaluate((element) => (
            Number(getComputedStyle(element, '::after').opacity)
        ))).toBeGreaterThan(0.9);
        const tooltip = await layerTrigger.evaluate((element) => {
            const style = getComputedStyle(element, '::after');
            return { content: style.content, opacity: style.opacity, color: style.color, background: style.backgroundColor };
        });
        expect(tooltip.content).not.toBe('none');
        expect(contrastRatio(tooltip.color, tooltip.background), 'Контраст tooltip').toBeGreaterThanOrEqual(4.5);

        await clickForAudit(settingsTrigger, width);
        const darkMode = page.locator('[data-setting="darkMode"]');
        await darkMode.check();
        await expect(shell).toHaveClass(/editor-shell--dark/);
        await page.waitForTimeout(250);
        const darkStyles = await page.evaluate(() => {
            const read = (selector) => {
                const element = document.querySelector(selector);
                const style = getComputedStyle(element);
                return { color: style.color, background: style.backgroundColor };
            };
            return {
                topbarControl: read('.page-switcher__trigger'),
                settings: read('[data-role="settings-popover"]'),
                toolbar: read('[data-role="contextual-toolbar"]'),
                layerMap: read('[data-role="layer-map-popover"]'),
            };
        });
        for (const [name, colors] of Object.entries(darkStyles)) {
            expect.soft(colors.background, `${name} остался прозрачным/неопределённым`).not.toBe('rgba(0, 0, 0, 0)');
            expect.soft(
                contrastRatio(colors.color, colors.background),
                `Контраст ${name} в dark mode: ${JSON.stringify(colors)}`,
            ).toBeGreaterThanOrEqual(4.5);
        }
        await expectInsideViewport(settingsPopover, 'Настройки в dark mode');
        expect.soft(
            overlapArea(await rect(settingsPopover), await rect(layerMap)),
            'Настройки перекрывают карту слоёв',
        ).toBe(0);
        await clickForAudit(settingsTrigger, width);
        await expectInsideViewport(layerMap, 'Карта слоёв в dark mode');
        await expectInsideViewport(toolbar, 'Toolbar в dark mode');
        await attachScreenshot(page, `${test.info().project.name}-${width}-dark`);

        await clickForAudit(layerTrigger, width);
        await settingsTrigger.focus();
        await page.keyboard.press('Tab');
        await page.keyboard.press('Shift+Tab');
        const focusState = await settingsTrigger.evaluate((element) => {
            const style = getComputedStyle(element);
            return {
                focusVisible: element.matches(':focus-visible'),
                outline: style.outlineStyle,
                shadow: style.boxShadow,
            };
        });
        expect(focusState.focusVisible, 'Настройки не получают :focus-visible').toBe(true);
        expect(
            focusState.outline !== 'none' || focusState.shadow !== 'none',
            'У focus-visible отсутствует визуальный индикатор',
        ).toBe(true);

        expectStableRect(stableActions, await rect(topbarActions), 'Top bar actions после всех состояний');
        expectStableRect(stableCanvas, await rect(canvasShell), 'Canvas после всех состояний');
        const cumulativeShift = await page.evaluate(() => (
            Array.isArray(window.__moodboardsLayoutShifts)
                ? window.__moodboardsLayoutShifts.reduce((sum, value) => sum + value, 0)
                : 0
        ));
        expect.soft(cumulativeShift, 'Накопленный layout shift выше допустимого').toBeLessThanOrEqual(0.1);
    });
}
