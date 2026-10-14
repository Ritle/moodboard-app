import {
    createBoard,
    expect,
    test,
} from './fixtures.mjs';

async function getCanvasPixelRatios(page) {
    return page.locator('[data-role="canvas-container"] canvas').evaluateAll((canvases) => (
        canvases
            .map((canvas) => {
                const rect = canvas.getBoundingClientRect();
                return rect.width > 0 ? canvas.width / rect.width : 0;
            })
            .filter((ratio) => ratio > 0)
    ));
}

test.skip(({ browserName }) => browserName !== 'chromium', 'Dynamic device metrics are exposed through CDP.');

test('canvas updates its backing resolution after browser zoom', async ({ page }) => {
    await createBoard(page);

    const viewport = page.viewportSize();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: 2,
        mobile: false,
    });

    await expect.poll(() => page.evaluate(() => window.devicePixelRatio)).toBe(2);
    await expect.poll(async () => {
        const ratios = await getCanvasPixelRatios(page);
        return ratios.length > 0 && ratios.every((ratio) => ratio >= 1.99);
    }).toBe(true);

    await cdp.send('Emulation.clearDeviceMetricsOverride');
});
