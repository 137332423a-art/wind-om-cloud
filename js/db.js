/* ============================================================
 * 云端数据层：Supabase PostgreSQL + Storage
 * 网页不保存业务数据，机组 / 缺陷 / 照片全部写入云端。
 * 对外接口尽量保持原 App 所需的方法签名。
 * ============================================================ */

const DB_VER = 2;

const DB = {
  async open() {
    if (!Auth.configured()) {
      throw this._error('请先配置 Supabase 项目地址和公开密钥', 'CONFIG_REQUIRED');
    }
    await Auth.ensureSession();
  },

  async getAll(store) {
    if (store === 'photos') {
      const rows = await this._select('photos', 'select=*');
      const photos = [];
      for (const row of rows) {
        const blob = await this._downloadPhoto(row.storage_path);
        photos.push(this._photoFromRow(row, blob));
      }
      return photos;
    }
    const rows = await this._select(store, 'select=*');
    return rows.map(row => store === 'units' ? this._unitFromRow(row) : this._defectFromRow(row));
  },

  async get(store, id) {
    if (store !== 'photos') {
      const rows = await this._select(store, `select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
      if (!rows.length) return null;
      return store === 'units' ? this._unitFromRow(rows[0]) : this._defectFromRow(rows[0]);
    }
    const rows = await this._select('photos', `select=*&id=eq.${encodeURIComponent(id)}&limit=1`);
    if (!rows.length) return null;
    const blob = await this._downloadPhoto(rows[0].storage_path);
    return this._photoFromRow(rows[0], blob);
  },

  async put(store, obj) {
    if (store === 'photos') return this._putPhoto(obj);
    const row = store === 'units' ? this._unitToRow(obj) : this._defectToRow(obj);
    await this._request(`/rest/v1/${store}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(row)
    });
    return obj;
  },

  async putMany(store, objects) {
    if (!Array.isArray(objects) || objects.length === 0) return [];
    if (store === 'photos') {
      for (const photo of objects) await this._putPhoto(photo);
      return objects;
    }
    const rows = objects.map(obj => store === 'units' ? this._unitToRow(obj) : this._defectToRow(obj));
    await this._request(`/rest/v1/${store}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify(rows)
    });
    return objects;
  },

  async del(store, id) {
    if (store === 'photos') {
      const row = await this.get('photos', id);
      if (row?.storagePath) {
        await this._request(`/storage/v1/object/${this._bucket()}/${row.storagePath}`, {
          method: 'DELETE'
        }, true);
      }
    }
    await this._request(`/rest/v1/${store}?id=eq.${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Prefer': 'return=minimal' }
    });
  },

  async getByUnit(unitId) {
    const rows = await this._select('defects', `select=*&unit_id=eq.${encodeURIComponent(unitId)}`);
    return rows.map(row => this._defectFromRow(row));
  },

  async clearAll() {
    const photos = await this._select('photos', 'select=*');
    for (const row of photos) {
      await this._request(`/storage/v1/object/${this._bucket()}/${row.storage_path}`, {
        method: 'DELETE'
      }, true);
    }
    await this._deleteAll('photos');
    await this._deleteAll('defects');
    await this._deleteAll('units');
  },

  async exportJSON() {
    const [units, defects, photos] = await Promise.all([
      this.getAll('units'), this.getAll('defects'), this.getAll('photos')
    ]);
    const photosB64 = [];
    for (const photo of photos) {
      photosB64.push({
        id: photo.id,
        defectId: photo.defectId,
        name: photo.name,
        data: await this._blobToB64(photo.blob)
      });
    }
    return {
      version: DB_VER,
      exportedAt: new Date().toISOString(),
      units,
      defects,
      photos: photosB64
    };
  },

  async importJSON(data) {
    if (!data || !Array.isArray(data.units)) throw new Error('备份文件格式不正确');
    await this.clearAll();

    const unitIds = new Map();
    for (const unit of data.units) {
      const id = this._uuid(unit.id);
      unitIds.set(unit.id, id);
      await this.put('units', { ...unit, id });
    }

    const defectIds = new Map();
    const photoIds = new Map();
    for (const photo of (data.photos || [])) photoIds.set(photo.id, this._uuid(photo.id));

    for (const defect of (data.defects || [])) {
      const id = this._uuid(defect.id);
      defectIds.set(defect.id, id);
      await this.put('defects', {
        ...defect,
        id,
        unitId: unitIds.get(defect.unitId) || this._uuid(defect.unitId),
        photos: (defect.photos || []).map(photoId => photoIds.get(photoId) || this._uuid(photoId))
      });
    }
    for (const photo of (data.photos || [])) {
      await this.put('photos', {
        id: photoIds.get(photo.id),
        defectId: defectIds.get(photo.defectId) || this._uuid(photo.defectId),
        name: photo.name,
        blob: this._b64ToBlob(photo.data)
      });
    }
  },

  async _putPhoto(photo) {
    if (!(photo.blob instanceof Blob)) throw this._error('照片数据无效', 'INVALID_PHOTO');
    const id = this._uuid(photo.id);
    const extension = this._extension(photo.blob.type);
    const storagePath = `${photo.defectId}/${id}${extension}`;
    const cfg = Auth.config();
    const session = await Auth.ensureSession();
    const upload = await fetch(
      `${cfg.url}/storage/v1/object/${this._bucket()}/${storagePath}`,
      {
        method: 'POST',
        headers: {
          'apikey': cfg.anonKey,
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': photo.blob.type || 'application/octet-stream',
          'x-upsert': 'true'
        },
        body: photo.blob
      }
    );
    if (!upload.ok) throw await this._requestError(upload, '照片上传失败：');
    await this._request('/rest/v1/photos', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=minimal'
      },
      body: JSON.stringify({
        id,
        defect_id: photo.defectId,
        name: photo.name || '',
        storage_path: storagePath,
        mime: photo.blob.type || 'image/jpeg',
        size: photo.blob.size || 0
      })
    });
    return { id, defectId: photo.defectId, name: photo.name || '', blob: photo.blob };
  },

  async _downloadPhoto(storagePath) {
    if (!storagePath) return null;
    const response = await this._request(
      `/storage/v1/object/${this._bucket()}/${storagePath}`
    );
    return response.blob();
  },

  async _select(table, query) {
    const response = await this._request(`/rest/v1/${table}?${query}`);
    return response.json();
  },

  async _deleteAll(table) {
    await this._request(`/rest/v1/${table}?id=not.is.null`, {
      method: 'DELETE',
      headers: { 'Prefer': 'return=minimal' }
    });
  },

  async _request(path, options = {}, allowNotFound = false) {
    const response = await Auth.api(path, options);
    if (allowNotFound && response.status === 404) return response;
    if (!response.ok) throw await this._requestError(response);
    return response;
  },

  async _requestError(response, prefix = '') {
    let detail = '';
    try {
      const body = await response.json();
      detail = body.message || body.error_description || body.error || '';
    } catch {
      try { detail = await response.text(); } catch { detail = ''; }
    }
    return this._error(`${prefix}${detail || `云端请求失败 (${response.status})`}`, 'CLOUD_REQUEST_FAILED');
  },

  _bucket() {
    return encodeURIComponent(Auth.config().photoBucket);
  },

  _extension(type) {
    return ({ 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' })[type] || '.jpg';
  },

  _uuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''))
      ? value
      : crypto.randomUUID();
  },

  _unitFromRow(row) {
    return {
      id: row.id,
      type: row.type,
      brand: row.brand || '',
      name: row.name,
      farm: row.farm || '默认风场',
      model: row.model || '',
      createdAt: row.created_at
    };
  },

  _unitToRow(unit) {
    return {
      id: this._uuid(unit.id),
      type: unit.type,
      brand: unit.brand || '',
      name: unit.name,
      farm: unit.farm || '默认风场',
      model: unit.model || '',
      created_at: unit.createdAt || new Date().toISOString()
    };
  },

  _defectFromRow(row) {
    return {
      id: row.id,
      unitId: row.unit_id,
      brand: row.brand || '',
      part: row.part,
      category: row.category,
      level: row.level,
      desc: row.description || '',
      foundDate: row.found_date || '',
      reporter: row.reporter || '',
      remindDays: row.remind_days || 0,
      nextRemind: row.next_remind || '',
      status: row.status,
      photos: row.photos || [],
      resolvedDate: row.resolved_date || '',
      createdAt: row.created_at,
      history: row.history || []
    };
  },

  _defectToRow(defect) {
    return {
      id: this._uuid(defect.id),
      unit_id: defect.unitId,
      brand: defect.brand || '',
      part: defect.part,
      category: defect.category,
      level: defect.level,
      description: defect.desc || '',
      found_date: defect.foundDate || null,
      reporter: defect.reporter || '',
      remind_days: defect.remindDays || 0,
      next_remind: defect.nextRemind || null,
      status: defect.status || 'reported',
      photos: defect.photos || [],
      resolved_date: defect.resolvedDate || null,
      history: defect.history || [],
      created_at: defect.createdAt || new Date().toISOString()
    };
  },

  _photoFromRow(row, blob) {
    return {
      id: row.id,
      defectId: row.defect_id,
      name: row.name || '',
      storagePath: row.storage_path,
      mime: row.mime || '',
      size: row.size || 0,
      blob
    };
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
    if (!head || !body) throw this._error('备份中的照片数据无效', 'INVALID_PHOTO');
    const mime = (head.match(/data:(.*?);/) || [])[1] || 'image/jpeg';
    const binary = atob(body);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mime });
  },

  _error(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
};
