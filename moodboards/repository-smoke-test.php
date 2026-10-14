<?php

declare(strict_types=1);

$pageTitle = 'MoodBoards — проверка IndexedDB';
$pageDescription = 'Браузерная проверка локального хранилища мудбордов';
$bodyClass = 'repository-smoke-test-page';
$pageStyles = ['/moodboards/assets/css/repository-smoke-test.css'];
$pageModule = '/moodboards/assets/js/tests/repository-smoke-test.js';

require __DIR__ . '/includes/header.php';
?>
<main class="smoke-test-page">
    <section class="smoke-test" aria-labelledby="smoke-test-title">
        <div class="smoke-test__header">
            <div>
                <p class="eyebrow">Диагностика хранилища</p>
                <h1 id="smoke-test-title">Проверка локального хранилища IndexedDB</h1>
                <p class="smoke-test__lead">
                    Проверка выполняется в отдельной временной базе и не затрагивает пользовательские мудборды.
                </p>
            </div>
            <button class="button button--primary" type="button" data-action="run-smoke-test">
                Запустить снова
            </button>
        </div>

        <div class="smoke-test__summary" data-test-summary role="status" aria-live="polite">
            Подготовка тестов…
        </div>
        <ol class="smoke-test__results" data-test-results aria-label="Результаты проверки"></ol>
    </section>
</main>
<?php require __DIR__ . '/includes/footer.php'; ?>
