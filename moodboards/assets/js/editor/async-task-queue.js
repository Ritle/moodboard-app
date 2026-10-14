export class AsyncTaskQueue {
    constructor(concurrency = 4) {
        this.concurrency = Math.max(1, Math.floor(Number(concurrency) || 1));
        this.activeCount = 0;
        this.pending = [];
        this.destroyed = false;
    }

    enqueue(task) {
        if (typeof task !== 'function') {
            return Promise.reject(new TypeError('Задача очереди должна быть функцией.'));
        }
        if (this.destroyed) {
            return Promise.reject(this._abortError());
        }
        return new Promise((resolve, reject) => {
            this.pending.push({ task, resolve, reject });
            this._drain();
        });
    }

    destroy() {
        if (this.destroyed) {
            return;
        }
        this.destroyed = true;
        const error = this._abortError();
        for (const entry of this.pending.splice(0)) {
            entry.reject(error);
        }
    }

    _drain() {
        while (!this.destroyed && this.activeCount < this.concurrency && this.pending.length > 0) {
            const entry = this.pending.shift();
            this.activeCount += 1;
            Promise.resolve()
                .then(entry.task)
                .then(entry.resolve, entry.reject)
                .finally(() => {
                    this.activeCount -= 1;
                    this._drain();
                });
        }
    }

    _abortError() {
        const error = new Error('Очередь загрузки изображений остановлена.');
        error.name = 'AbortError';
        return error;
    }
}
