<?php

declare(strict_types=1);

$pageTitle = $pageTitle ?? 'MoodBoards';
$pageDescription = $pageDescription ?? 'Автономное демо редактора MoodBoards';
$pageStyles = $pageStyles ?? [];
$bodyClass = $bodyClass ?? '';

$config = require __DIR__ . '/config.php';
$demoModeEnabled = isset($_GET['mode']) && $_GET['mode'] === 'view';
$demoPresets = require __DIR__ . '/background-removal-presets.php';
$demoPresetIds = array_keys($demoPresets);
$requestedDemoPreset = trim((string) ($_GET['mock_preset'] ?? ''));
$selectedDemoPreset = in_array($requestedDemoPreset, $demoPresetIds, true)
    ? $requestedDemoPreset
    : 'preset_0';
$bodyClass = trim($bodyClass . ($demoModeEnabled ? ' moodboards-demo-mode' : ''));
$versionedAssetUrl = static function (string $url): string {
    $path = parse_url($url, PHP_URL_PATH);
    $publicPrefix = '/moodboards/';
    if (!is_string($path) || strncmp($path, $publicPrefix, strlen($publicPrefix)) !== 0) {
        return $url;
    }
    $filesystemPath = dirname(__DIR__) . DIRECTORY_SEPARATOR
        . str_replace('/', DIRECTORY_SEPARATOR, substr($path, strlen($publicPrefix)));
    if (!is_file($filesystemPath)) {
        return $url;
    }
    return $url . (strpos($url, '?') !== false ? '&' : '?') . 'v=' . filemtime($filesystemPath);
};
$moduleImports = [];
$javascriptDirectory = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'assets' . DIRECTORY_SEPARATOR . 'js';
if (is_dir($javascriptDirectory)) {
    $javascriptFiles = new RecursiveIteratorIterator(
        new RecursiveDirectoryIterator($javascriptDirectory, FilesystemIterator::SKIP_DOTS)
    );
    foreach ($javascriptFiles as $javascriptFile) {
        if (!$javascriptFile->isFile() || strtolower($javascriptFile->getExtension()) !== 'js') {
            continue;
        }
        $relativePath = substr($javascriptFile->getPathname(), strlen($javascriptDirectory) + 1);
        $publicPath = '/moodboards/assets/js/'
            . str_replace(DIRECTORY_SEPARATOR, '/', $relativePath);
        $moduleImports[$publicPath] = $versionedAssetUrl($publicPath);
    }
    ksort($moduleImports);
}
?>
<!doctype html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="<?= htmlspecialchars($pageDescription, ENT_QUOTES, 'UTF-8') ?>">
    <title><?= htmlspecialchars($pageTitle, ENT_QUOTES, 'UTF-8') ?></title>
    <link rel="icon" href="/moodboards/favicon.ico" sizes="32x32" type="image/x-icon">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&amp;family=Roboto+Condensed:wght@500;600;700&amp;family=Roboto:wght@400;500;700&amp;display=optional" rel="stylesheet">
    <link rel="stylesheet" href="<?= htmlspecialchars($versionedAssetUrl('/moodboards/assets/css/base.css'), ENT_QUOTES, 'UTF-8') ?>">
    <?php foreach ($pageStyles as $stylesheet): ?>
        <link rel="stylesheet" href="<?= htmlspecialchars($versionedAssetUrl($stylesheet), ENT_QUOTES, 'UTF-8') ?>">
    <?php endforeach; ?>
    <script>
        window.MoodboardsConfig = Object.freeze(<?= json_encode(
            $config,
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR
        ) ?>);
    </script>
    <?php if ($moduleImports !== []): ?>
    <script type="importmap"><?= json_encode(
        ['imports' => $moduleImports],
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP
    ) ?></script>
    <?php endif; ?>
</head>
<body class="<?= htmlspecialchars($bodyClass, ENT_QUOTES, 'UTF-8') ?>">
    <noscript>
        <div class="noscript-message" role="alert">
            Для работы с мудбордами необходимо включить JavaScript.
        </div>
    </noscript>

    <aside class="viewport-warning" role="status" aria-live="polite">
        <div class="viewport-warning__card">
            <span class="viewport-warning__icon" aria-hidden="true">↔</span>
            <h1>Нужен экран побольше</h1>
            <p>Демо-редактор рассчитан на окно шириной не менее 500 пикселей. Увеличьте окно браузера, чтобы продолжить работу.</p>
        </div>
    </aside>

    <?php if (($showDemoTariffSwitcher ?? true) && $demoModeEnabled): ?>
    <aside class="demo-tariff-switcher" data-role="demo-tariff-switcher" aria-label="Настройки демонстрации">
        <label class="demo-tariff-switcher__field">
            <span>Демо-тариф</span>
            <select data-role="demo-tariff-select" aria-label="Выбрать демонстрационный тариф">
                <option value="pro" selected>PRO</option>
                <option value="premium">Premium</option>
                <option value="basic">Basic</option>
                <option value="free">Free</option>
                <option value="guest">Гостевой режим</option>
            </select>
        </label>
        <label class="demo-tariff-switcher__field">
            <span>Пресет</span>
            <span class="demo-tariff-switcher__preset-control">
                <select data-role="demo-preset-select" aria-label="Выбрать пресет удаления фона"
                    aria-describedby="demo-preset-description">
                    <?php foreach ($demoPresets as $presetId => $preset): ?>
                    <option value="<?= htmlspecialchars($presetId, ENT_QUOTES, 'UTF-8') ?>"
                        <?= $selectedDemoPreset === $presetId ? 'selected' : '' ?>><?= htmlspecialchars((string) $preset['name'], ENT_QUOTES, 'UTF-8') ?></option>
                    <?php endforeach; ?>
                </select>
                <small id="demo-preset-description" data-role="demo-preset-description"><?= htmlspecialchars((string) $demoPresets[$selectedDemoPreset]['description'], ENT_QUOTES, 'UTF-8') ?></small>
            </span>
        </label>
        <?php if ($showProjectJsonTools ?? false): ?>
        <div class="demo-tariff-switcher__project-tools" aria-label="Перенос JSON-проекта">
            <button data-project-json-action="export" type="button" aria-label="Экспортировать проект в JSON" title="Экспорт проекта в JSON" disabled>
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 15v5h14v-5"></path></svg>
                <span>Экспорт</span>
            </button>
            <button data-project-json-action="choose-import" type="button" aria-label="Импортировать проект из JSON" title="Импорт проекта из JSON" disabled>
                <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M12 15V3m0 0 4 4m-4-4L8 7M5 15v5h14v-5"></path></svg>
                <span>Импорт</span>
            </button>
            <input data-role="project-json-input" class="visually-hidden" type="file" accept="application/json,.json" tabindex="-1">
        </div>
        <div class="demo-tariff-switcher__confirm" data-role="project-json-confirm" role="alertdialog" aria-labelledby="project-json-confirm-title" aria-describedby="project-json-confirm-description" hidden>
            <strong id="project-json-confirm-title">Импортировать проект?</strong>
            <p id="project-json-confirm-description" data-role="project-json-summary">Текущее содержимое будет заменено.</p>
            <div>
                <button data-project-json-action="cancel-import" type="button">Отмена</button>
                <button class="demo-tariff-switcher__confirm-primary" data-project-json-action="confirm-import" type="button">Импортировать</button>
            </div>
        </div>
        <?php endif; ?>
    </aside>
    <?php endif; ?>
