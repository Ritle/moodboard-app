import { defineConfig, devices } from '@playwright/test';

const port = Number.parseInt(process.env.MOODBOARDS_E2E_PORT || '4173', 10);
const baseURL = `http://127.0.0.1:${port}/moodboards/`;

export default defineConfig({
    testDir: './e2e',
    outputDir: './test-results/e2e',
    globalSetup: './e2e/global-setup.mjs',
    fullyParallel: false,
    workers: 1,
    timeout: 45_000,
    expect: {
        timeout: 10_000,
    },
    reporter: [
        ['list'],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ],
    use: {
        baseURL,
        viewport: { width: 1440, height: 900 },
        acceptDownloads: true,
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
        video: 'retain-on-failure',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'], video: 'off' },
        },
        {
            name: 'chrome',
            use: { ...devices['Desktop Chrome'], channel: 'chrome' },
        },
        {
            name: 'edge',
            use: { ...devices['Desktop Edge'], channel: 'msedge' },
        },
    ],
});
