<?php

declare(strict_types=1);

function respondWithError(int $status, string $code, string $message): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    echo json_encode([
        'status' => 'error',
        'error' => [
            'code' => $code,
            'message' => $message,
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    respondWithError(405, 'METHOD_NOT_ALLOWED', 'Используйте POST-запрос с изображением.');
}

$serverConfig = require __DIR__ . '/../includes/server-config.php';
$config = $serverConfig['backgroundRemoval'] ?? [];
$presetDefinitions = require __DIR__ . '/../includes/background-removal-presets.php';
$allowedPresetIds = array_keys($presetDefinitions);
$configuredPresetId = (string) ($config['presetId'] ?? 'preset_0');
$defaultPresetId = in_array($configuredPresetId, $allowedPresetIds, true)
    ? $configuredPresetId
    : 'preset_0';
$requestedPresetId = trim((string) ($_POST['preset_id'] ?? ''));
$presetId = in_array($requestedPresetId, $allowedPresetIds, true)
    ? $requestedPresetId
    : $defaultPresetId;
$upload = $_FILES['file'] ?? null;

if (!is_array($upload) || !isset($upload['error'], $upload['tmp_name'], $upload['size'])) {
    respondWithError(400, 'FILE_REQUIRED', 'Выберите изображение для удаления фона.');
}
if ((int) $upload['error'] !== UPLOAD_ERR_OK) {
    respondWithError(400, 'UPLOAD_FAILED', 'Не удалось получить загруженное изображение.');
}

$fileSize = (int) $upload['size'];
$maxFileSize = max(1, (int) ($config['maxFileSize'] ?? 30 * 1024 * 1024));
if ($fileSize <= 0 || $fileSize > $maxFileSize) {
    respondWithError(413, 'FILE_TOO_LARGE', 'Размер изображения превышает допустимый лимит.');
}

$temporaryPath = (string) $upload['tmp_name'];
if (!is_uploaded_file($temporaryPath)) {
    respondWithError(400, 'INVALID_UPLOAD', 'Загруженный файл не прошёл проверку безопасности.');
}

$finfo = new finfo(FILEINFO_MIME_TYPE);
$mimeType = (string) $finfo->file($temporaryPath);
$extensions = [
    'image/jpeg' => 'jpg',
    'image/png' => 'png',
    'image/webp' => 'webp',
];
if (!isset($extensions[$mimeType])) {
    respondWithError(415, 'UNSUPPORTED_IMAGE', 'Поддерживаются только PNG, JPG и WebP.');
}
if (!extension_loaded('curl')) {
    respondWithError(500, 'CURL_UNAVAILABLE', 'На сервере недоступно расширение cURL.');
}

$endpoint = trim((string) ($config['endpoint'] ?? ''));
if ($endpoint === '' || filter_var($endpoint, FILTER_VALIDATE_URL) === false) {
    respondWithError(500, 'SERVICE_NOT_CONFIGURED', 'Сервис удаления фона не настроен.');
}

$postFields = [
    'file' => new CURLFile(
        $temporaryPath,
        $mimeType,
        'moodboard-image.' . $extensions[$mimeType]
    ),
    // Эти служебные поля нужны текущей реализации внешнего сервиса.
    'API_KEY' => (string) ($config['apiKey'] ?? ''),
    'preset_id' => $presetId,
    'user_id' => '0',
    'sourse_type' => 'moodboards',
];

$handle = curl_init($endpoint);
if ($handle === false) {
    respondWithError(502, 'SERVICE_INITIALIZATION_FAILED', 'Не удалось подготовить запрос к сервису удаления фона.');
}

curl_setopt_array($handle, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $postFields,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CONNECTTIMEOUT => max(1, (int) ($config['connectTimeoutSeconds'] ?? 15)),
    CURLOPT_TIMEOUT => max(1, (int) ($config['timeoutSeconds'] ?? 120)),
    CURLOPT_HTTPHEADER => ['Accept: image/png, image/webp, image/jpeg'],
]);

$responseBody = curl_exec($handle);
$curlError = curl_error($handle);
$statusCode = (int) curl_getinfo($handle, CURLINFO_HTTP_CODE);
curl_close($handle);

if ($responseBody === false) {
    error_log('MoodBoards background removal request failed: ' . $curlError);
    respondWithError(502, 'BACKGROUND_SERVICE_UNAVAILABLE', 'Сервис удаления фона временно недоступен.');
}
if ($statusCode < 200 || $statusCode >= 300) {
    error_log(sprintf('MoodBoards background removal returned HTTP %d.', $statusCode));
    respondWithError(502, 'BACKGROUND_SERVICE_ERROR', 'Сервис удаления фона не смог обработать изображение.');
}

$maxResponseSize = max(1, (int) ($config['maxResponseSize'] ?? 40 * 1024 * 1024));
if ($responseBody === '' || strlen($responseBody) > $maxResponseSize) {
    respondWithError(502, 'INVALID_SERVICE_RESPONSE', 'Сервис удаления фона вернул некорректный результат.');
}

$resultMimeType = (string) $finfo->buffer($responseBody);
if (strpos($resultMimeType, 'image/') !== 0) {
    error_log('MoodBoards background removal returned non-image content: ' . $resultMimeType);
    respondWithError(502, 'INVALID_SERVICE_RESPONSE', 'Сервис удаления фона вернул ответ вместо изображения.');
}

header('Content-Type: ' . $resultMimeType);
header('Content-Length: ' . strlen($responseBody));
header('Content-Disposition: inline; filename="moodboard-no-background.png"');
header('Cache-Control: no-store, max-age=0');
header('X-Content-Type-Options: nosniff');
echo $responseBody;
