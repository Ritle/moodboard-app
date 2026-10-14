import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const contractUrl = new URL('../docs/openapi/moodboards-api.openapi.json', import.meta.url);
const contract = JSON.parse(await readFile(contractUrl, 'utf8'));
const contractDocument = await readFile(
    new URL('../docs/ROOMPLAN-INTEGRATION-CONTRACT.md', import.meta.url),
    'utf8',
);

assert.equal(contract.openapi, '3.1.0');
assert.equal(contract.info.version, '1.0.0');
assert.deepEqual(contract.security, [{ cookieAuth: [] }]);
assert.deepEqual(contract.paths['/user/moodboards-access'].get.security, []);

const requiredPaths = [
    '/user/moodboards-access',
    '/user/moodboard-settings',
    '/moodboards',
    '/moodboards/{moodboardId}',
    '/moodboards/{moodboardId}/archive',
    '/moodboards/{moodboardId}/content',
    '/moodboards/{moodboardId}/duplicate',
    '/moodboards/{moodboardId}/assets',
    '/assets/{assetId}',
    '/moodboards/{moodboardId}/preview',
    '/moodboards/{moodboardId}/shares',
    '/moodboards/{moodboardId}/shares/{shareId}',
    '/public/moodboards/{shareToken}',
    '/public/moodboards/{shareToken}/assets/{assetId}',
];
requiredPaths.forEach((path) => assert.ok(contract.paths[path], `Missing OpenAPI path: ${path}`));

const resolvePointer = (root, reference) => {
    assert.match(reference, /^#\//, `Only local OpenAPI references are allowed: ${reference}`);
    return reference.slice(2).split('/').reduce((value, rawPart) => {
        const part = rawPart.replaceAll('~1', '/').replaceAll('~0', '~');
        assert.ok(value && Object.hasOwn(value, part), `Broken OpenAPI reference: ${reference}`);
        return value[part];
    }, root);
};

const visit = (value) => {
    if (Array.isArray(value)) {
        value.forEach(visit);
        return;
    }
    if (!value || typeof value !== 'object') {
        return;
    }
    if (typeof value.$ref === 'string') {
        resolvePointer(contract, value.$ref);
    }
    Object.values(value).forEach(visit);
};
visit(contract);

const parameterName = (parameter) => (
    parameter.$ref ? resolvePointer(contract, parameter.$ref).name : parameter.name
);
const operationParameters = (path, method) => [
    ...(contract.paths[path].parameters || []),
    ...(contract.paths[path][method].parameters || []),
].map(parameterName);

const httpMethods = new Set(['get', 'post', 'put', 'patch', 'delete']);
const operationIds = new Set();
for (const [path, pathItem] of Object.entries(contract.paths)) {
    const declaredParameters = [
        ...(pathItem.parameters || []),
    ].map(parameterName);
    for (const placeholder of path.matchAll(/\{([^}]+)\}/g)) {
        const parameter = placeholder[1];
        const operationProvidesParameter = Object.entries(pathItem)
            .filter(([method]) => httpMethods.has(method))
            .some(([, operation]) => [
                ...declaredParameters,
                ...(operation.parameters || []).map(parameterName),
            ].includes(parameter));
        assert.ok(operationProvidesParameter, `Path parameter {${parameter}} is not declared for ${path}`);
    }
    for (const [method, operation] of Object.entries(pathItem)) {
        if (!httpMethods.has(method)) {
            continue;
        }
        assert.ok(operation.operationId, `${method.toUpperCase()} ${path} lacks operationId`);
        assert.equal(operationIds.has(operation.operationId), false, `Duplicate operationId: ${operation.operationId}`);
        operationIds.add(operation.operationId);
        assert.ok(
            Object.keys(operation.responses || {}).some((status) => /^2\d\d$/.test(status)),
            `${method.toUpperCase()} ${path} lacks a success response`,
        );
    }
}

const csrfOperations = [
    ['/user/moodboard-settings', 'put'],
    ['/moodboards', 'post'],
    ['/moodboards/{moodboardId}', 'patch'],
    ['/moodboards/{moodboardId}', 'delete'],
    ['/moodboards/{moodboardId}/archive', 'put'],
    ['/moodboards/{moodboardId}/content', 'put'],
    ['/moodboards/{moodboardId}/duplicate', 'post'],
    ['/moodboards/{moodboardId}/assets', 'post'],
    ['/assets/{assetId}', 'delete'],
    ['/moodboards/{moodboardId}/preview', 'put'],
    ['/moodboards/{moodboardId}/preview', 'delete'],
    ['/moodboards/{moodboardId}/shares', 'post'],
    ['/moodboards/{moodboardId}/shares/{shareId}', 'delete'],
];
csrfOperations.forEach(([path, method]) => {
    assert.ok(operationParameters(path, method).includes('X-CSRF-Token'), `${method.toUpperCase()} ${path} lacks CSRF`);
});
for (const [path, pathItem] of Object.entries(contract.paths)) {
    for (const method of ['post', 'put', 'patch', 'delete']) {
        if (pathItem[method] && !path.startsWith('/public/')) {
            assert.ok(
                operationParameters(path, method).includes('X-CSRF-Token'),
                `${method.toUpperCase()} ${path} lacks CSRF`,
            );
        }
    }
}

const idempotentCreateOperations = [
    ['/moodboards', 'post'],
    ['/moodboards/{moodboardId}/duplicate', 'post'],
    ['/moodboards/{moodboardId}/assets', 'post'],
    ['/moodboards/{moodboardId}/shares', 'post'],
];
idempotentCreateOperations.forEach(([path, method]) => {
    assert.ok(operationParameters(path, method).includes('Idempotency-Key'), `${method.toUpperCase()} ${path} lacks idempotency`);
});

assert.deepEqual(contract.paths['/public/moodboards/{shareToken}'].get.security, []);
assert.deepEqual(contract.paths['/public/moodboards/{shareToken}/assets/{assetId}'].get.security, []);
assert.equal(contract.components.schemas.MoodboardDocument.properties.schemaVersion.const, 2);
assert.equal(contract.components.schemas.MoodboardDocument.properties.pages.maxItems, 40);
assert.equal(contract.components.schemas.MoodboardSettings.properties.imageEraserSize.default, 64);
assert.ok(contract.components.schemas.ErrorEnvelope.properties.error.required.includes('requestId'));
assert.match(contractDocument, /409 REVISION_CONFLICT/);
assert.match(contractDocument, /не менее 256 бит энтропии/);
assert.match(contractDocument, /нельзя логировать document JSON/i);

console.log('RoomPlan integration contract: PASS');
