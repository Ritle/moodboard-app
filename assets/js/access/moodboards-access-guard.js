import { fetchMoodboardsAccess } from './moodboards-access-service.js';
import { renderMoodboardsAccountControl } from './moodboards-account-control.js';
import {
    BACKGROUND_REMOVAL_PRESET_DEFINITIONS,
    BACKGROUND_REMOVAL_PRESET_IDS,
} from '../background-removal-presets.js';

const TARIFF_LABELS = Object.freeze({
    guest: 'Гостевой режим',
    free: 'Free',
    basic: 'Basic',
    premium: 'Premium',
    pro: 'PRO',
});
const DEMO_TARIFFS = Object.freeze(['pro', 'premium', 'basic', 'free', 'guest']);
const DEMO_PRESETS = BACKGROUND_REMOVAL_PRESET_IDS;
const DEFAULT_DEMO_PRESET = 'preset_0';

export function isMoodboardsDemoMode(search = globalThis.window?.location?.search || '') {
    return new URLSearchParams(search).get('mode') === 'view';
}

export class MoodboardsAccessGuard {
    constructor({
        root,
        endpoint,
        billingUrl,
        loginUrl,
        accountUrl = loginUrl,
        defaultTariff = 'pro',
    }) {
        this.root = root;
        this.endpoint = endpoint;
        this.billingUrl = billingUrl;
        this.loginUrl = loginUrl;
        this.accountUrl = accountUrl;
        this.defaultTariff = DEMO_TARIFFS.includes(defaultTariff) ? defaultTariff : 'pro';
        this.gate = null;
        this.tariffSwitcher = null;
        this.rootWasInert = root?.hasAttribute('inert') ?? false;
    }

    async requireAccess() {
        if (isMoodboardsDemoMode()) {
            this._ensureDemoTariffSwitcher();
        } else {
            document.querySelector('[data-role="demo-tariff-switcher"]')?.remove();
            this.tariffSwitcher = null;
        }
        this._ensureGate();
        this._lockApplication();

        for (;;) {
            this._renderLoading();
            try {
                const policy = await fetchMoodboardsAccess(this.endpoint);
                document.documentElement.dataset.moodboardsTariff = policy.tariffPlan;
                renderMoodboardsAccountControl(policy, {
                    loginUrl: this.loginUrl,
                    accountUrl: this.accountUrl,
                });

                if (!policy.isAuthorized || !policy.moodboardsAllowed) {
                    this._renderBlocked(policy);
                    return null;
                }

                this._unlockApplication();
                return policy;
            } catch (error) {
                await this._waitForRetry(error);
            }
        }
    }

    _ensureGate() {
        const existingGate = document.querySelector('[data-role="moodboards-access-gate"]');
        if (existingGate instanceof HTMLElement) {
            this.gate = existingGate;
            return;
        }

        this.gate = document.createElement('div');
        this.gate.className = 'access-gate';
        this.gate.dataset.role = 'moodboards-access-gate';
        document.body.append(this.gate);
    }

    _ensureDemoTariffSwitcher() {
        const existingSwitcher = document.querySelector('[data-role="demo-tariff-switcher"]');
        if (existingSwitcher instanceof HTMLElement) {
            this.tariffSwitcher = existingSwitcher;
            this._initializeDemoTariffSwitcher(existingSwitcher);
            return;
        }

        const currentTariff = new URLSearchParams(window.location.search).get('mock_tariff');
        const selectedTariff = DEMO_TARIFFS.includes(currentTariff)
            ? currentTariff
            : this.defaultTariff;
        const switcher = document.createElement('aside');
        switcher.className = 'demo-tariff-switcher';
        switcher.dataset.role = 'demo-tariff-switcher';

        const label = document.createElement('label');
        label.className = 'demo-tariff-switcher__field';
        const labelText = document.createElement('span');
        labelText.textContent = 'Демо-тариф';
        const select = document.createElement('select');
        select.dataset.role = 'demo-tariff-select';
        select.setAttribute('aria-label', 'Выбрать демонстрационный тариф');
        for (const tariff of DEMO_TARIFFS) {
            const option = document.createElement('option');
            option.value = tariff;
            option.textContent = TARIFF_LABELS[tariff];
            option.selected = tariff === selectedTariff;
            select.append(option);
        }
        label.append(labelText, select);
        const presetLabel = document.createElement('label');
        presetLabel.className = 'demo-tariff-switcher__field';
        const presetLabelText = document.createElement('span');
        presetLabelText.textContent = 'Пресет';
        const presetSelect = document.createElement('select');
        presetSelect.dataset.role = 'demo-preset-select';
        presetSelect.setAttribute('aria-label', 'Выбрать пресет удаления фона');
        const selectedPreset = this._getDemoPreset();
        for (const preset of DEMO_PRESETS) {
            const option = document.createElement('option');
            option.value = preset;
            option.textContent = BACKGROUND_REMOVAL_PRESET_DEFINITIONS[preset].name;
            option.selected = preset === selectedPreset;
            presetSelect.append(option);
        }
        const presetControl = document.createElement('span');
        presetControl.className = 'demo-tariff-switcher__preset-control';
        const presetDescription = document.createElement('small');
        presetDescription.dataset.role = 'demo-preset-description';
        presetDescription.id = 'demo-preset-description';
        presetSelect.setAttribute('aria-describedby', presetDescription.id);
        presetControl.append(presetSelect, presetDescription);
        presetLabel.append(presetLabelText, presetControl);
        switcher.append(label, presetLabel);
        document.body.append(switcher);
        this.tariffSwitcher = switcher;
        this._initializeDemoTariffSwitcher(switcher);
    }

    _initializeDemoTariffSwitcher(switcher) {
        const select = switcher.querySelector('[data-role="demo-tariff-select"]');
        if (select instanceof HTMLSelectElement) {
            const currentTariff = new URLSearchParams(window.location.search).get('mock_tariff');
            select.value = DEMO_TARIFFS.includes(currentTariff)
                ? currentTariff
                : this.defaultTariff;
            if (select.dataset.tariffSwitcherBound !== 'true') {
                select.dataset.tariffSwitcherBound = 'true';
                select.addEventListener('change', () => this._changeDemoTariff(select.value));
            }
        }

        const presetSelect = switcher.querySelector('[data-role="demo-preset-select"]');
        if (presetSelect instanceof HTMLSelectElement) {
            presetSelect.value = this._getDemoPreset();
            this._renderDemoPresetDescription(switcher, presetSelect.value);
            if (presetSelect.dataset.presetSwitcherBound !== 'true') {
                presetSelect.dataset.presetSwitcherBound = 'true';
                presetSelect.addEventListener('change', () => {
                    this._renderDemoPresetDescription(switcher, presetSelect.value);
                    this._changeDemoPreset(presetSelect.value);
                });
            }
        }
    }

    _renderDemoPresetDescription(switcher, presetId) {
        const description = switcher.querySelector('[data-role="demo-preset-description"]');
        if (description) {
            description.textContent = BACKGROUND_REMOVAL_PRESET_DEFINITIONS[presetId]?.description || '';
        }
    }

    _getDemoPreset() {
        const requestedPreset = new URLSearchParams(window.location.search).get('mock_preset');
        return DEMO_PRESETS.includes(requestedPreset) ? requestedPreset : DEFAULT_DEMO_PRESET;
    }

    _changeDemoTariff(tariff) {
        if (!DEMO_TARIFFS.includes(tariff)) {
            return;
        }
        const url = new URL(window.location.href);
        if (tariff === this.defaultTariff) {
            url.searchParams.delete('mock_tariff');
        } else {
            url.searchParams.set('mock_tariff', tariff);
        }
        window.location.assign(url.toString());
    }

    _changeDemoPreset(preset) {
        if (!DEMO_PRESETS.includes(preset)) {
            return;
        }
        const url = new URL(window.location.href);
        if (preset === DEFAULT_DEMO_PRESET) {
            url.searchParams.delete('mock_preset');
        } else {
            url.searchParams.set('mock_preset', preset);
        }
        window.location.assign(url.toString());
    }

    _lockApplication() {
        document.body.classList.add('access-gate-open');
        if (this.root instanceof HTMLElement) {
            this.root.setAttribute('inert', '');
        }
    }

    _unlockApplication() {
        document.body.classList.remove('access-gate-open');
        if (this.root instanceof HTMLElement && !this.rootWasInert) {
            this.root.removeAttribute('inert');
        }
        if (this.tariffSwitcher !== null) {
            document.body.append(this.tariffSwitcher);
        }
        this.gate?.remove();
        this.gate = null;
    }

    _renderLoading() {
        this.gate.setAttribute('role', 'status');
        this.gate.setAttribute('aria-live', 'polite');
        this.gate.removeAttribute('aria-modal');
        this.gate.removeAttribute('aria-labelledby');
        this.gate.innerHTML = `
            <div class="access-gate__dialog access-gate__dialog--loading">
                <span class="spinner" aria-hidden="true"></span>
                <div>
                    <strong>Проверяем доступ к MoodBoards</strong>
                    <p>Получаем данные авторизации и тарифа…</p>
                </div>
            </div>
        `;
        if (this.tariffSwitcher !== null) {
            document.body.append(this.tariffSwitcher);
        }
    }

    _renderBlocked(policy) {
        const isGuest = !policy.isAuthorized || policy.tariffPlan === 'guest';
        this.gate.setAttribute('role', 'dialog');
        this.gate.setAttribute('aria-modal', 'true');
        this.gate.setAttribute('aria-labelledby', 'access-gate-title');
        this.gate.removeAttribute('aria-live');
        this.gate.innerHTML = `
            <section class="access-gate__dialog">
                <span class="access-gate__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="28" height="28">
                        <rect x="5" y="10" width="14" height="10" rx="2"></rect>
                        <path d="M8 10V7a4 4 0 0 1 8 0v3"></path>
                    </svg>
                </span>
                <p class="access-gate__eyebrow" data-role="access-tariff"></p>
                <h1 id="access-gate-title">Подключите тариф Basic или выше</h1>
                <p class="access-gate__description" data-role="access-description"></p>
                <ul class="access-gate__features" aria-label="Возможности MoodBoards">
                    <li>Создание до 50 мудбордов</li>
                    <li>Редактирование и автоматическое сохранение</li>
                    <li>Экспорт в PNG и PDF</li>
                </ul>
                <div class="access-gate__actions">
                    <a class="button button--primary" data-role="access-primary-action"></a>
                    <a class="button button--secondary" href="${this.billingUrl}">Посмотреть тарифы</a>
                </div>
                <p class="access-gate__note">Это демонстрационная проверка доступа. Данные проекта остаются в браузере.</p>
            </section>
        `;
        if (this.tariffSwitcher !== null) {
            this.gate.append(this.tariffSwitcher);
        }

        this.gate.querySelector('[data-role="access-tariff"]').textContent = (
            `Текущий тариф: ${TARIFF_LABELS[policy.tariffPlan] || policy.tariffPlan}`
        );
        this.gate.querySelector('[data-role="access-description"]').textContent = isGuest
            ? 'Войдите в RoomPlan и подключите Basic, Premium или PRO, чтобы создавать и редактировать мудборды.'
            : 'На тарифе Free создание и редактирование мудбордов недоступно.';

        const primaryAction = this.gate.querySelector('[data-role="access-primary-action"]');
        primaryAction.href = isGuest ? this.loginUrl : this.billingUrl;
        primaryAction.textContent = isGuest ? 'Войти в RoomPlan' : 'Выбрать тариф';
        requestAnimationFrame(() => primaryAction.focus());
    }

    _waitForRetry(error) {
        this.gate.setAttribute('role', 'alertdialog');
        this.gate.setAttribute('aria-modal', 'true');
        this.gate.setAttribute('aria-labelledby', 'access-error-title');
        this.gate.removeAttribute('aria-live');
        this.gate.innerHTML = `
            <section class="access-gate__dialog">
                <span class="access-gate__icon access-gate__icon--error" aria-hidden="true">!</span>
                <p class="access-gate__eyebrow">Ошибка авторизации</p>
                <h1 id="access-error-title">Не удалось проверить доступ</h1>
                <p class="access-gate__description" data-role="access-error-message"></p>
                <div class="access-gate__actions">
                    <button class="button button--primary" data-action="retry-access" type="button">Повторить</button>
                    <a class="button button--secondary" href="${this.loginUrl}">Войти в RoomPlan</a>
                </div>
            </section>
        `;
        if (this.tariffSwitcher !== null) {
            this.gate.append(this.tariffSwitcher);
        }
        this.gate.querySelector('[data-role="access-error-message"]').textContent = (
            error?.message || 'Проверьте соединение и повторите запрос.'
        );

        const retryButton = this.gate.querySelector('[data-action="retry-access"]');
        requestAnimationFrame(() => retryButton.focus());
        return new Promise((resolve) => {
            retryButton.addEventListener('click', resolve, { once: true });
        });
    }
}

export async function requireMoodboardsAccess(runtime, root) {
    const accessConfig = runtime.config.access;
    const guard = new MoodboardsAccessGuard({
        root,
        endpoint: accessConfig.endpoint,
        defaultTariff: accessConfig.defaultTariff,
        billingUrl: accessConfig.billingUrl,
        loginUrl: accessConfig.loginUrl,
        accountUrl: accessConfig.accountUrl,
    });
    return await guard.requireAccess();
}
