<?php

declare(strict_types=1);

$pageModule = $pageModule ?? null;
$versionedPageModule = $pageModule !== null && isset($versionedAssetUrl) && is_callable($versionedAssetUrl)
    ? $versionedAssetUrl($pageModule)
    : $pageModule;
?>
    <script src="/moodboards/assets/vendor/jquery-4.0.0.min.js"></script>
    <script src="/moodboards/assets/vendor/konva-10.3.0.min.js"></script>
    <?php if ($versionedPageModule !== null): ?>
        <script type="module" src="<?= htmlspecialchars($versionedPageModule, ENT_QUOTES, 'UTF-8') ?>"></script>
    <?php endif; ?>
</body>
</html>
