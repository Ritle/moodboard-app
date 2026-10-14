<?php

declare(strict_types=1);

$pageTitle = 'Публичный просмотр — MoodBoards';
$pageDescription = 'Гостевой просмотр опубликованного мудборда';
$bodyClass = 'viewer-page';
$pageStyles = ['/moodboards/assets/css/viewer.css'];
$pageModule = '/moodboards/assets/js/viewer/app.js';
$showDemoTariffSwitcher = false;

require __DIR__ . '/includes/header.php';
?>
<div class="app-shell viewer-shell" data-page="viewer">
    <header class="viewer-topbar">
        <div class="viewer-topbar__start">
            <div class="viewer-brand-group">
                <a class="viewer-brand" href="/moodboards/index.php" aria-label="Мудборды — главная">
                    <img src="/moodboards/assets/img/logo.svg" width="140" height="28" alt="RoomPlan">
                </a>
                <span class="roomplan-studio-badge">Мудборды</span>
            </div>
            <span class="viewer-topbar__divider" aria-hidden="true"></span>
            <div class="viewer-document">
                <span class="viewer-document__mode">Гостевой просмотр</span>
                <h1 data-role="viewer-title">Открываем мудборд…</h1>
            </div>
        </div>

        <label class="viewer-page-control" data-role="viewer-page-control" hidden>
            <span>Лист</span>
            <select data-role="viewer-page-select" data-viewer-control aria-label="Выбрать лист мудборда" disabled></select>
        </label>

        <div class="viewer-topbar__actions">
            <div class="viewer-export">
                <button class="button button--primary viewer-export__trigger" data-action="toggle-viewer-export"
                    data-viewer-control type="button" aria-label="Выбрать формат экспорта" aria-haspopup="menu"
                    aria-expanded="false" aria-controls="viewer-export-menu" disabled>
                    <svg class="viewer-export__upload-icon" aria-hidden="true" viewBox="0 0 24 24" width="17" height="17">
                        <path d="M12 4v10"></path>
                        <path d="m8 8 4-4 4 4"></path>
                        <path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"></path>
                    </svg>
                    <span>Экспорт</span>
                    <svg class="viewer-export__chevron" aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
                        <path d="m4 6 4 4 4-4"></path>
                    </svg>
                </button>
                <div class="viewer-export__menu" id="viewer-export-menu" data-role="viewer-export-menu" role="menu"
                    aria-label="Формат экспорта" hidden>
                    <button class="viewer-export__option" data-action="viewer-export" data-format="pdf"
                        data-viewer-control role="menuitem" type="button" disabled>
                        <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19">
                            <path d="M6 3.5h7l5 5V20.5H6z"></path>
                            <path d="M13 3.5v5h5"></path>
                        </svg>
                        <span><strong>Экспорт в PDF</strong><small>Активный лист мудборда</small></span>
                    </button>
                    <button class="viewer-export__option" data-action="viewer-export" data-format="pdf-all"
                        data-role="multipage-pdf-option" data-viewer-control role="menuitem" type="button" hidden disabled>
                        <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19">
                            <path d="M8 2.5h7l5 5v11H8z"></path>
                            <path d="M15 2.5v5h5M4 6.5v15h12"></path>
                        </svg>
                        <span><strong>Все листы в PDF</strong><small>Каждый заполненный лист — отдельная страница</small></span>
                    </button>
                    <button class="viewer-export__option" data-action="viewer-export" data-format="png"
                        data-viewer-control role="menuitem" type="button" disabled>
                        <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19">
                            <rect x="3.5" y="4" width="17" height="16" rx="3"></rect>
                            <circle cx="9" cy="9" r="1.5"></circle>
                            <path d="m5.5 17 4.2-4 3 2.6 2.2-2 3.6 3.4"></path>
                        </svg>
                        <span><strong>Экспорт в PNG</strong><small>Изображение активного листа</small></span>
                    </button>
                </div>
            </div>
            <a
                class="roomplan-account-control"
                data-role="moodboards-account-link"
                data-auth-state="guest"
                href="https://roomplan.ru/app/"
                aria-label="Войти в RoomPlan"
            >
                <svg class="roomplan-account-control__icon" aria-hidden="true" viewBox="0 0 24 24" width="17" height="17">
                    <circle cx="12" cy="8" r="3.5"></circle>
                    <path d="M5.5 20c.7-4 2.9-6 6.5-6s5.8 2 6.5 6"></path>
                </svg>
                <span data-role="account-label">Войти</span>
            </a>
        </div>
    </header>

    <main class="viewer-workspace" aria-busy="true">
        <div class="viewer-state viewer-state--loading" data-state="loading" role="status">
            <span class="spinner" aria-hidden="true"></span>
            <div>
                <strong>Загружаем публичный мудборд</strong>
                <p>Подготавливаем листы и изображения…</p>
            </div>
        </div>

        <div class="viewer-state viewer-state--error" data-state="error" role="alert" hidden>
            <span class="viewer-state__icon" aria-hidden="true">!</span>
            <h2>Публичный мудборд недоступен</h2>
            <p data-role="viewer-error-message"></p>
            <a class="button button--primary" href="https://roomplan.ru/">Перейти на главную RoomPlan</a>
        </div>

        <div class="viewer-canvas-shell" data-role="viewer-canvas-shell" hidden>
            <div class="viewer-canvas-container" data-role="viewer-canvas-container"></div>
            <div class="viewer-zoom-controls" aria-label="Масштаб просмотра">
                <button class="viewer-zoom-controls__button" data-action="viewer-zoom-out" data-viewer-control
                    type="button" aria-label="Уменьшить масштаб" disabled>−</button>
                <output class="viewer-zoom-controls__value" data-role="viewer-zoom-value"
                    aria-label="Текущий масштаб">100%</output>
                <button class="viewer-zoom-controls__button" data-action="viewer-zoom-in" data-viewer-control
                    type="button" aria-label="Увеличить масштаб" disabled>＋</button>
                <button class="viewer-zoom-controls__fit" data-action="viewer-zoom-fit" data-viewer-control
                    type="button" disabled>По размеру</button>
            </div>
        </div>

        <div class="viewer-notification" data-role="viewer-notification" role="status" aria-live="polite" hidden></div>
    </main>
</div>
<?php require __DIR__ . '/includes/footer.php'; ?>
