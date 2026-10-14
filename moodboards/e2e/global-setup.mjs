import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = resolve(repositoryRoot, '..');
const bundledPhp = resolve(workspaceRoot, '.tools', 'php-8.4.24', 'php.exe');

async function responds(url) {
    try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
        return response.ok;
    } catch (_) {
        return false;
    }
}

async function waitUntilReady(url, child) {
    for (let attempt = 0; attempt < 80; attempt += 1) {
        if (child.exitCode !== null) {
            throw new Error(`PHP E2E-сервер завершился с кодом ${child.exitCode}.`);
        }
        if (await responds(url)) {
            return;
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }
    throw new Error(`PHP E2E-сервер не ответил по адресу ${url}.`);
}

async function stopProcess(child) {
    if (child.exitCode !== null) {
        return;
    }
    if (process.platform === 'win32') {
        await execFileAsync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F']).catch(() => {});
        return;
    }
    child.kill('SIGTERM');
}

export default async function globalSetup() {
    const port = process.env.MOODBOARDS_E2E_PORT || '4173';
    const healthUrl = `http://127.0.0.1:${port}/moodboards/index.php`;
    if (await responds(healthUrl)) {
        return undefined;
    }

    const phpBinary = process.env.MOODBOARDS_PHP_BINARY
        || (existsSync(bundledPhp) ? bundledPhp : 'php');
    const child = spawn(
        phpBinary,
        ['-S', `127.0.0.1:${port}`, '-t', workspaceRoot],
        {
            cwd: workspaceRoot,
            env: process.env,
            stdio: 'ignore',
            windowsHide: true,
        },
    );
    await waitUntilReady(healthUrl, child);
    return async () => stopProcess(child);
}
