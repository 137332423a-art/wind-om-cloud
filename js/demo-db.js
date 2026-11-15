/* ============================================================
 * 练习模式数据层：浏览器 IndexedDB，不连接正式云端数据
 * ============================================================ */

window.DEMO_MODE = new URLSearchParams(window.location.search).has('demo');

const DEMO_DB_NAME = 'wind-om-demo-db';
const DEMO_DB_VER = 1;

const DemoDB = {
  _db: null,

  async open() {
    if (!this._db) {
      await new Promise((resolve, reject) => {
        const request = indexedDB.open(DEMO_DB_NAME, DEMO_DB_VER);
        request.onupgradeneeded = event => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains('units')) {
            db.createObjectStore('units', { keyPath: 'id' });
          }
          if (!db.objectStoreNames.contains('defects')) {
            const store = db.createObjectStore('defects', { keyPath: 'id' });
            store.createIndex('unitId', 'unitId', { unique: false });
          }
          if (!db.objectStoreNames.contains('photos')) {
            db.createObjectStore('photos', { keyPath: 'id' });
          }
        };
        request.onsuccess = event => {
          this._db = event.target.result;
          resolve();
        };
        request.onerror = event => reject(event.target.error);
      });
    }
    if ((await this.getAll('units')).length === 0) await this.reset();
  },

  _tx(store, mode, fn) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(store, mode);
      const request = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(request?._result !== undefined ? request._result : request);
      tx.onerror = event => reject(event.target.error);
    });
  },

  getAll(store) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(store, 'readonly');
      const request = tx.objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = event => reject(event.target.error);
    });
  },

  get(store, id) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction(store, 'readonly');
      const request = tx.objectStore(store).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = event => reject(event.target.error);
    });
  },

  put(store, object) {
    return this._tx(store, 'readwrite', os => os.put(object));
  },

  putMany(store, objects) {
    return Promise.all(objects.map(object => this.put(store, object)));
  },

  del(store, id) {
    return this._tx(store, 'readwrite', os => os.delete(id));
  },

  getByUnit(unitId) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('defects', 'readonly');
      const request = tx.objectStore('defects').index('unitId').getAll(unitId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = event => reject(event.target.error);
    });
  },

  async clearAll() {
    for (const store of ['units', 'defects', 'photos']) {
      await this._tx(store, 'readwrite', os => os.clear());
    }
  },

  async reset() {
    await this.clearAll();
    const units = [];
    for (let number = 1; number <= 10; number++) {
      units.push({
        id: uid(),
        type: 'turbine',
        brand: '',
        name: `#${number}风机`,
        farm: '演示风场',
        model: '模拟 1.5MW 风机',
        createdAt: new Date().toISOString()
      });
      units.push({
        id: uid(),
        type: 'transformer',
        brand: number <= 5 ? 'taikai' : 'dongmeng',
        name: `#${number}箱变`,
        farm: '演示风场',
        model: '模拟箱式变压器',
        createdAt: new Date().toISOString()
      });
    }
    await this.putMany('units', units);
  },

  async exportJSON() {
    const [units, defects, photos] = await Promise.all([
      this.getAll('units'), this.getAll('defects'), this.getAll('photos')
    ]);
    const photosData = [];
    for (const photo of photos) {
      photosData.push({
        id: photo.id,
        defectId: photo.defectId,
        name: photo.name,
        data: await this._blobToB64(photo.blob)
      });
    }
    return {
      version: DEMO_DB_VER,
      exportedAt: new Date().toISOString(),
      units,
      defects,
      photos: photosData
    };
  },

  async importJSON(data) {
    if (!data || !Array.isArray(data.units)) throw new Error('备份文件格式不正确');
    await this.clearAll();
    for (const unit of data.units) await this.put('units', unit);
    for (const defect of (data.defects || [])) await this.put('defects', defect);
    for (const photo of (data.photos || [])) {
      await this.put('photos', {
        id: photo.id,
        defectId: photo.defectId,
        name: photo.name,
        blob: this._b64ToBlob(photo.data)
      });
    }
  },

  _blobToB64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  },

  _b64ToBlob(dataUrl) {
    const [head, body] = String(dataUrl || '').split(',');
    const mime = (head.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mime });
  }
};
