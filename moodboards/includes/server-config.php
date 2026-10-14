<?php

declare(strict_types=1);

$backgroundRemovalEndpoint = getenv('MOODBOARDS_BACKGROUND_REMOVAL_URL');
$backgroundRemovalApiKey = getenv('MOODBOARDS_BACKGROUND_REMOVAL_API_KEY');
$backgroundRemovalPresetId = getenv('MOODBOARDS_BACKGROUND_REMOVAL_PRESET_ID');

return [
    'backgroundRemoval' => [
        'endpoint' => $backgroundRemovalEndpoint !== false && $backgroundRemovalEndpoint !== ''
            ? $backgroundRemovalEndpoint
            : 'https://arbg1.api.ams-soft.com/php_lib/curl_moodboards.php',
        'apiKey' => $backgroundRemovalApiKey !== false ? $backgroundRemovalApiKey : '',
        'presetId' => $backgroundRemovalPresetId !== false && $backgroundRemovalPresetId !== ''
            ? $backgroundRemovalPresetId
            : 'preset_0',
        'connectTimeoutSeconds' => 15,
        'timeoutSeconds' => 120,
        'maxFileSize' => 30 * 1024 * 1024,
        'maxResponseSize' => 40 * 1024 * 1024,
    ],
];
