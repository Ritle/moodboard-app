<?php
//require __DIR__ . '/includes/demo_guard.php';
declare(strict_types=1);

$pageTitle = 'Редактор — MoodBoards';
$pageDescription = 'Демонстрационный редактор интерьерных мудбордов';
$bodyClass = 'editor-page';
$pageStyles = ['/moodboards/assets/css/editor.css'];
$pageModule = '/moodboards/assets/js/editor/app.js';
$showProjectJsonTools = true;

require __DIR__ . '/includes/header.php';
?>
<div class="app-shell editor-shell" data-page="editor">
    <header class="editor-topbar">
        <div class="editor-topbar__start">
            <a class="editor-topbar__logo" href="index.php" aria-label="Вернуться к проектам">
                <img src="/moodboards/assets/img/logo.svg" width="140" height="28" alt="RoomPlan">
                <span class="editor-topbar__back-tooltip" role="tooltip">
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="M6 12H18M6 12L11 7M6 12L11 17"></path>
                    </svg>
                    <span>К проектам</span>
                </span>
            </a>
            <span class="roomplan-studio-badge editor-topbar__label">Мудборды</span>
            <div class="editor-document">
                <span class="editor-document__title" data-role="document-title" title="Название проекта">Новый проект 1</span>
            </div>
            <div class="page-switcher">
                <button class="page-switcher__trigger" data-action="toggle-pages" data-editor-control type="button"
                    aria-label="Выбрать лист" aria-haspopup="dialog" aria-expanded="false"
                    aria-controls="page-switcher-popover" disabled>
                    <span class="page-switcher__document-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="16" height="16">
                            <path d="M6 3.5h7l5 5V20.5H6z"></path>
                            <path d="M13 3.5v5h5"></path>
                        </svg>
                    </span>
                    <span class="page-switcher__current" data-role="active-page-name">Лист 1</span>
                    <svg class="page-switcher__chevron" aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
                        <path d="m4 6 4 4 4-4"></path>
                    </svg>
                </button>

                <section class="page-switcher__popover" id="page-switcher-popover" data-role="pages-popover"
                    role="dialog" aria-label="Листы мудборда" hidden>
                    <div class="page-switcher__list" data-role="pages-list" role="list"></div>
                    <button class="page-switcher__new" data-action="create-page" type="button">
                        <span aria-hidden="true">
                            <svg viewBox="0 0 20 20" width="12" height="12">
                                <path d="M10 4v12M4 10h12"></path>
                            </svg>
                        </span>
                        <span>Новый лист</span>
                    </button>
                    <div class="page-delete-confirm" data-role="page-delete-confirm" role="alertdialog"
                        aria-labelledby="page-delete-title" hidden>
                        <strong id="page-delete-title">Удалить лист?</strong>
                        <p data-role="page-delete-message"></p>
                        <div class="page-delete-confirm__actions">
                            <button class="button button--secondary" data-action="cancel-delete-page"
                                type="button">Отмена</button>
                            <button class="button button--danger" data-action="confirm-delete-page"
                                type="button">Удалить</button>
                        </div>
                    </div>
                </section>
            </div>
            <div class="editor-topbar__history" aria-label="История изменений">
                <button class="icon-button" data-action="undo" type="button" aria-label="Отменить"
                    data-tooltip="Нет изменений для отмены" data-tooltip-position="bottom" disabled>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
                        class="svg_ui_adaptive" aria-hidden="true">
                        <path
                            d="M1.22879 8.40879L16.7888 8.40879C18.376 8.40879 19.8982 9.03931 21.0206 10.1616C22.1429 11.284 22.7734 12.8062 22.7734 14.3934C22.7734 15.9806 22.1429 17.5028 21.0206 18.6252C19.8982 19.7475 18.376 20.378 16.7888 20.378L6.01649 20.378M1.22879 8.40879L6.01649 3.62109M1.22879 8.40879L6.01649 13.1965"
                            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        </path>
                    </svg>
                </button>
                <button class="icon-button" data-action="redo" type="button" aria-label="Вернуть"
                    data-tooltip="Нет изменений для повтора" data-tooltip-position="bottom" disabled>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"
                        class="svg_ui_adaptive" aria-hidden="true">
                        <path
                            d="M22.7732 8.40879L7.21314 8.40879C5.62592 8.40879 4.10371 9.03931 2.98137 10.1616C1.85904 11.284 1.22852 12.8062 1.22852 14.3934C1.22852 15.9806 1.85904 17.5028 2.98137 18.6252C4.10371 19.7475 5.62592 20.378 7.21314 20.378L17.9855 20.378M22.7732 8.40879L17.9855 3.62109M22.7732 8.40879L17.9855 13.1965"
                            stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        </path>
                    </svg>
                </button>
            </div>
        </div>

        <div class="editor-topbar__actions">
            <span class="save-status" data-role="save-status" data-status="loading" role="status"
                aria-live="polite">Загрузка сцены…</span>
            <span class="link-project-control" data-tooltip="Ссылка на проект — скоро" data-tooltip-position="bottom"
                hidden>
                <button class="icon-button link-project-control__button" id="Link_project" data-component="Link_project"
                    data-role="link-project" type="button" aria-label="Ссылка на проект — функция пока недоступна"
                    disabled>
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path
                            d="m9.5 12.5 5-5a3 3 0 0 1 4.25 4.25l-7.5 7.5a5 5 0 0 1-7.07-7.07l7.25-7.25a3.5 3.5 0 0 1 4.95 4.95l-7.25 7.25a2 2 0 0 1-2.83-2.83l6.5-6.5">
                        </path>
                    </svg>
                </button>
            </span>
            <div class="editor-settings">
                <button class="icon-button editor-settings__trigger" data-action="toggle-settings" data-editor-control
                    type="button" aria-label="Настройки проекта" aria-haspopup="dialog" aria-expanded="false"
                    aria-controls="editor-settings-popover" data-tooltip="Настройки проекта"
                    data-tooltip-position="bottom" disabled>
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"></path>
                        <path
                            d="M19.4 13.5a7.8 7.8 0 0 0 .05-1.5 7.8 7.8 0 0 0-.05-1.5l1.65-1.3-2-3.4-1.95.8a8.3 8.3 0 0 0-2.6-1.5L14.2 3h-4.4l-.3 2.1a8.3 8.3 0 0 0-2.6 1.5l-1.95-.8-2 3.4 1.65 1.3a7.8 7.8 0 0 0-.05 1.5c0 .5.02 1 .05 1.5l-1.65 1.3 2 3.4 1.95-.8a8.3 8.3 0 0 0 2.6 1.5l.3 2.1h4.4l.3-2.1a8.3 8.3 0 0 0 2.6-1.5l1.95.8 2-3.4-1.65-1.3Z">
                        </path>
                    </svg>
                </button>

                <section class="editor-settings__popover" id="editor-settings-popover" data-role="settings-popover"
                    role="dialog" aria-labelledby="editor-settings-title" hidden>
                    <header class="editor-settings__heading">
                        <h2 id="editor-settings-title">Настройки</h2>
                    </header>
                    <div class="editor-settings__body">
                        <label class="editor-settings__field">
                            <span>Название проекта</span>
                            <input data-role="project-name" data-editor-control type="text" maxlength="160"
                                autocomplete="off" spellcheck="true" disabled>
                        </label>
                        <section class="editor-settings__section" aria-labelledby="editor-scene-settings-title">
                            <h3 id="editor-scene-settings-title">Настройки сцены</h3>
                            <label class="editor-settings__option">
                                <span>Показывать сетку</span>
                                <span class="settings-switch">
                                    <input data-setting="showGrid" type="checkbox">
                                    <span class="settings-switch__track" aria-hidden="true"></span>
                                </span>
                            </label>
                            <label class="editor-settings__option">
                                <span>Показывать белый лист</span>
                                <span class="settings-switch">
                                    <input data-setting="showCanvasSheet" type="checkbox">
                                    <span class="settings-switch__track" aria-hidden="true"></span>
                                </span>
                            </label>
                            <label class="editor-settings__option">
                                <span>Всегда привязывать объекты</span>
                                <span class="settings-switch">
                                    <input data-setting="alwaysSnap" type="checkbox">
                                    <span class="settings-switch__track" aria-hidden="true"></span>
                                </span>
                            </label>
                        </section>
                        <section class="editor-settings__section" aria-labelledby="editor-advanced-settings-title">
                            <h3 id="editor-advanced-settings-title">Расширенные настройки</h3>
                            <label class="editor-settings__option">
                                <span>Показывать линии привязки</span>
                                <span class="settings-switch">
                                    <input data-setting="showBindingGuides" type="checkbox">
                                    <span class="settings-switch__track" aria-hidden="true"></span>
                                </span>
                            </label>
                            <label class="editor-settings__option">
                                <span>Показывать размеры в пикселях</span>
                                <span class="settings-switch">
                                    <input data-setting="showElementDimensions" type="checkbox">
                                    <span class="settings-switch__track" aria-hidden="true"></span>
                                </span>
                            </label>
                            <label class="editor-settings__option">
                                <span>Тёмный режим</span>
                                <span class="settings-switch">
                                    <input data-setting="darkMode" type="checkbox">
                                    <span class="settings-switch__track" aria-hidden="true"></span>
                                </span>
                            </label>
                            <label class="editor-settings__option">
                                <span>Фокус-режим</span>
                                <span class="settings-switch">
                                    <input data-setting="focusMode" type="checkbox">
                                    <span class="settings-switch__track" aria-hidden="true"></span>
                                </span>
                            </label>
                        </section>
                    </div>
                </section>
            </div>
            <div class="editor-export">
                <button class="button button--primary editor-export__trigger" data-action="toggle-export"
                    data-editor-control type="button" aria-label="Выбрать формат экспорта" aria-haspopup="menu"
                    aria-expanded="false" aria-controls="editor-export-menu" disabled>
                    <svg class="editor-export__upload-icon" aria-hidden="true" viewBox="0 0 24 24" width="17"
                        height="17">
                        <path d="M12 4v10"></path>
                        <path d="m8 8 4-4 4 4"></path>
                        <path d="M5 13v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5"></path>
                    </svg>
                    <span class="export-span" data-role="export-trigger-label">Экспорт</span>
                    <svg class="editor-export__chevron" aria-hidden="true" viewBox="0 0 16 16" width="14" height="14">
                        <path d="m4 6 4 4 4-4"></path>
                    </svg>
                </button>
                <div class="editor-export__menu" id="editor-export-menu" data-role="export-menu" role="menu"
                    aria-label="Формат экспорта" hidden>
                    <button class="editor-export__option" data-action="create-share-link" data-export-option
                        role="menuitem" type="button">
                        <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19">
                            <path
                                d="M9.5 12.5 14 8a3 3 0 0 1 4.2 4.2l-6.7 6.7a5 5 0 0 1-7.1-7.1l7.1-7.1a3.5 3.5 0 0 1 5 5L10 16.2a2 2 0 0 1-2.8-2.8l5.7-5.7">
                            </path>
                        </svg>
                        <span><strong data-role="share-option-label">Создать публичную ссылку</strong><small>Скопировать
                                ссылку на просмотр</small></span>
                    </button>
                    <button class="editor-export__option" data-action="export-format" data-export-option
                        data-format="pdf" role="menuitem" type="button" aria-label="Экспортировать PDF (Ctrl+P)">
                        <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19">
                            <path d="M6 3.5h7l5 5V20.5H6z"></path>
                            <path d="M13 3.5v5h5"></path>
                        </svg>
                        <span><strong>Экспорт в PDF</strong><small>Активный лист</small></span>
                    </button>
                    <button class="editor-export__option" data-action="export-format" data-export-option
                        data-role="multipage-pdf-option" data-format="pdf-all" role="menuitem" type="button"
                        aria-label="Экспортировать все заполненные листы в многостраничный PDF" hidden>
                        <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19">
                            <path d="M8 2.5h7l5 5v11H8z"></path>
                            <path d="M15 2.5v5h5M4 6.5v15h12"></path>
                        </svg>
                        <span><strong>Все листы в PDF</strong><small>Каждый лист — отдельная страница</small></span>
                    </button>
                    <button class="editor-export__option" data-action="export-format" data-export-option
                        data-format="png" role="menuitem" type="button">
                        <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19">
                            <rect x="3.5" y="4" width="17" height="16" rx="3"></rect>
                            <circle cx="9" cy="9" r="1.5"></circle>
                            <path d="m5.5 17 4.2-4 3 2.6 2.2-2 3.6 3.4"></path>
                        </svg>
                        <span><strong>Экспорт в PNG</strong><small>Изображение активного листа</small></span>
                    </button>
                </div>
            </div>
            <span class="visually-hidden" data-role="export-status" role="status" aria-live="polite" hidden></span>
            <a class="roomplan-account-control editor-account-control" data-role="moodboards-account-link"
                data-auth-state="guest" href="https://roomplan.ru/app/" aria-label="Войти в RoomPlan">
                <svg class="roomplan-account-control__icon" aria-hidden="true" viewBox="0 0 24 24" width="17"
                    height="17">
                    <circle cx="12" cy="8" r="3.5"></circle>
                    <path d="M5.5 20c.7-4 2.9-6 6.5-6s5.8 2 6.5 6"></path>
                </svg>
                <span data-role="account-label">Войти</span>
            </a>
        </div>
    </header>

    <main class="editor-workspace">
        <section class="canvas-workspace" aria-label="Рабочая область мудборда" aria-busy="true">
            <input class="visually-hidden" data-role="image-input" type="file" accept="image/jpeg,image/png,image/webp"
                multiple aria-label="Выбрать изображения">
            <input class="visually-hidden" data-role="replace-image-input" type="file"
                accept="image/jpeg,image/png,image/webp" aria-label="Выбрать новое изображение">

            <div class="upload-status upload-status--floating" data-role="upload-status" aria-live="polite" hidden>
                <span data-role="upload-status-text">Обрабатываем изображения…</span>
                <progress data-role="upload-progress" max="1" value="0"></progress>
            </div>
            <div class="canvas-loading" data-state="loading">
                <span class="spinner" aria-hidden="true"></span>
                <span>Открываем мудборд…</span>
            </div>

            <div class="canvas-error" data-state="error" role="alert" hidden>
                <span class="canvas-error__icon" aria-hidden="true">!</span>
                <strong>Не удалось открыть редактор</strong>
                <p data-role="error-message"></p>
                <a class="button button--secondary" href="/moodboards/index.php">Вернуться к доскам</a>
            </div>

            <div class="canvas-shell" data-role="canvas-shell" hidden>
                <div class="canvas-container" data-role="canvas-container"></div>
                <div class="canvas-drop-overlay" data-role="drop-overlay" hidden>
                    <span class="canvas-drop-overlay__icon" aria-hidden="true">＋</span>
                    <strong>Добавить изображения</strong>
                    <span>Отпустите JPEG, PNG или WebP</span>
                </div>
            </div>

            <button class="return-to-content" data-action="return-to-content" data-role="return-to-content"
                data-editor-control type="button" aria-label="Вернуться к содержимому активного листа" hidden disabled>
                <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
                    <path d="M8 4H4v4M16 4h4v4M20 16v4h-4M8 20H4v-4"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                </svg>
                <span>Назад к содержимому</span>
            </button>

            <button class="focus-mode-exit" data-action="exit-focus-mode" type="button"
                aria-label="Выйти из фокус-режима, клавиша Escape" aria-keyshortcuts="Escape">
                <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15">
                    <path d="M9 4H4v5M15 4h5v5M20 15v5h-5M9 20H4v-5"></path>
                </svg>
                <span>Выйти</span>
                <kbd>Esc</kbd>
            </button>

            <nav class="action-panel" aria-label="Инструменты мудборда">
                <div class="action-panel__item">
                    <button class="action-panel__button" data-action="select-images" data-tool-indicator="image"
                        data-editor-control type="button" aria-label="Добавить изображение" aria-pressed="false"
                        data-tooltip="Изображение" data-tooltip-position="top" disabled>
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                            <rect x="3.5" y="4" width="17" height="16" rx="3"></rect>
                            <circle cx="9" cy="9" r="1.5"></circle>
                            <path d="m5.5 17 4.2-4 3 2.6 2.2-2 3.6 3.4"></path>
                        </svg>
                    </button>
                </div>

                <div class="action-panel__item" data-action-popover-root="shapes">
                    <button class="action-panel__button" data-action="toggle-action-popover"
                        data-action-popover="shapes" data-tool-indicator="shape" data-editor-control type="button"
                        aria-label="Открыть набор фигур" aria-haspopup="menu" aria-expanded="false" aria-pressed="false"
                        aria-controls="action-shapes-popover" data-tooltip="Фигуры" data-tooltip-position="top"
                        disabled>
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                            <rect x="5" y="5" width="14" height="14" rx="1"></rect>
                        </svg>
                    </button>
                    <div class="action-panel__popover action-panel__popover--shapes" id="action-shapes-popover"
                        data-role="action-popover" data-action-popover-panel="shapes" role="menu" aria-label="Фигуры"
                        hidden>
                        <div class="action-panel__shape-grid">
                            <button data-action="add-shape" data-shape-type="rectangle" data-editor-control
                                role="menuitem" type="button" aria-label="Добавить квадрат" data-tooltip="Квадрат"
                                data-tooltip-position="top" disabled><span aria-hidden="true">□</span></button>
                            <button data-action="add-shape" data-shape-type="circle" data-editor-control role="menuitem"
                                type="button" aria-label="Добавить круг" data-tooltip="Круг" data-tooltip-position="top"
                                disabled><span aria-hidden="true">○</span></button>
                            <button data-action="add-shape" data-shape-type="diamond" data-editor-control
                                role="menuitem" type="button" aria-label="Добавить ромб" data-tooltip="Ромб"
                                data-tooltip-position="top" disabled><span aria-hidden="true">◇</span></button>
                            <button data-action="add-shape" data-shape-type="triangle" data-editor-control
                                role="menuitem" type="button" aria-label="Добавить треугольник"
                                data-tooltip="Треугольник" data-tooltip-position="top" disabled><span
                                    aria-hidden="true">△</span></button>
                            <button data-action="add-shape" data-shape-type="star" data-editor-control role="menuitem"
                                type="button" aria-label="Добавить звезду" data-tooltip="Звезда"
                                data-tooltip-position="top" disabled><span aria-hidden="true">☆</span></button>
                            <button data-action="add-shape" data-shape-type="oval" data-editor-control role="menuitem"
                                type="button" aria-label="Добавить овал" data-tooltip="Овал" data-tooltip-position="top"
                                disabled><span class="action-panel__oval" aria-hidden="true"></span></button>
                            <button data-action="add-shape" data-shape-type="hexagon" data-editor-control
                                role="menuitem" type="button" aria-label="Добавить шестиугольник"
                                data-tooltip="Шестиугольник" data-tooltip-position="top" disabled><span
                                    aria-hidden="true">⬡</span></button>
                            <button data-action="add-shape" data-shape-type="cloud" data-editor-control role="menuitem"
                                type="button" aria-label="Добавить облако" data-tooltip="Облако"
                                data-tooltip-position="top" disabled><span aria-hidden="true">☁</span></button>
                            <button data-action="add-shape" data-shape-type="arrow-left" data-editor-control
                                role="menuitem" type="button" aria-label="Добавить стрелку влево"
                                data-tooltip="Стрелка влево" data-tooltip-position="top" disabled><span
                                    aria-hidden="true">←</span></button>
                            <button data-action="add-shape" data-shape-type="arrow-up" data-editor-control
                                role="menuitem" type="button" aria-label="Добавить стрелку вверх"
                                data-tooltip="Стрелка вверх" data-tooltip-position="top" disabled><span
                                    aria-hidden="true">↑</span></button>
                            <button data-action="add-shape" data-shape-type="arrow-down" data-editor-control
                                role="menuitem" type="button" aria-label="Добавить стрелку вниз"
                                data-tooltip="Стрелка вниз" data-tooltip-position="top" disabled><span
                                    aria-hidden="true">↓</span></button>
                            <button data-action="add-shape" data-shape-type="arrow-right" data-editor-control
                                role="menuitem" type="button" aria-label="Добавить стрелку вправо"
                                data-tooltip="Стрелка вправо" data-tooltip-position="top" disabled><span
                                    aria-hidden="true">→</span></button>
                            <button data-action="add-shape" data-shape-type="checkbox-x" data-editor-control
                                role="menuitem" type="button" aria-label="Добавить чекбокс X" data-tooltip="Чекбокс X"
                                data-tooltip-position="top" disabled><span aria-hidden="true">☒</span></button>
                            <button data-action="add-shape" data-shape-type="checkbox-v" data-editor-control
                                role="menuitem" type="button" aria-label="Добавить чекбокс V" data-tooltip="Чекбокс V"
                                data-tooltip-position="top" disabled><span aria-hidden="true">☑</span></button>
                        </div>
                    </div>
                </div>

                <div class="action-panel__item">
                    <button class="action-panel__button action-panel__button--text" data-action="add-text"
                        data-tool-indicator="text" data-editor-control type="button" aria-label="Добавить текст"
                        aria-pressed="false" data-tooltip="Текст" data-tooltip-position="top" disabled>
                        <span aria-hidden="true">T</span>
                    </button>
                </div>

                <div class="action-panel__item">
                    <button class="action-panel__button" data-action="set-tool" data-tool="brush"
                        data-tool-indicator="brush" data-editor-control type="button" aria-label="Инструмент кисть"
                        aria-pressed="false" data-tooltip="Кисть рисования" data-tooltip-position="top" disabled>
                        <svg aria-hidden="true" viewBox="0 -2 32 32">
                            <path class="fill-brush" transform="translate(-99 -154)"
                                d="M128.735,157.585 L116.047,170.112 L114.65,168.733 L127.339,156.206 C127.725,155.825 128.35,155.825 128.735,156.206 C129.121,156.587 129.121,157.204 128.735,157.585 L128.735,157.585 Z M112.556,173.56 C112.427,173.433 111.159,172.181 111.159,172.181 L113.254,170.112 L114.65,171.491 L112.556,173.56 L112.556,173.56 Z M110.461,178.385 C109.477,179.298 105.08,181.333 102.491,179.36 C102.491,179.36 103.392,178.657 104.074,177.246 C105.703,172.919 109.763,173.56 109.763,173.56 L111.159,174.938 C111.173,174.952 112.202,176.771 110.461,178.385 L110.461,178.385 Z M130.132,154.827 C128.975,153.685 127.099,153.685 125.942,154.827 L108.764,171.788 C106.661,171.74 103.748,172.485 102.491,176.603 C101.53,178.781 99,178.671 99,178.671 C104.253,184.498 110.444,181.196 111.857,179.764 C113.1,178.506 113.279,176.966 113.146,175.734 L130.132,158.964 C131.289,157.821 131.289,155.969 130.132,154.827 L130.132,154.827 Z">
                            </path>
                        </svg>
                    </button>
                </div>
                <div class="action-panel__item">
                    <button class="action-panel__button" data-action="set-tool" data-tool="arrow"
                        data-tool-indicator="arrow" data-editor-control type="button"
                        aria-label="Нарисовать стрелку или линию" aria-pressed="false" data-tooltip="Стрелка / линия"
                        data-tooltip-position="top" disabled>
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                            <path d="M4 12h15"></path>
                            <path d="m15 8 4 4-4 4"></path>
                        </svg>
                    </button>
                </div>
                <div class="action-panel__item">
                    <button class="action-panel__button" data-action="set-tool" data-tool="frame"
                        data-tool-indicator="frame" data-editor-control type="button" aria-label="Нарисовать фрейм"
                        aria-pressed="false" data-tooltip="Фрейм" data-tooltip-position="top" disabled>
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                            <path d="M6 3v18M18 3v18M3 6h18M3 18h18"></path>
                        </svg>
                    </button>
                </div>

                <div class="action-panel__item" data-action-popover-root="more">
                    <button class="action-panel__button" data-action="toggle-action-popover" data-action-popover="more"
                        data-tool-indicator="more" data-editor-control type="button"
                        aria-label="Открыть дополнительные элементы" aria-haspopup="menu" aria-expanded="false"
                        aria-pressed="false" aria-controls="action-more-popover" disabled>
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                            <path d="m7 14 5-5 5 5"></path>
                        </svg>
                    </button>
                    <div class="action-panel__popover action-panel__popover--more" id="action-more-popover"
                        data-role="action-popover" data-action-popover-panel="more" role="menu"
                        aria-label="Дополнительные элементы" hidden>
                        <button class="action-panel__menu-item" data-action="add-sticker" data-editor-control
                            role="menuitem" type="button" aria-label="Добавить текстовый стикер" disabled>
                            <span class="action-panel__menu-icon action-panel__menu-icon--sticker"
                                aria-hidden="true">T</span><span><strong>Стикер</strong><small>Текстовая
                                    заметка</small></span>
                        </button>
                        <button class="action-panel__menu-item" data-action="set-tool" data-tool="highlighter"
                            data-editor-control role="menuitem" type="button" aria-label="Инструмент выделитель"
                            aria-pressed="false" disabled>
                            <span class="action-panel__menu-icon action-panel__menu-icon--highlighter"
                                aria-hidden="true">▰</span><span><strong>Выделитель</strong><small>Полупрозрачный
                                    маркер</small></span>
                        </button>
                    </div>
                </div>

                <span class="action-panel__divider" aria-hidden="true"></span>

                <div class="action-panel__item">
                    <button class="action-panel__button" data-action="set-tool" data-tool="select"
                        data-tool-indicator="select" data-editor-control type="button" aria-label="Инструмент выбора"
                        aria-pressed="true" data-tooltip="Выбор" data-tooltip-position="top" disabled>
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                            <path class="action-panel__cursor-fill" d="M6 3.5 18.5 12 12 13.5 9 20z"></path>
                        </svg>
                    </button>
                </div>
                <div class="action-panel__item">
                    <button class="action-panel__button" data-action="set-tool" data-tool="hand"
                        data-tool-indicator="hand" data-editor-control type="button" aria-label="Инструмент рука"
                        aria-pressed="false" data-tooltip="Рука" data-tooltip-position="top" disabled>
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                            <path d="M7.5 11V7.5a1.5 1.5 0 0 1 3 0V11"></path>
                            <path d="M10.5 10V5.5a1.5 1.5 0 0 1 3 0V10"></path>
                            <path d="M13.5 10V6.5a1.5 1.5 0 0 1 3 0V11"></path>
                            <path
                                d="M16.5 10a1.5 1.5 0 0 1 3 0v4.5c0 4-2.5 6.5-6.5 6.5h-1.5c-2.2 0-3.7-.8-5-2.4l-2.7-3.3a1.7 1.7 0 0 1 2.5-2.3l1.2 1.1Z">
                            </path>
                        </svg>
                    </button>
                </div>
            </nav>

            <output class="selection-dimensions" data-role="selection-dimensions"
                aria-label="Размер выделения в пикселях" aria-live="off" hidden></output>

            <div class="contextual-toolbar" data-role="contextual-toolbar" hidden>
                <div class="contextual-toolbar__object-tools" data-role="contextual-object-tools">
                    <span class="contextual-toolbar__type" data-role="selected-type">Объект</span>
                    <div class="contextual-toolbar__type-controls" data-object-toolbar="image" role="group"
                        aria-label="Настройки изображения" hidden>
                        <button
                            class="contextual-toolbar__button contextual-toolbar__button--icon contextual-toolbar__button--ai"
                            data-object-action="remove-background" type="button" aria-label="ИИ удаление фона"
                            aria-busy="false" aria-pressed="false" data-tooltip="ИИ удаление фона"
                            data-tooltip-position="bottom">
                            <svg aria-hidden="true" viewBox="0 0 24 24">
                                <path d="m5 19 10.8-10.8"></path>
                                <path d="m14.7 4.3 5 5"></path>
                                <path d="M6.8 5.2v3.2M5.2 6.8h3.2M17.5 14v4.5M15.2 16.2h4.5"></path>
                            </svg>
                        </button>
                        <div class="image-eraser-control" data-role="image-eraser-control">
                            <button
                                class="contextual-toolbar__button contextual-toolbar__button--icon contextual-toolbar__button--neutral"
                                data-object-action="toggle-image-eraser" type="button" aria-label="Ручное удаление фона"
                                aria-pressed="false" aria-expanded="false" aria-controls="image-eraser-popover"
                                data-tooltip="Ручное удаление фона" data-tooltip-position="bottom">
                                <svg aria-hidden="true" viewBox="0 0 24 24">
                                    <path d="m4.5 14.5 8.8-8.8a2.4 2.4 0 0 1 3.4 0l1.6 1.6a2.4 2.4 0 0 1 0 3.4l-8.8 8.8H6.8l-2.3-2.3a1.9 1.9 0 0 1 0-2.7Z"></path>
                                    <path d="m9.5 19.5 3.5-3.5M11.2 7.8l5 5"></path>
                                </svg>
                            </button>
                            <div class="image-eraser-popover" id="image-eraser-popover"
                                data-role="image-eraser-popover" aria-label="Настройки ручного ластика" hidden>
                                <label class="image-eraser-popover__size">
                                    <span>Размер ластика</span>
                                    <output data-role="image-eraser-size-value">64 px</output>
                                    <input data-role="image-eraser-size" type="range" min="8" max="256" step="4"
                                        value="64" aria-label="Размер ручного ластика в пикселях">
                                </label>
                                <div class="image-eraser-popover__presets" role="group"
                                    aria-label="Предустановленные размеры ластика">
                                    <button data-image-eraser-size="16" type="button">16</button>
                                    <button data-image-eraser-size="32" type="button">32</button>
                                    <button data-image-eraser-size="64" type="button">64</button>
                                    <button data-image-eraser-size="128" type="button">128</button>
                                </div>
                                <div class="image-eraser-popover__actions">
                                    <button data-object-action="clear-image-erase-mask" type="button">Очистить</button>
                                    <button class="image-eraser-popover__done" data-object-action="finish-image-eraser"
                                        type="button">Готово</button>
                                </div>
                            </div>
                        </div>
                        <button
                            class="contextual-toolbar__button contextual-toolbar__button--icon contextual-toolbar__button--neutral"
                            data-object-action="flip-x" type="button" aria-label="Отразить по ширине"
                            data-tooltip="Отразить по ширине" data-tooltip-position="bottom">
                            <svg class="svg_ui_adaptive" viewBox="0 0 24 24" fill="none"
                                xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                <path
                                    d="M12 2.50391L12 21.4961M15.6875 5.62109V18.3764H22.0651L15.6875 5.62109ZM8.31123 5.62109V18.3764H1.93359L8.31123 5.62109Z"
                                    stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                            </svg>
                        </button>
                        <button
                            class="contextual-toolbar__button contextual-toolbar__button--icon contextual-toolbar__button--neutral"
                            data-object-action="flip-y" type="button" aria-label="Отразить по глубине"
                            data-tooltip="Отразить по глубине" data-tooltip-position="bottom">
                            <svg class="svg_ui_adaptive" viewBox="0 0 24 24" fill="none"
                                xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                                <path
                                    d="M21.4951 12.0005L2.50293 12.0005M18.3779 15.688L5.62265 15.688L5.62265 22.0656L18.3779 15.688ZM18.3779 8.31172L5.62265 8.31172L5.62265 1.93408L18.3779 8.31172Z"
                                    stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                            </svg>
                        </button>
                        <button
                            class="contextual-toolbar__button contextual-toolbar__button--icon contextual-toolbar__button--neutral"
                            data-object-action="toggle-lock" type="button" aria-label="Заблокировать изображение"
                            aria-pressed="false" data-tooltip="Заблокировать" data-tooltip-position="bottom">
                            <svg class="contextual-toolbar__state-icon contextual-toolbar__lock-icon--closed"
                                aria-hidden="true" viewBox="0 0 24 24">
                                <rect x="5.5" y="10" width="13" height="10" rx="2"></rect>
                                <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"></path>
                                <path d="M12 14v2.5"></path>
                            </svg>
                            <svg class="contextual-toolbar__state-icon contextual-toolbar__lock-icon--open"
                                aria-hidden="true" viewBox="0 0 24 24">
                                <rect x="5.5" y="10" width="13" height="10" rx="2"></rect>
                                <path d="M15.5 10V7.5a3.5 3.5 0 0 0-6.8-1.2"></path>
                                <path d="M12 14v2.5"></path>
                            </svg>
                        </button>
                    </div>

                    <div class="contextual-toolbar__type-controls" data-object-toolbar="shape" role="group"
                        aria-label="Настройки фигуры" hidden>
                        <label class="contextual-toolbar__color" data-tooltip="Цвет заливки"
                            data-tooltip-position="bottom">
                            <span class="visually-hidden">Цвет заливки</span>
                            <input data-object-property="fill" type="color" value="#8094b1">
                        </label>
                        <label class="contextual-toolbar__color contextual-toolbar__color--stroke"
                            data-tooltip="Цвет обводки" data-tooltip-position="bottom">
                            <span class="visually-hidden">Цвет обводки</span>
                            <input data-object-property="stroke" type="color" value="#707070">
                        </label>
                        <label class="contextual-toolbar__select contextual-toolbar__select--compact" data-tooltip="Толщина рамки"
                            data-tooltip-position="bottom">
                            <span class="visually-hidden">Толщина рамки</span>
                            <select data-object-property="strokeWidth" aria-label="Толщина рамки">
                                <option value="0">Нет</option>
                                <option value="1">Тонкая</option>
                                <option value="3">Средняя</option>
                                <option value="6">Толстая</option>
                            </select>
                        </label>
                        <label class="contextual-toolbar__select contextual-toolbar__select--compact"
                            data-tooltip="Прозрачность" data-tooltip-position="bottom">
                            <span class="visually-hidden">Прозрачность</span>
                            <select data-object-property="opacity" aria-label="Прозрачность фигуры">
                                <option value="1">100%</option>
                                <option value="0.75">75%</option>
                                <option value="0.5">50%</option>
                                <option value="0.25">25%</option>
                                <option value="0.1">10%</option>
                            </select>
                        </label>
                        <button
                            class="contextual-toolbar__button contextual-toolbar__button--icon contextual-toolbar__button--neutral"
                            data-object-action="toggle-lock" type="button" aria-label="Заблокировать фигуру"
                            aria-pressed="false" data-tooltip="Заблокировать" data-tooltip-position="bottom">
                            <svg class="contextual-toolbar__state-icon contextual-toolbar__lock-icon--closed"
                                aria-hidden="true" viewBox="0 0 24 24">
                                <rect x="5.5" y="10" width="13" height="10" rx="2"></rect>
                                <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"></path>
                                <path d="M12 14v2.5"></path>
                            </svg>
                            <svg class="contextual-toolbar__state-icon contextual-toolbar__lock-icon--open"
                                aria-hidden="true" viewBox="0 0 24 24">
                                <rect x="5.5" y="10" width="13" height="10" rx="2"></rect>
                                <path d="M15.5 10V7.5a3.5 3.5 0 0 0-6.8-1.2"></path>
                                <path d="M12 14v2.5"></path>
                            </svg>
                        </button>
                    </div>

                    <div class="contextual-toolbar__type-controls" data-object-toolbar="brush" role="group"
                        aria-label="Настройки кисти" hidden>
                        <label class="contextual-toolbar__color contextual-toolbar__color--stroke"
                            data-tooltip="Цвет линии" data-tooltip-position="bottom">
                            <span class="visually-hidden">Цвет линии кисти</span>
                            <input data-object-property="stroke" type="color" value="#282828">
                        </label>
                        <label class="contextual-toolbar__select" data-tooltip="Толщина кисти"
                            data-tooltip-position="bottom">
                            <span class="visually-hidden">Толщина кисти</span>
                            <select data-object-property="strokeWidth" aria-label="Толщина кисти">
                                <option value="2">Тонкая</option>
                                <option value="5">Средняя</option>
                                <option value="10">Толстая</option>
                                <option value="18">Очень толстая</option>
                            </select>
                        </label>
                    </div>

                    <div class="contextual-toolbar__type-controls" data-object-toolbar="arrow" role="group"
                        aria-label="Настройки стрелки или линии" hidden>
                        <label class="contextual-toolbar__color contextual-toolbar__color--stroke"
                            data-tooltip="Цвет линии" data-tooltip-position="bottom">
                            <span class="visually-hidden">Цвет стрелки или линии</span>
                            <input data-object-property="stroke" type="color" value="#282828">
                        </label>
                        <label class="contextual-toolbar__select" data-tooltip="Толщина линии"
                            data-tooltip-position="bottom">
                            <span class="visually-hidden">Толщина стрелки или линии</span>
                            <select data-object-property="strokeWidth" aria-label="Толщина стрелки или линии">
                                <option value="2">Тонкая</option>
                                <option value="5">Средняя</option>
                                <option value="10">Толстая</option>
                                <option value="18">Очень толстая</option>
                            </select>
                        </label>
                        <label class="contextual-toolbar__select contextual-toolbar__select--cap"
                            data-tooltip="Начало линии" data-tooltip-position="bottom">
                            <span class="visually-hidden">Оформление начала линии</span>
                            <select data-object-property="startCap" aria-label="Оформление начала линии">
                                <option value="none">Начало: без стрелки</option>
                                <option value="arrow1">Начало: стрелка 1</option>
                                <option value="arrow2">Начало: стрелка 2</option>
                            </select>
                        </label>
                        <label class="contextual-toolbar__select contextual-toolbar__select--cap"
                            data-tooltip="Конец линии" data-tooltip-position="bottom">
                            <span class="visually-hidden">Оформление конца линии</span>
                            <select data-object-property="endCap" aria-label="Оформление конца линии">
                                <option value="none">Конец: без стрелки</option>
                                <option value="arrow1">Конец: стрелка 1</option>
                                <option value="arrow2">Конец: стрелка 2</option>
                            </select>
                        </label>
                    </div>

                    <div class="contextual-toolbar__type-controls" data-object-toolbar="frame" role="group"
                        aria-label="Настройки фрейма" hidden>
                        <label class="contextual-toolbar__text-field contextual-toolbar__text-field--frame"
                            data-tooltip="Название фрейма" data-tooltip-position="bottom">
                            <span class="visually-hidden">Название фрейма</span>
                            <input data-object-property="name" type="text" maxlength="80" value=""
                                placeholder="Название фрейма" aria-label="Название фрейма" autocomplete="off">
                        </label>
                        <button
                            class="contextual-toolbar__button contextual-toolbar__button--neutral contextual-toolbar__remove-frame"
                            data-object-action="remove-frame" type="button"
                            aria-label="Удалить фрейм без удаления содержимого" data-tooltip="Удалить только фрейм"
                            data-tooltip-position="bottom">Убрать фрейм</button>
                    </div>

                    <div class="contextual-toolbar__type-controls" data-object-toolbar="highlighter" role="group"
                        aria-label="Настройки выделителя" hidden>
                        <label class="contextual-toolbar__color contextual-toolbar__color--stroke"
                            data-tooltip="Цвет выделителя" data-tooltip-position="bottom">
                            <span class="visually-hidden">Цвет выделителя</span>
                            <input data-object-property="stroke" type="color" value="#ffdf5d">
                        </label>
                        <label class="contextual-toolbar__select" data-tooltip="Толщина выделителя"
                            data-tooltip-position="bottom">
                            <span class="visually-hidden">Толщина выделителя</span>
                            <select data-object-property="strokeWidth" aria-label="Толщина выделителя">
                                <option value="16">Тонкий</option>
                                <option value="28">Средний</option>
                                <option value="40">Толстый</option>
                                <option value="56">Очень толстый</option>
                            </select>
                        </label>
                        <label class="contextual-toolbar__select contextual-toolbar__select--compact"
                            data-tooltip="Прозрачность выделителя" data-tooltip-position="bottom">
                            <span class="visually-hidden">Прозрачность выделителя</span>
                            <select data-object-property="opacity" aria-label="Прозрачность выделителя">
                                <option value="0.15">15%</option>
                                <option value="0.25">25%</option>
                                <option value="0.35">35%</option>
                                <option value="0.5">50%</option>
                            </select>
                        </label>
                    </div>

                    <div class="contextual-toolbar__type-controls" data-object-toolbar="sticker" role="group"
                        aria-label="Настройки стикера" hidden>
                        <label class="contextual-toolbar__color" data-tooltip="Цвет стикера"
                            data-tooltip-position="bottom">
                            <span class="visually-hidden">Цвет стикера</span>
                            <input data-object-property="fill" type="color" value="#ffdf6b">
                        </label>
                        <label class="contextual-toolbar__color contextual-toolbar__color--stroke"
                            data-tooltip="Цвет текста" data-tooltip-position="bottom">
                            <span class="visually-hidden">Цвет текста стикера</span>
                            <input data-object-property="textColor" type="color" value="#282828">
                        </label>
                        <label class="contextual-toolbar__select contextual-toolbar__select--compact contextual-toolbar__select--font"
                            data-tooltip="Шрифт текста стикера" data-tooltip-position="bottom">
                            <span class="visually-hidden">Шрифт стикера</span>
                            <select data-object-property="fontFamily" aria-label="Шрифт текста стикера">
                                <option value="Roboto">Базовый</option>
                                <option value="Inter">Модерн</option>
                                <option value="Georgia">Классический</option>
                                <option value="Comic Sans MS">Рукописный</option>
                                <option value="Roboto Condensed">Технический</option>
                            </select>
                        </label>
                        <div class="contextual-toolbar__align-menu" data-align-popover-root>
                            <button
                                class="contextual-toolbar__button contextual-toolbar__button--icon contextual-toolbar__button--neutral contextual-toolbar__align-trigger"
                                data-object-action="toggle-align-popover" data-role="align-trigger" data-align="left"
                                type="button" aria-label="Выравнивание текста стикера: по левому краю"
                                aria-haspopup="menu" aria-expanded="false" aria-controls="sticker-align-popover"
                                data-tooltip="Выравнивание текста" data-tooltip-position="bottom">≡</button>
                            <div class="contextual-toolbar__align-popover" id="sticker-align-popover"
                                data-role="align-popover" role="menu" aria-label="Выравнивание текста стикера" hidden>
                                <button
                                    class="contextual-toolbar__button contextual-toolbar__button--icon contextual-toolbar__button--neutral"
                                    data-object-action="set-align" data-value="left" type="button" role="menuitem"
                                    aria-label="По левому краю">≡</button>
                                <button
                                    class="contextual-toolbar__button contextual-toolbar__button--icon contextual-toolbar__button--neutral"
                                    data-object-action="set-align" data-value="center" type="button" role="menuitem"
                                    aria-label="По центру">≡</button>
                                <button
                                    class="contextual-toolbar__button contextual-toolbar__button--icon contextual-toolbar__button--neutral"
                                    data-object-action="set-align" data-value="right" type="button" role="menuitem"
                                    aria-label="По правому краю">≡</button>
                            </div>
                        </div>
                    </div>

                    <div class="contextual-toolbar__type-controls" data-object-toolbar="text" role="group"
                        aria-label="Настройки текста" hidden>
                        <label class="contextual-toolbar__color" data-tooltip="Цвет текста"
                            data-tooltip-position="bottom">
                            <span class="visually-hidden">Цвет текста</span>
                            <input data-object-property="fill" type="color" value="#282828">
                        </label>
                        <label class="contextual-toolbar__select contextual-toolbar__select--compact contextual-toolbar__select--font"
                            data-tooltip="Шрифт текста" data-tooltip-position="bottom">
                            <span class="visually-hidden">Шрифт</span>
                            <select data-object-property="fontFamily" aria-label="Шрифт текста">
                                <option value="Roboto">Базовый</option>
                                <option value="Inter">Модерн</option>
                                <option value="Georgia">Классический</option>
                                <option value="Comic Sans MS">Рукописный</option>
                                <option value="Roboto Condensed">Технический</option>
                            </select>
                        </label>
                        <div class="contextual-toolbar__align-menu" data-align-popover-root>
                            <button
                                class="contextual-toolbar__button contextual-toolbar__button--icon contextual-toolbar__button--neutral contextual-toolbar__align-trigger"
                                data-object-action="toggle-align-popover" data-role="align-trigger" data-align="left"
                                type="button" aria-label="Выравнивание текста: по левому краю" aria-haspopup="menu"
                                aria-expanded="false" aria-controls="text-align-popover"
                                data-tooltip="Выравнивание текста" data-tooltip-position="bottom">≡</button>
                            <div class="contextual-toolbar__align-popover" id="text-align-popover"
                                data-role="align-popover" role="menu" aria-label="Выравнивание текста" hidden>
                                <button
                                    class="contextual-toolbar__button contextual-toolbar__button--icon contextual-toolbar__button--neutral"
                                    data-object-action="set-align" data-value="left" type="button" role="menuitem"
                                    aria-label="По левому краю" data-tooltip="По левому краю"
                                    data-tooltip-position="top">≡</button>
                                <button
                                    class="contextual-toolbar__button contextual-toolbar__button--icon contextual-toolbar__button--neutral"
                                    data-object-action="set-align" data-value="center" type="button" role="menuitem"
                                    aria-label="По центру" data-tooltip="По центру"
                                    data-tooltip-position="top">≡</button>
                                <button
                                    class="contextual-toolbar__button contextual-toolbar__button--icon contextual-toolbar__button--neutral"
                                    data-object-action="set-align" data-value="right" type="button" role="menuitem"
                                    aria-label="По правому краю" data-tooltip="По правому краю"
                                    data-tooltip-position="top">≡</button>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="contextual-toolbar__group-actions" data-role="contextual-group-actions"
                    role="group" aria-label="Группировка объектов" hidden>
                    <button
                        class="contextual-toolbar__button contextual-toolbar__button--icon contextual-toolbar__button--neutral"
                        data-editor-command="group" type="button" aria-label="Сгруппировать объекты"
                        data-tooltip="Сгруппировать" data-tooltip-position="bottom" hidden>
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                            <rect x="3.5" y="3.5" width="7" height="7" rx="1.5"></rect>
                            <rect x="13.5" y="13.5" width="7" height="7" rx="1.5"></rect>
                            <path d="M8 14v2a2 2 0 0 0 2 2h2M16 10V8a2 2 0 0 0-2-2h-2"></path>
                        </svg>
                    </button>
                    <button
                        class="contextual-toolbar__button contextual-toolbar__button--icon contextual-toolbar__button--neutral"
                        data-editor-command="ungroup" type="button" aria-label="Разгруппировать объекты"
                        data-tooltip="Разгруппировать" data-tooltip-position="bottom" hidden>
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                            <rect x="3.5" y="3.5" width="7" height="7" rx="1.5"></rect>
                            <rect x="13.5" y="13.5" width="7" height="7" rx="1.5"></rect>
                            <path d="M12 18h-2a2 2 0 0 1-2-2v-2M12 6h2a2 2 0 0 1 2 2v2"></path>
                            <path d="m12.5 14 3.5-4m-3.5 0 3.5 4"></path>
                        </svg>
                    </button>
                </div>
                <span class="contextual-toolbar__divider" aria-hidden="true"></span>
                <button
                    class="contextual-toolbar__button contextual-toolbar__button--icon contextual-toolbar__button--neutral"
                    data-editor-command="duplicate" type="button" aria-label="Дублировать" data-tooltip="Дублировать"
                    data-tooltip-position="bottom">
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                        <rect x="8" y="8" width="11" height="11" rx="2"></rect>
                        <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"></path>
                    </svg>
                </button>
                <button
                    class="contextual-toolbar__button contextual-toolbar__button--icon contextual-toolbar__button--neutral"
                    data-editor-command="send-to-back" type="button" aria-label="На задний план"
                    data-tooltip="На задний план" data-tooltip-position="bottom">
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="M12 4v12M7.5 11.5 12 16l4.5-4.5M6 20h12"></path>
                    </svg>
                </button>
                <button
                    class="contextual-toolbar__button contextual-toolbar__button--icon contextual-toolbar__button--neutral"
                    data-editor-command="bring-to-front" type="button" aria-label="На передний план"
                    data-tooltip="На передний план" data-tooltip-position="bottom">
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="M12 20V8M7.5 12.5 12 8l4.5 4.5M6 4h12"></path>
                    </svg>
                </button>
                <button class="contextual-toolbar__button contextual-toolbar__button--icon" data-editor-command="delete"
                    type="button" aria-label="Удалить" data-tooltip="Удалить" data-tooltip-position="bottom">
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path
                            d="M6 7V18C6 19.1046 6.89543 20 8 20H16C17.1046 20 18 19.1046 18 18V7M6 7H5M6 7H8M18 7H19M18 7H16M10 11V16M14 11V16M8 7V5C8 3.89543 8.89543 3 10 3H14C15.1046 3 16 3.89543 16 5V7M8 7H16">
                        </path>
                    </svg>
                </button>
                <div class="contextual-toolbar__more" data-contextual-more-root>
                    <button
                        class="contextual-toolbar__button contextual-toolbar__button--icon contextual-toolbar__button--neutral contextual-toolbar__more-trigger"
                        data-object-action="toggle-contextual-more" data-role="contextual-more-trigger" type="button"
                        aria-label="Дополнительные инструменты" aria-haspopup="menu" aria-expanded="false"
                        aria-controls="contextual-more-menu" data-tooltip="Дополнительные инструменты"
                        data-tooltip-position="bottom">
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                            <path d="m7 9 5 5 5-5"></path>
                        </svg>
                    </button>
                    <div class="contextual-toolbar__more-menu" id="contextual-more-menu"
                        data-role="contextual-more-menu" role="menu" aria-label="Дополнительные инструменты" hidden>
                        <button class="contextual-toolbar__more-item" data-editor-command="send-backward"
                            type="button" role="menuitem">
                            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 5v12M7.5 12.5 12 17l4.5-4.5"></path></svg>
                            <span>Опустить на один слой</span>
                        </button>
                        <button class="contextual-toolbar__more-item" data-editor-command="bring-forward"
                            type="button" role="menuitem">
                            <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 19V7M7.5 11.5 12 7l4.5 4.5"></path></svg>
                            <span>Поднять на один слой</span>
                        </button>
                        <div class="contextual-toolbar__more-field" data-more-types="frame" hidden>
                            <span>Фон фрейма</span>
                            <span class="contextual-toolbar__more-inline">
                                <label class="contextual-toolbar__color" data-tooltip="Цвет фона фрейма"
                                    data-tooltip-position="left">
                                    <span class="visually-hidden">Цвет фона фрейма</span>
                                    <input data-object-property="backgroundColor" type="color" value="#ffffff">
                                </label>
                                <label class="contextual-toolbar__select contextual-toolbar__select--compact contextual-toolbar__select--frame-background">
                                    <span class="visually-hidden">Прозрачность фона фрейма</span>
                                    <select data-object-property="backgroundOpacity" aria-label="Прозрачность фона фрейма">
                                        <option value="0">Без фона</option>
                                        <option value="0.25">25%</option>
                                        <option value="0.5">50%</option>
                                        <option value="0.75">75%</option>
                                        <option value="1">100%</option>
                                    </select>
                                </label>
                            </span>
                        </div>
                        <label class="contextual-toolbar__more-field contextual-toolbar__more-field--checkbox"
                            data-more-types="frame" hidden>
                            <input type="checkbox" data-object-action="toggle-frame-clip"
                                data-role="frame-clip-toggle" aria-label="Обрезать объекты за краем">
                            <span>Обрезать объекты за краем</span>
                        </label>
                        <label class="contextual-toolbar__more-field" data-more-types="frame" hidden>
                            <span>Компановка</span>
                            <span class="contextual-toolbar__select contextual-toolbar__select--compact contextual-toolbar__select--frame-grid">
                                <select data-object-property="layoutGridColumns" aria-label="Сетка компоновки фрейма">
                                    <option value="0">Без сетки</option>
                                    <option value="2">2 колонки</option>
                                    <option value="3">3 колонки</option>
                                    <option value="4">4 колонки</option>
                                    <option value="6">6 колонок</option>
                                    <option value="12">12 колонок</option>
                                </select>
                            </span>
                        </label>
                        <button class="contextual-toolbar__more-item" data-object-action="replace-image"
                            data-more-types="image" type="button" role="menuitem" hidden>
                            <svg aria-hidden="true" viewBox="0 0 24 24">
                                <rect x="3" y="3" width="6" height="6" rx="1"></rect>
                                <rect x="15" y="15" width="6" height="6" rx="1"></rect>
                                <path d="M21 11V8a2 2 0 0 0-2-2h-6l3 3m0-6-3 3"></path>
                                <path d="M3 13v3a2 2 0 0 0 2 2h6l-3-3m0 6 3-3"></path>
                            </svg>
                            <span>Заменить изображение</span>
                        </button>
                        <div class="contextual-toolbar__more-field" data-more-types="text sticker" hidden>
                            <span>Размер текста</span>
                            <div class="contextual-toolbar__font-size" role="group" aria-label="Размер текста">
                                <input data-object-property="fontSize" type="number" min="8" max="240" step="1"
                                    inputmode="numeric" value="24" aria-label="Размер текста">
                                <span class="contextual-toolbar__font-size-stepper">
                                    <button data-object-action="step-font-size" data-step="1" type="button"
                                        aria-label="Увеличить размер текста">
                                        <svg aria-hidden="true" viewBox="0 0 10 6"><path d="m1 5 4-4 4 4"></path></svg>
                                    </button>
                                    <button data-object-action="step-font-size" data-step="-1" type="button"
                                        aria-label="Уменьшить размер текста">
                                        <svg aria-hidden="true" viewBox="0 0 10 6"><path d="m1 1 4 4 4-4"></path></svg>
                                    </button>
                                </span>
                            </div>
                        </div>
                        <label class="contextual-toolbar__more-field" data-role="rotation-control"
                            data-more-types="image shape text brush arrow frame sticker highlighter" hidden>
                            <span>Угол поворота</span>
                            <span class="contextual-toolbar__rotation">
                                <input data-object-property="rotation" type="number" min="-360" max="360" step="1"
                                    value="0" aria-label="Угол поворота в градусах">
                                <span aria-hidden="true">°</span>
                            </span>
                        </label>
                        <button class="contextual-toolbar__more-item" data-object-action="edit-link"
                            data-more-types="image shape sticker" type="button" role="menuitem"
                            aria-label="Добавить ссылку" aria-pressed="false" hidden>
                            <svg aria-hidden="true" viewBox="0 0 24 24">
                                <path d="m16.5 6.5-7.8 7.8a2.5 2.5 0 0 0 3.6 3.5l7.7-7.7a4 4 0 0 0-5.6-5.7l-7.8 7.8a5.5 5.5 0 0 0 7.8 7.8l7.8-7.8"></path>
                            </svg>
                            <span>Добавить ссылку</span>
                        </button>
                        <button class="contextual-toolbar__more-item" data-object-action="toggle-lock"
                            data-more-types="text brush arrow frame sticker highlighter" type="button" role="menuitem"
                            aria-label="Заблокировать объект" aria-pressed="false" hidden>
                            <svg class="contextual-toolbar__state-icon contextual-toolbar__lock-icon--closed"
                                aria-hidden="true" viewBox="0 0 24 24">
                                <rect x="5.5" y="10" width="13" height="10" rx="2"></rect>
                                <path d="M8.5 10V7.5a3.5 3.5 0 0 1 7 0V10"></path>
                            </svg>
                            <svg class="contextual-toolbar__state-icon contextual-toolbar__lock-icon--open"
                                aria-hidden="true" viewBox="0 0 24 24">
                                <rect x="5.5" y="10" width="13" height="10" rx="2"></rect>
                                <path d="M15.5 10V7.5a3.5 3.5 0 0 0-6.8-1.2"></path>
                            </svg>
                            <span data-role="contextual-lock-label">Заблокировать</span>
                        </button>
                    </div>
                </div>
                <form class="contextual-toolbar__link-editor" data-role="toolbar-link-editor" hidden>
                    <label data-tooltip="Адрес ссылки" data-tooltip-position="bottom">
                        <span>Ссылка</span>
                        <input data-role="toolbar-link-input" type="url" inputmode="url" maxlength="2048"
                            placeholder="https://example.com/product" autocomplete="off">
                    </label>
                    <div>
                        <button class="button button--primary" type="submit">Сохранить</button>
                        <button class="button button--secondary" data-object-action="remove-link" type="button">Удалить
                            ссылку</button>
                    </div>
                </form>
            </div>

            <div class="canvas-context-menu" data-role="canvas-context-menu" role="menu" aria-label="Действия с холстом"
                hidden></div>

            <div class="editor-notification" data-role="notification" role="status" aria-live="polite" hidden></div>

            <div class="recovery-draft" data-role="recovery-draft" hidden>
                <section class="recovery-draft__dialog" role="alertdialog" aria-modal="true"
                    aria-labelledby="recovery-draft-title" aria-describedby="recovery-draft-message">
                    <div class="recovery-draft__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24">
                            <path d="M12 3a9 9 0 1 1-8.4 5.8"></path>
                            <path d="M3 4v5h5M12 7v5l3 2"></path>
                        </svg>
                    </div>
                    <div class="recovery-draft__content">
                        <strong id="recovery-draft-title">Восстановить изменения?</strong>
                        <p id="recovery-draft-message" data-role="recovery-draft-message">
                            Найдено состояние, которое не успело сохраниться.
                        </p>
                        <div class="recovery-draft__actions">
                            <button class="button button--primary" data-action="restore-recovery-draft"
                                type="button">Восстановить</button>
                            <button class="button button--secondary" data-action="discard-recovery-draft"
                                type="button">Не восстанавливать</button>
                        </div>
                    </div>
                </section>
            </div>

            <div class="canvas-navigator" data-role="canvas-navigator">
                <section class="canvas-navigator__popover" id="canvas-navigator-popover" data-role="navigator-popover"
                    role="dialog" aria-labelledby="navigator-title" hidden>
                    <header>
                        <strong id="navigator-title">Навигатор</strong>
                        <span>Перетащите область просмотра</span>
                    </header>
                    <div class="canvas-navigator__map" data-role="navigator-map" role="application" tabindex="0"
                        aria-label="Миникарта холста. Нажмите или перетащите для перемещения">
                        <div class="canvas-navigator__surface" data-role="navigator-surface">
                            <div class="canvas-navigator__elements" data-role="navigator-elements"></div>
                            <div class="canvas-navigator__viewport" data-role="navigator-viewport"></div>
                        </div>
                    </div>
                </section>
                <div class="zoom-controls" aria-label="Масштаб и навигация редактора">
                    <button class="icon-button" data-action="zoom-out" data-editor-control type="button"
                        aria-label="Уменьшить масштаб" data-tooltip="Уменьшить" disabled>−</button>
                    <button class="zoom-controls__value" data-action="toggle-navigator" data-editor-control
                        type="button" aria-haspopup="dialog" aria-expanded="false"
                        aria-controls="canvas-navigator-popover" disabled>
                        <span data-role="zoom-value">100%</span>
                        <svg class="zoom-controls__chevron" aria-hidden="true" viewBox="0 0 16 16" width="14"
                            height="14">
                            <path d="m4 6 4 4 4-4"></path>
                        </svg>
                    </button>
                    <button class="icon-button" data-action="zoom-in" data-editor-control type="button"
                        aria-label="Увеличить масштаб" data-tooltip="Увеличить" disabled>＋</button>
                    <button class="zoom-controls__fit" data-action="fit" data-editor-control type="button"
                        title="Вписать холст" disabled>По размеру</button>
                </div>
            </div>

            <div class="editor-help">
                <button class="editor-help__trigger" data-action="toggle-help" type="button"
                    aria-label="Открыть справку и горячие клавиши" aria-haspopup="dialog" aria-expanded="false"
                    aria-controls="editor-help-popover">?</button>
                <section class="editor-help__popover" id="editor-help-popover" data-role="help-popover" role="dialog"
                    aria-labelledby="editor-help-title" hidden>
                    <header class="editor-help__header">
                        <div class="layer-map__heading">
                            <strong id="editor-help-title">Справка</strong>
                            <span data-role="help-subtitle">Горячие клавиши редактора</span>
                        </div>
                    </header>
                    <table class="editor-help__table">
                        <tbody data-role="hotkeys-table"></tbody>
                    </table>
                </section>
            </div>

            <div class="layer-map">
                <button class="layer-map__trigger" data-action="toggle-layer-map" type="button"
                    aria-label="Открыть карту слоёв" aria-haspopup="dialog" aria-expanded="false"
                    aria-controls="layer-map-popover" data-tooltip="Карта слоёв" data-tooltip-position="top">
                    <svg aria-hidden="true" viewBox="0 0 24 24">
                        <path d="m12 3 8 4-8 4-8-4 8-4Z"></path>
                        <path d="m4 12 8 4 8-4"></path>
                        <path d="m4 17 8 4 8-4"></path>
                    </svg>
                </button>
                <section class="layer-map__popover" id="layer-map-popover" data-role="layer-map-popover" role="dialog"
                    aria-labelledby="layer-map-title" hidden>
                    <header class="layer-map__header">
                        <div>
                            <strong id="layer-map-title">Карта слоёв</strong>
                            <span data-role="layer-map-page-name">Лист</span>
                        </div>
                        <span data-role="layer-map-count">0 элементов</span>
                    </header>
                    <div class="layer-map__stats" aria-live="polite">
                        <span data-role="layer-map-selected-count">Выбрано: 0</span>
                        <span data-role="layer-map-locked-count">Заблокировано: 0</span>
                    </div>
                    <button class="layer-map__navigation-toggle" data-action="toggle-layer-map-navigation"
                        type="button" aria-label="Показать навигацию по слоям" aria-expanded="false"
                        aria-controls="layer-map-navigation">
                        <span>Навигация по слоям</span>
                        <svg aria-hidden="true" viewBox="0 0 24 24">
                            <path d="m7 9 5 5 5-5"></path>
                        </svg>
                    </button>
                    <div class="layer-map__filters" id="layer-map-navigation"
                        data-role="layer-map-navigation" hidden>
                        <label class="layer-map__search">
                            <span class="visually-hidden">Поиск слоёв</span>
                            <svg aria-hidden="true" viewBox="0 0 24 24">
                                <circle cx="10.5" cy="10.5" r="6.5"></circle>
                                <path d="m15.5 15.5 5 5"></path>
                            </svg>
                            <input data-role="layer-map-search" type="search" maxlength="120"
                                placeholder="Найти слой, тип или ссылку" autocomplete="off">
                        </label>
                        <div class="layer-map__filter-row">
                            <label>
                                <span class="visually-hidden">Фильтр по типу слоя</span>
                                <select data-role="layer-map-type-filter" aria-label="Фильтр по типу слоя">
                                    <option value="all">Все типы</option>
                                    <option value="image">Изображения</option>
                                    <option value="text">Текст</option>
                                    <option value="shape">Фигуры</option>
                                    <option value="sticker">Стикеры</option>
                                    <option value="brush">Кисть</option>
                                    <option value="highlighter">Выделитель</option>
                                    <option value="arrow">Стрелки и линии</option>
                                    <option value="frame">Фреймы</option>
                                    <option value="group">Группы</option>
                                </select>
                            </label>
                            <label>
                                <span class="visually-hidden">Фильтр по связям слоя</span>
                                <select data-role="layer-map-scope-filter" aria-label="Фильтр по связям слоя">
                                    <option value="all">Все слои</option>
                                    <option value="linked">Со ссылкой</option>
                                    <option value="framed">Внутри фрейма</option>
                                    <option value="unframed">Вне фрейма</option>
                                </select>
                            </label>
                            <button class="layer-map__clear" data-action="clear-layer-map-filters" type="button"
                                aria-label="Сбросить поиск и фильтры" data-tooltip="Сбросить фильтры"
                                data-tooltip-position="bottom" hidden>×</button>
                        </div>
                    </div>
                    <div class="layer-map__tree" data-role="layer-map-tree" role="tree"
                        aria-label="Иерархия слоёв активного листа"></div>
                    <div class="layer-map__empty" data-role="layer-map-empty" hidden>
                        <span aria-hidden="true">◇</span>
                        <strong data-role="layer-map-empty-title">На листе пока нет элементов</strong>
                        <p data-role="layer-map-empty-text">Добавленные объекты появятся здесь в порядке слоёв.</p>
                    </div>
                    <p class="layer-map__note">Двойной клик — переименовать. Перетащивание — изменить слой. ПКМ — действия.</p>
                </section>
            </div>
        </section>
    </main>
</div>
<?php require __DIR__ . '/includes/footer.php'; ?>
