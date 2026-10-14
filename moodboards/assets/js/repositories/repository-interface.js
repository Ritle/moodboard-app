/**
 * Асинхронный контракт хранилища MoodBoards.
 *
 * Редактор зависит только от этого контракта: IndexedDB и будущий HTTP-адаптер
 * должны возвращать одинаковые структуры данных и типы ошибок.
 */
export class MoodboardRepository {
    async list() { throw new Error('Метод list() не реализован.'); }
    async create(data) { void data; throw new Error('Метод create() не реализован.'); }
    async get(id) { void id; throw new Error('Метод get() не реализован.'); }
    async updateMeta(id, data) { void id; void data; throw new Error('Метод updateMeta() не реализован.'); }
    async setArchived(id, archived) { void id; void archived; throw new Error('Метод setArchived() не реализован.'); }
    async saveContent(id, document, revision) { void id; void document; void revision; throw new Error('Метод saveContent() не реализован.'); }
    async delete(id) { void id; throw new Error('Метод delete() не реализован.'); }
    async duplicate(id) { void id; throw new Error('Метод duplicate() не реализован.'); }
    async addAsset(moodboardId, file) { void moodboardId; void file; throw new Error('Метод addAsset() не реализован.'); }
    async getAsset(assetId) { void assetId; throw new Error('Метод getAsset() не реализован.'); }
    async deleteAsset(assetId) { void assetId; throw new Error('Метод deleteAsset() не реализован.'); }
    async savePreview(moodboardId, blobOrNull) { void moodboardId; void blobOrNull; throw new Error('Метод savePreview() не реализован.'); }
}
