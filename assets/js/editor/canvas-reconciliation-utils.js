function fingerprintElement(element) {
    return JSON.stringify(element);
}
export function planElementReconciliation(previousFingerprints, elements) {
    const previous = previousFingerprints instanceof Map ? previousFingerprints : new Map();
    const source = Array.isArray(elements) ? elements : [];
    const nextFingerprints = new Map();
    const added = [];
    const changed = [];
    const retained = [];

    source.forEach((element, index) => {
        const id = String(element?.id || '');
        if (!id) {
            return;
        }
        const fingerprint = fingerprintElement(element);
        nextFingerprints.set(id, fingerprint);
        const entry = Object.freeze({ id, element, index });
        if (!previous.has(id)) {
            added.push(entry);
        } else if (previous.get(id) !== fingerprint) {
            changed.push(entry);
        } else {
            retained.push(entry);
        }
    });

    const removedIds = [...previous.keys()].filter((id) => !nextFingerprints.has(id));
    return Object.freeze({
        added: Object.freeze(added),
        changed: Object.freeze(changed),
        retained: Object.freeze(retained),
        removedIds: Object.freeze(removedIds),
        nextFingerprints,
    });
}
