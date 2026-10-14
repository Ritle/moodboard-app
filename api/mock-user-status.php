<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');

const SUPPORTED_TARIFFS = ['guest', 'free', 'basic', 'premium', 'pro'];
const MOODBOARDS_TARIFFS = ['basic', 'premium', 'pro'];
const DEFAULT_TARIFF = 'pro';

$requestedTariff = strtolower(trim((string) ($_GET['mock_tariff'] ?? DEFAULT_TARIFF)));

if (!in_array($requestedTariff, SUPPORTED_TARIFFS, true)) {
    http_response_code(400);
    echo json_encode([
        'status' => 'error',
        'error' => [
            'code' => 'UNSUPPORTED_MOCK_TARIFF',
            'message' => 'Неизвестный тестовый тариф.',
            'supported_tariffs' => SUPPORTED_TARIFFS,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}

$isAuthorized = $requestedTariff !== 'guest';
$moodboardsAllowed = in_array($requestedTariff, MOODBOARDS_TARIFFS, true);

echo json_encode([
    'status' => 'success',
    'data' => [
        'is_authorized' => $isAuthorized,
        'user_id' => $isAuthorized ? 10482 : null,
        'tariff_plan' => $requestedTariff,
        'features' => [
            'moodboards_allowed' => $moodboardsAllowed,
            'max_moodboards' => $moodboardsAllowed ? 50 : 0,
        ],
    ],
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
