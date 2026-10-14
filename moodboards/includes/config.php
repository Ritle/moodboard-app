<?php

declare(strict_types=1);

return [
    'baseUrl' => '/moodboards/',
    'routes' => [
        'moodboards' => '/moodboards/index.php',
        'editor' => '/moodboards/editor.php',
        'viewer' => '/moodboards/view.php',
    ],
    'access' => [
        'endpoint' => '/moodboards/api/mock-user-status.php',
        'defaultTariff' => 'pro',
        'billingUrl' => 'https://roomplan.ru/order.php',
        'loginUrl' => 'https://roomplan.ru/app/',
        'accountUrl' => 'https://roomplan.ru/app/',
    ],
    'minimumViewportWidth' => 500,
    'storage' => [
        'driver' => 'indexeddb',
        'databaseName' => 'moodboards-demo',
        'version' => 1,
    ],
    'api' => [
        'baseUrl' => '/api',
        'timeoutMs' => 15000,
        'retryCount' => 1,
        'csrfToken' => null,
        'requireCsrf' => true,
    ],
    'publicViewer' => [
        'driver' => 'local-indexeddb',
        'tokenParameter' => 'token',
        'legacyIdParameter' => 'id',
        'allowLegacyId' => true,
    ],
    'services' => [
        'backgroundRemoval' => [
            'endpoint' => '/moodboards/api/remove-background.php',
            'timeoutMs' => 130000,
        ],
    ],
    'editor' => [
        'maxPages' => 40,
        'historyLimit' => 100,
        'autosave' => [
            'debounceMs' => 1200,
            'retryDelaysMs' => [1000, 2500, 5000, 10000],
        ],
        'images' => [
            'maxSide' => 2800,
            'maxFileSize' => 30 * 1024 * 1024,
            'lossyQuality' => 0.88,
        ],
        'preview' => [
            'pixelRatio' => 0.3,
            'aspectRatio' => 1.6,
            'maxWidth' => 480,
            'maxHeight' => 300,
        ],
    ],
];
