const REQUIRED_GLOBALS = Object.freeze(['jQuery', 'Konva', 'MoodboardsConfig']);

export function bootstrapPage(pageName) {
    const missingGlobals = REQUIRED_GLOBALS.filter((name) => typeof window[name] === 'undefined');

    if (missingGlobals.length > 0) {
        showBootstrapError(`Не удалось загрузить: ${missingGlobals.join(', ')}`);
        return null;
    }

    document.documentElement.classList.add('js-ready');

    return Object.freeze({
        pageName,
        config: window.MoodboardsConfig,
        $: window.jQuery,
        Konva: window.Konva,
    });
}

function showBootstrapError(message) {
    const alert = document.createElement('div');
    alert.className = 'bootstrap-error';
    alert.setAttribute('role', 'alert');
    alert.textContent = message;
    document.body.prepend(alert);
}
