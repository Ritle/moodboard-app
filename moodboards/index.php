<?php

declare(strict_types=1);
require __DIR__ . '/includes/demo_guard.php';
$pageTitle = 'MoodBoards — мои доски';
$pageDescription = 'Список локальных демонстрационных мудбордов';
$bodyClass = 'moodboards-page';
$pageStyles = ['/moodboards/assets/css/moodboards.css'];
$pageModule = '/moodboards/assets/js/moodboards-page.js';

require __DIR__ . '/includes/header.php';

?>
<div class="app-shell" data-page="moodboards">
    <header class="roomplan-shell-header">
        <div class="roomplan-global-bar">
            <div class="roomplan-global-bar__brand">
                <a class="roomplan-logo" href="/moodboards/index.php" aria-label="Мудборды — главная">
                    <img src="/moodboards/assets/img/logo.svg" width="140" height="28" alt="RoomPlan">
                </a>
                <span class="roomplan-studio-badge">Мудборды</span>
            </div>

            <nav class="roomplan-global-nav" aria-label="Навигация RoomPlan">
                <a href="https://roomplan.ru/help.php">FAQ</a>
                <a href="https://roomplan.ru/blog.php">Энциклопедия дизайна</a>
                <a href="https://roomplan.ru/reviews.php">Отзывы</a>
                <a href="https://roomplan.ru/order.php">Тарифы</a>
                <a href="https://roomplan.ru/support.php">Поддержка</a>
            </nav>

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

        <nav class="roomplan-products" aria-label="Продукты RoomPlan">
            <button
                class="roomplan-product"
                data-action="header-placeholder"
                data-message="Планировщик RoomPlan будет доступен после интеграции модулей."
                type="button"
            >
                <span class="roomplan-product__icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="22" height="22">
                        <path d="M5 10.5 12 5l7 5.5V20H5z"></path>
                        <path d="M9 20v-6h6v6"></path>
                    </svg>
                </span>
                <span class="roomplan-product__copy">
                    <strong>Мои проекты</strong>
                    <small>Планировщик RoomPlan</small>
                </span>
            </button>

            <button
                class="roomplan-product"
                data-action="header-placeholder"
                data-message="ИИ Студия дизайна пока не подключена к демо MoodBoards."
                type="button"
            >
                <span class="roomplan-product__icon roomplan-product__icon--studio" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="22" height="22">
                        <circle cx="12" cy="12" r="4"></circle>
                        <path d="M12 2.5V5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3 7 7m10 10 1.7 1.7m0-13.4L17 7M7 17l-1.7 1.7"></path>
                    </svg>
                </span>
                <span class="roomplan-product__copy">
                    <strong>ИИ студия дизайна</strong>
                    <small>Генерация и рендер интерьеров</small>
                </span>
            </button>

            <a class="roomplan-product roomplan-product--active" href="/moodboards/index.php" aria-current="page">
                <span class="roomplan-product__icon roomplan-product__icon--moodboards" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="22" height="22">
                        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5"></rect>
                        <rect x="13.5" y="3.5" width="7" height="11" rx="1.5"></rect>
                        <rect x="3.5" y="13.5" width="7" height="7" rx="1.5"></rect>
                        <rect x="13.5" y="17.5" width="7" height="3" rx="1.5"></rect>
                    </svg>
                </span>
                <span class="roomplan-product__copy">
                    <strong>Мудборды</strong>
                    <small>Коллажи, материалы и идеи</small>
                </span>
                <span class="roomplan-product__status">Демо</span>
            </a>
        </nav>
    </header>

    <main class="moodboards-main">
        <section class="page-heading" aria-labelledby="moodboards-title">
            <div>
                <p class="eyebrow">Мои проекты</p>
                <h1 id="moodboards-title">Мудборды</h1>
                <p class="page-heading__description">Собирайте референсы, материалы и идеи в одном пространстве.</p>
            </div>
            <div class="page-heading__actions">
                <button class="button button--secondary template-launch-button" data-action="open-templates" data-list-control type="button">
                    <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
                        <rect x="3.5" y="3.5" width="7" height="7" rx="1.5"></rect>
                        <rect x="13.5" y="3.5" width="7" height="7" rx="1.5"></rect>
                        <rect x="3.5" y="13.5" width="7" height="7" rx="1.5"></rect>
                        <rect x="13.5" y="13.5" width="7" height="7" rx="1.5"></rect>
                    </svg>
                    <span>Создать из шаблона</span>
                </button>
            </div>
        </section>

        <section class="moodboards-content" aria-live="polite" aria-busy="true">
            <div class="loading-state" data-state="loading" role="status">
                <span class="spinner" aria-hidden="true"></span>
                <div>
                    <strong>Загружаем ваши доски</strong>
                    <p>Открываем локальное рабочее пространство…</p>
                </div>
            </div>

            <div class="list-error-state" data-state="error" role="alert" hidden>
                <span class="list-error-state__icon" aria-hidden="true">!</span>
                <h2>Не удалось открыть локальные доски</h2>
                <p>Проверьте, доступна ли IndexedDB, и повторите попытку.</p>
                <button class="button button--secondary" type="button" data-action="retry-list" data-list-control>
                    Повторить
                </button>
            </div>

            <div class="moodboards-list-state" data-state="grid" hidden>
                <div class="moodboards-grid" data-role="active-grid" role="list" aria-label="Активные мудборды">
                    <div class="empty-state" data-role="empty-state" role="listitem" hidden>
                        <div class="empty-state__art" aria-hidden="true">
                            <span class="empty-state__sample empty-state__sample--large"></span>
                            <span class="empty-state__sample empty-state__sample--small"></span>
                            <span class="empty-state__label">ИДЕИ</span>
                        </div>
                        <h2>Начните с чистой доски</h2>
                        <p>Используйте первую плитку, чтобы создать мудборд. Он сохранится в локальном хранилище этого браузера.</p>
                        <span class="empty-state__hint">Данные не отправляются на сервер</span>
                    </div>
                </div>

                <section class="moodboards-archive" aria-labelledby="archive-title">
                    <header class="moodboards-archive__heading">
                        <div>
                            <p class="eyebrow">Хранилище</p>
                            <h2 id="archive-title">Архивные мудборды</h2>
                        </div>
                        <span class="moodboards-archive__count" data-role="archive-count" aria-live="polite">0</span>
                    </header>
                    <div class="moodboards-grid moodboards-grid--archive" data-role="archive-grid" role="list" aria-label="Архивные мудборды">
                        <div class="archive-empty" data-role="archive-empty" role="listitem" hidden>
                            <span class="archive-empty__icon" aria-hidden="true">▱</span>
                            <div>
                                <strong>Архив пока пуст</strong>
                                <p>Перемещённые сюда доски можно восстановить или удалить навсегда.</p>
                            </div>
                        </div>
                    </div>
                </section>
            </div>
        </section>
    </main>

    <div class="modal modal--templates" data-role="modal" data-modal="templates" aria-hidden="true" hidden>
        <div class="modal__dialog template-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="templates-title" aria-describedby="templates-description">
            <form data-role="template-form">
                <div class="modal__header template-modal__header">
                    <div>
                        <p class="eyebrow">Быстрый старт</p>
                        <h2 id="templates-title">Создать из шаблона</h2>
                        <p id="templates-description">Выберите основу — все элементы можно изменить в редакторе.</p>
                    </div>
                    <button class="icon-button" type="button" data-action="close-modal" aria-label="Закрыть шаблоны" data-tooltip="Закрыть" data-tooltip-position="bottom">×</button>
                </div>
                <div class="template-grid" data-role="template-grid" role="list" aria-label="Шаблоны мудбордов"></div>
                <p class="form-error template-modal__error" data-role="form-error" role="alert"></p>
            </form>
        </div>
    </div>

    <div class="modal" data-role="modal" data-modal="rename" aria-hidden="true" hidden>
        <div class="modal__dialog" role="dialog" aria-modal="true" aria-labelledby="rename-title">
            <form data-role="rename-form" novalidate>
                <div class="modal__header">
                    <div>
                        <p class="eyebrow">Настройки доски</p>
                        <h2 id="rename-title">Переименовать мудборд</h2>
                    </div>
                    <button class="icon-button" type="button" data-action="close-modal" aria-label="Закрыть" data-tooltip="Закрыть" data-tooltip-position="bottom">×</button>
                </div>
                <label class="form-field">
                    <span>Название</span>
                    <input type="text" data-role="rename-input" maxlength="160" autocomplete="off" aria-describedby="rename-error" required>
                </label>
                <p class="form-error" id="rename-error" data-role="form-error" role="alert"></p>
                <div class="modal__actions">
                    <button class="button button--secondary" type="button" data-action="close-modal">Отмена</button>
                    <button class="button button--primary" type="submit">Сохранить</button>
                </div>
            </form>
        </div>
    </div>

    <div class="modal" data-role="modal" data-modal="delete" aria-hidden="true" hidden>
        <div class="modal__dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title" aria-describedby="delete-description">
            <form data-role="delete-form">
                <div class="modal__header">
                    <div>
                        <p class="eyebrow">Необратимое действие</p>
                        <h2 id="delete-title">Удалить мудборд навсегда?</h2>
                    </div>
                    <button class="icon-button" type="button" data-action="close-modal" aria-label="Закрыть" data-tooltip="Закрыть" data-tooltip-position="bottom">×</button>
                </div>
                <p class="modal__description" id="delete-description">
                    Архивная доска «<strong data-role="delete-name"></strong>» и связанные изображения будут безвозвратно удалены из этого браузера.
                </p>
                <p class="form-error" data-role="form-error" role="alert"></p>
                <div class="modal__actions">
                    <button class="button button--secondary" type="button" data-action="close-modal">Отмена</button>
                    <button class="button button--danger" type="submit" data-action="confirm-delete">Удалить</button>
                </div>
            </form>
        </div>
    </div>

    <div class="notifications" data-role="notifications" aria-label="Уведомления" aria-live="polite" aria-atomic="false"></div>
</div>
<?php require __DIR__ . '/includes/footer.php'; ?>
