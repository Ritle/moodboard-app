export function renderMoodboardsAccountControl(policy, {
    loginUrl,
    accountUrl = loginUrl,
    root = document,
} = {}) {
    const isAuthorized = policy.isAuthorized;
    const label = isAuthorized ? 'Аккаунт' : 'Войти';
    const href = isAuthorized ? accountUrl : loginUrl;
    const ariaLabel = isAuthorized
        ? `Открыть аккаунт RoomPlan${policy.userId === null ? '' : `, пользователь ${policy.userId}`}`
        : 'Войти в RoomPlan';

    for (const link of root.querySelectorAll('[data-role="moodboards-account-link"]')) {
        link.href = href;
        link.dataset.authState = isAuthorized ? 'authorized' : 'guest';
        link.setAttribute('aria-label', ariaLabel);
        link.title = isAuthorized
            ? `Аккаунт RoomPlan · тариф ${policy.tariffPlan.toUpperCase()}`
            : 'Войти в RoomPlan';
        if (policy.userId === null) {
            delete link.dataset.userId;
        } else {
            link.dataset.userId = String(policy.userId);
        }
        const labelElement = link.querySelector('[data-role="account-label"]');
        if (labelElement !== null) {
            labelElement.textContent = label;
        }
    }
}
