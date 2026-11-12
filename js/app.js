/* ============================================================
 * 主逻辑：视图切换 / 驾驶舱 / 台账 / 录入 / 提醒 / 导出 / 统计
 * ============================================================ */

const App = {
  units: [],
  defects: [],
  photos: new Map(),   // photoId -> objectURL（运行时缓存）
  currentUnitId: null,
  viewer: null,
  role: 'operator',
  treeFilter: 'all',   // 侧栏类型页签：all / turbine / transformer
  entryUnitType: '',   // 缺陷录入设备类型筛选
  filters: { level: '', status: '', part: '' },

  async boot() {
    await DB.open();
    this.role = this.resolveRole();
    this.applyRoleUI();
    await this.reload();
    if (this.isAdmin() && await this.ensureTransformerUnits68To134()) await this.reload();
    this.bindNav();
    this.bindEntryForm();
    this.bindDataPanel();
    this.bindLedgerActions();
    this.checkReminders(true);
    if (this.units.length === 0) this.offerFirstUnit();
  },

  resolveRole() {
    const email = String(Auth.session()?.user?.email || '').trim().toLowerCase();
    const admins = (window.CLOUD_CONFIG?.adminEmails || [])
      .map(item => String(item).trim().toLowerCase())
      .filter(Boolean);
    return admins.includes(email) ? 'admin' : 'operator';
  },

  isAdmin() {
    return this.role === 'admin';
  },

  applyRoleUI() {
    const dataNav = document.querySelector('.nav-btn[data-view="data"]');
    if (dataNav) dataNav.classList.toggle('hidden', !this.isAdmin());
    const addUnitBtn = document.getElementById('addUnitBtn');
    if (addUnitBtn) addUnitBtn.classList.toggle('hidden', !this.isAdmin());
  },

  async reload() {
    this.units = await DB.getAll('units');
    this.defects = await DB.getAll('defects');
    this.renderSidebar();
    this.renderDashboard();
    if (this.currentUnitId) this.renderLedger();
    this.renderStats();
    this.updateBell();
  },

  async ensureTransformerUnits68To134() {
    const start = 68;
    const end = 134;
    const farm = '彰北中心站';
    const taikaiNumbers = new Set([94, 115, 134]);
    const existingNumbers = new Set(
      this.units
        .filter(unit => unit.type === 'transformer')
        .map(unit => String(unit.name || '').match(/\d+/))
        .filter(Boolean)
        .map(match => Number(match[0]))
    );
    const missing = [];
    for (let number = start; number <= end; number++) {
      if (existingNumbers.has(number)) continue;
      missing.push({
        id: uid(),
        type: 'transformer',
        brand: taikaiNumbers.has(number) ? 'taikai' : 'dongmeng',
        name: `#${number}箱变`,
        farm,
        model: '',
        createdAt: new Date().toISOString()
      });
    }
    if (!missing.length) return false;
    try {
      await DB.putMany('units', missing);
      console.info(`已补齐 ${missing.length} 台彰北中心站箱变`);
      return true;
    } catch (error) {
      console.error('补齐箱变失败', error);
      return false;
    }
  },

  /* ================= 导航 ================= */
  bindNav() {
    document.querySelectorAll('.nav-btn').forEach(b => {
      b.onclick = () => this.showView(b.dataset.view);
    });
    document.getElementById('bellBtn').onclick = () => this.checkReminders(false);
  },

  showView(name) {
    if (name === 'data' && !this.isAdmin()) return;
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + name));
    const tf = document.getElementById('treeTabs');
    if (tf) tf.classList.toggle('show', name === 'ledger');   // 类型筛选只在机组台账页显示
    if (name === 'stats') this.renderStats();
    if (name === 'entry') this.fillUnitSelect();
    if (name === 'ledger' && this.currentUnitId) setTimeout(() => this.initViewer(), 50);
  },

  /* ================= 侧栏机组树 ================= */
  renderSidebar() {
    const tree = document.getElementById('unitTree');

    /* 类型页签（全部 / 风机 / 箱变，带数量角标） */
    const tabLabels = { turbine: '风机', transformer: '箱变' };
    const tabs = document.getElementById('treeTabs');
    const tabDefs = [{ key: 'all', label: '全部' }]
      .concat(Object.keys(DEVICE_TYPES).filter(k => this.units.some(u => u.type === k))
        .map(k => ({ key: k, label: tabLabels[k] || DEVICE_TYPES[k].name })));
    tabs.innerHTML = tabDefs.map(t => {
      const cnt = t.key === 'all' ? this.units.length : this.units.filter(u => u.type === t.key).length;
      return `<div class="tree-tab ${this.treeFilter === t.key ? 'active' : ''}" data-key="${t.key}">${t.label}<span class="cnt">${cnt}</span></div>`;
    }).join('');
    tabs.querySelectorAll('.tree-tab').forEach(el => {
      el.onclick = () => {
        this.treeFilter = el.dataset.key;
        // 切换类型时，若当前选中的设备不属于该类型，自动选该类型第一台
        const cur = this.units.find(u => u.id === this.currentUnitId);
        if (this.treeFilter !== 'all' && (!cur || cur.type !== this.treeFilter)) {
          const first = this.units.filter(u => u.type === this.treeFilter)
            .sort(compareUnitNames)[0];
          this.currentUnitId = first ? first.id : null;
        }
        this.renderSidebar();
        if (this.currentUnitId) this.renderLedger();
      };
    });

    /* 按页签过滤后的机组，再按风场分组 */
    const shown = this.units.filter(u => this.treeFilter === 'all' || u.type === this.treeFilter);
    const farms = {};
    shown.forEach(u => { (farms[u.farm || '默认风场'] = farms[u.farm || '默认风场'] || []).push(u); });
    let html = '';
    for (const farm in farms) {
      html += `<div class="farm-group">${esc(farm)}</div>`;
      farms[farm].sort(compareUnitNames).forEach(u => {
        const h = unitHealth(this.defects.filter(d => d.unitId === u.id));
        const color = h === 0 ? HEALTH_GOOD.color : LEVELS[h].color;
        html += `<div class="unit-item ${u.id === this.currentUnitId ? 'active' : ''}" data-id="${u.id}">
          <span class="dot" style="background:${color}"></span>
          <span>${esc(u.name)}</span>
          <span class="u-type">${DEVICE_TYPES[u.type] ? DEVICE_TYPES[u.type].name : u.type}</span>
        </div>`;
      });
    }
    tree.innerHTML = html || '<div class="empty-tip" style="padding:20px">该类型暂无设备<br>点击右上角 ＋ 新增</div>';
    tree.querySelectorAll('.unit-item').forEach(el => {
      el.onclick = () => { this.currentUnitId = el.dataset.id; this.renderSidebar(); this.showView('ledger'); this.renderLedger(); };
    });
    document.getElementById('addUnitBtn').onclick = () => this.unitModal();
  },

  /* ================= 驾驶舱 ================= */
  renderDashboard() {
    const counts = { 4: 0, 3: 0, 2: 0, 1: 0, 0: 0 };
    const unitInfo = this.units.map(u => {
      const ds = this.defects.filter(d => d.unitId === u.id);
      const h = unitHealth(ds);
      counts[h]++;
      return { u, ds, h, open: ds.filter(d => d.status !== 'resolved') };
    });

    document.getElementById('dashSummary').textContent =
      `共 ${this.units.length} 台设备 · 未闭环缺陷 ${this.defects.filter(d => d.status !== 'resolved').length} 项`;

    const hb = document.getElementById('healthBar');
    hb.innerHTML =
      hbItem(counts[4], LEVELS[4], '立即处理') +
      hbItem(counts[3], LEVELS[3], '限期处理') +
      hbItem(counts[2], LEVELS[2], '计划处理') +
      hbItem(counts[1], LEVELS[1], '持续观察') +
      hbItem(counts[0], HEALTH_GOOD, '运行良好');

    const cards = document.getElementById('unitCards');
    const order = { 4: 0, 3: 1, 2: 2, 1: 3, 0: 4 };
    unitInfo.sort((a, b) => order[a.h] - order[b.h] || compareUnitNames(a.u, b.u));
    cards.innerHTML = unitInfo.map(({ u, ds, h, open }) => {
      const color = h === 0 ? HEALTH_GOOD.color : LEVELS[h].color;
      const hName = h === 0 ? HEALTH_GOOD.name : LEVELS[h].name;
      const chips = open.slice(0, 4).map(d =>
        `<span class="chip" style="background:${LEVELS[d.level].color}">${esc(partName(u.type, d.part))}·${esc(d.category)}</span>`).join('');
      return `<div class="unit-card" data-id="${u.id}" style="border-top-color:${color}">
        <div class="uc-name">${DEVICE_TYPES[u.type]?.icon || ''} ${esc(u.name)}</div>
        <div class="uc-type">${DEVICE_TYPES[u.type]?.name || ''}${u.type === 'transformer' ? ' · ' + brandShort(u.brand) : ''} · ${esc(u.farm || '')} ${u.model ? '· ' + esc(u.model) : ''}</div>
        <div class="uc-row"><span>状态：<b style="color:${color}">${hName}</b></span><span>未闭环 ${open.length} / 累计 ${ds.length}</span></div>
        <div class="uc-chips">${chips}${open.length > 4 ? `<span class="chip" style="background:#90a4ae">+${open.length - 4}</span>` : ''}</div>
      </div>`;
    }).join('') || '<div class="empty-tip">暂无机组，请先在左侧 ＋ 新增机组</div>';

    cards.querySelectorAll('.unit-card').forEach(el => {
      el.onclick = () => { this.currentUnitId = el.dataset.id; this.renderSidebar(); this.showView('ledger'); this.renderLedger(); };
    });

    function hbItem(n, lv, tip) {
      return `<div class="hb-item"><span class="dot" style="background:${lv.color};width:14px;height:14px"></span>
        <div><div class="num" style="color:${lv.color}">${n}</div><div style="font-size:12px;color:var(--sub)">${lv.name} · ${tip}</div></div></div>`;
    }
  },

  /* ================= 机组台账 ================= */
  renderLedger() {
    const u = this.units.find(x => x.id === this.currentUnitId);
    document.getElementById('ledgerEmpty').classList.toggle('hidden', !!u);
    document.getElementById('ledgerBody').classList.toggle('hidden', !u);
    if (!u) return;

    const ds = this.defects.filter(d => d.unitId === u.id);
    const h = unitHealth(ds);
    const color = h === 0 ? HEALTH_GOOD.color : LEVELS[h].color;
    const hName = h === 0 ? HEALTH_GOOD.name : LEVELS[h].name;

    document.getElementById('ldUnitName').textContent = u.name;
    document.getElementById('ldUnitMeta').textContent =
      `${DEVICE_TYPES[u.type]?.name || ''}${u.type === 'transformer' ? ' · ' + brandName(u.brand) : ''} · ${u.farm || ''} ${u.model ? '· ' + u.model : ''}`;
    const badge = document.getElementById('ldHealth');
    badge.textContent = hName;
    badge.style.background = color;
    document.getElementById('ldDeleteUnit').classList.toggle('hidden', !this.isAdmin());

    // 筛选器
    const fl = document.getElementById('fltLevel');
    fl.innerHTML = '<option value="">全部等级</option>' + Object.keys(LEVELS).sort((a,b)=>b-a).map(l => `<option value="${l}">${LEVELS[l].name}</option>`).join('');
    fl.value = this.filters.level;
    const fs = document.getElementById('fltStatus');
    fs.innerHTML = '<option value="">全部状态</option>' + STATUS_FLOW.map(s => `<option value="${s}">${STATUS[s].name}</option>`).join('');
    fs.value = this.filters.status;
    const fp = document.getElementById('fltPart');
    fp.innerHTML = '<option value="">全部部位</option>' + (DEVICE_TYPES[u.type]?.parts || []).map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    fp.value = this.filters.part;
    fl.onchange = () => { this.filters.level = fl.value; this.renderDefectList(u); };
    fs.onchange = () => { this.filters.status = fs.value; this.renderDefectList(u); };
    fp.onchange = () => { this.filters.part = fp.value; this.renderDefectList(u); };

    this.initViewer();
    this.renderDefectList(u);
  },

  initViewer() {
    const u = this.units.find(x => x.id === this.currentUnitId);
    if (!u) return;
    const box = document.getElementById('viewer3dBox');
    box.innerHTML = '';
    if (this.viewer) { this.viewer.dispose(); this.viewer = null; }
    this.viewer = new Viewer3D(box, DEVICE_TYPES[u.type]?.model3d || 'turbine', u.type,
      { brand: u.brand || 'taikai', label: u.name });
    this.viewer.onMarkerClick = d => this.defectModal(d.id, true);
    this.viewer.setDefects(this.defects.filter(d => d.unitId === u.id));
    const gt = document.getElementById('ghostToggle');
    gt.checked = false;
    // 塔基视图仅风机可用
    const bv = document.getElementById('baseView');
    if (bv) bv.style.display = (DEVICE_TYPES[u.type]?.model3d === 'turbine') ? '' : 'none';
    gt.onchange = () => this.viewer && this.viewer.setGhost(gt.checked);
    document.getElementById('resetView').onclick = () => {
      if (!this.viewer) return;
      this.viewer.resetView();
      this.viewer.setGhost(false);
      gt.checked = false;
    };
    document.getElementById('baseView').onclick = () => {
      if (!this.viewer || !this.viewer.focusBase) return;
      this.viewer.focusBase();
    };
  },

  renderDefectList(u) {
    const list = document.getElementById('defectList');
    let ds = this.defects.filter(d => d.unitId === u.id);
    if (this.filters.level) ds = ds.filter(d => d.level == this.filters.level);
    if (this.filters.status) ds = ds.filter(d => d.status === this.filters.status);
    if (this.filters.part) ds = ds.filter(d => d.part === this.filters.part);
    ds.sort((a, b) => (b.level - a.level) || (b.foundDate || '').localeCompare(a.foundDate || ''));

    const today = todayStr();
    list.innerHTML = ds.map(d => {
      const lv = LEVELS[d.level], st = STATUS[d.status];
      const overdue = d.remindDays > 0 && d.status !== 'resolved' && d.nextRemind && d.nextRemind <= today;
      return `<div class="defect-card" style="border-left-color:${lv.color}" data-id="${d.id}">
        <div class="dc-head">
          <span class="dc-title">${esc(partName(u.type, d.part))} · ${esc(d.category)}</span>
          <span class="tag" style="background:${lv.color}">${lv.name}</span>
          <span class="tag" style="background:${st.color}">${st.name}</span>
          ${overdue ? '<span class="remind-flag">⏰ 复检到期</span>' : ''}
        </div>
        <div class="dc-desc">${esc(d.desc)}</div>
        <div class="dc-meta">
          <span>发现：${d.foundDate || '—'}</span><span>填报：${esc(d.reporter || '—')}</span>
          ${d.remindDays > 0 ? `<span>复检周期 ${d.remindDays} 天${d.nextRemind ? ' · 下次 ' + d.nextRemind : ''}</span>` : ''}
          <span>照片 ${(d.photos || []).length} 张</span>
        </div>
        <div class="dc-photos" data-photos></div>
        <div class="dc-actions">
          <button class="btn sm" data-act="locate">📍 3D定位</button>
          <button class="btn sm" data-act="detail">详情</button>
          ${st.next ? `<button class="btn sm primary" data-act="advance">${st.nextName}</button>` : ''}
          ${d.remindDays > 0 && d.status !== 'resolved' ? '<button class="btn sm" data-act="reviewed">已复检</button>' : ''}
          ${this.isAdmin() ? '<button class="btn sm danger" data-act="del">删除</button>' : ''}
        </div>
      </div>`;
    }).join('') || '<div class="empty-tip" style="padding:24px">无匹配缺陷</div>';

    // 异步加载照片缩略图
    list.querySelectorAll('.defect-card').forEach(card => {
      const d = ds.find(x => x.id === card.dataset.id);
      const holder = card.querySelector('[data-photos]');
      (d.photos || []).forEach(async pid => {
        const url = await this.photoURL(pid);
        if (url) {
          const img = document.createElement('img');
          img.src = url; img.onclick = () => window.open(url, '_blank');
          holder.appendChild(img);
        }
      });
      card.querySelectorAll('[data-act]').forEach(btn => {
        btn.onclick = async e => {
          e.stopPropagation();
          const act = btn.dataset.act;
          if (act === 'detail') this.defectModal(d.id, true);
          else if (act === 'locate') { if (this.viewer) this.viewer.focusPart(d.part); }
          else if (act === 'advance') await this.advanceStatus(d.id);
          else if (act === 'reviewed') await this.markReviewed(d.id);
          else if (act === 'del') this.confirmDelete(d.id);
        };
      });
    });
  },

  async photoURL(pid) {
    if (this.photos.has(pid)) return this.photos.get(pid);
    const p = await DB.get('photos', pid);
    if (!p) return null;
    const url = URL.createObjectURL(p.blob);
    this.photos.set(pid, url);
    return url;
  },

  async advanceStatus(id) {
    const d = this.defects.find(x => x.id === id);
    const st = STATUS[d.status];
    if (!st.next) return;
    d.status = st.next;
    (d.history = d.history || []).push({ ts: new Date().toISOString(), action: st.nextName });
    if (st.next === 'resolved') { d.resolvedDate = todayStr(); }
    await DB.put('defects', d);
    await this.reload();
  },

  async markReviewed(id) {
    const d = this.defects.find(x => x.id === id);
    const next = new Date();
    next.setDate(next.getDate() + (d.remindDays || 30));
    d.nextRemind = next.toISOString().slice(0, 10);
    (d.history = d.history || []).push({ ts: new Date().toISOString(), action: '完成复检' });
    await DB.put('defects', d);
    await this.reload();
    this.checkReminders(false, true);
  },

  confirmDelete(id) {
    if (!this.isAdmin()) return;
    this.modal(`<h3>确认删除</h3><p>删除该缺陷及其照片，不可恢复。</p>
      <div class="modal-actions"><button class="btn" id="mCancel">取消</button><button class="btn danger" id="mOk">删除</button></div>`);
    document.getElementById('mCancel').onclick = () => this.closeModal();
    document.getElementById('mOk').onclick = async () => {
      const d = this.defects.find(x => x.id === id);
      for (const pid of (d.photos || [])) await DB.del('photos', pid);
      await DB.del('defects', id);
      this.closeModal();
      await this.reload();
    };
  },

  confirmDeleteUnit(unitId) {
    if (!this.isAdmin()) return;
    const unit = this.units.find(item => item.id === unitId);
    if (!unit) return;
    const defects = this.defects.filter(item => item.unitId === unitId);
    this.modal(`<h3>删除设备</h3>
      <p>确定删除 <b>${esc(unit.name)}</b>？该设备下的 ${defects.length} 条缺陷及照片也会一并删除，此操作不可恢复。</p>
      <div class="modal-actions"><button class="btn" id="mCancel">取消</button><button class="btn danger" id="mOk">删除设备</button></div>`);
    document.getElementById('mCancel').onclick = () => this.closeModal();
    document.getElementById('mOk').onclick = async () => {
      const button = document.getElementById('mOk');
      button.disabled = true;
      button.textContent = '删除中...';
      try {
        for (const defect of defects) {
          for (const photoId of (defect.photos || [])) await DB.del('photos', photoId);
        }
        await DB.del('units', unitId);
        for (const url of this.photos.values()) URL.revokeObjectURL(url);
        this.photos.clear();
        if (this.currentUnitId === unitId) this.currentUnitId = null;
        this.closeModal();
        await this.reload();
      } catch (error) {
        console.error('删除设备失败', error);
        button.disabled = false;
        button.textContent = '删除设备';
        alert(`删除失败：${error.message || '云端请求失败'}`);
      }
    };
  },

  /* ================= 台账页按钮 ================= */
  bindLedgerActions() {
    document.getElementById('ldDeleteUnit').onclick = () => {
      if (this.currentUnitId) this.confirmDeleteUnit(this.currentUnitId);
    };
    document.getElementById('ldAddDefect').onclick = () => {
      const unit = this.units.find(x => x.id === this.currentUnitId);
      this.entryUnitType = unit?.type || '';
      const search = document.getElementById('fUnitSearch');
      if (search) search.value = '';
      this.showView('entry');
      this.fillUnitSelect();
      document.getElementById('fUnit').value = this.currentUnitId;
      document.getElementById('fUnit').dispatchEvent(new Event('change'));
    };
    document.getElementById('ldExport').onclick = () => this.exportExcel(this.currentUnitId);
    document.getElementById('ldPrint').onclick = () => this.printReport(this.currentUnitId);
  },

  /* ================= 缺陷录入 ================= */
  bindEntryForm() {
    const fUnit = document.getElementById('fUnit');
    const fPart = document.getElementById('fPart');
    const fCat = document.getElementById('fCat');
    const fBrand = document.getElementById('fBrand');
    const fBrandRow = document.getElementById('fBrandRow');

    // 箱变厂家选项（泰开 / 东盟 二选一）
    fBrand.innerHTML = Object.values(TRANSFORMER_BRANDS)
      .map(b => `<option value="${b.id}">${b.name} · ${b.desc}</option>`).join('');

    document.querySelectorAll('#fUnitType .entry-seg').forEach(button => {
      button.onclick = () => {
        this.entryUnitType = button.dataset.type || '';
        document.querySelectorAll('#fUnitType .entry-seg')
          .forEach(item => item.classList.toggle('active', item === button));
        this.fillUnitSelect();
      };
    });

    const unitSearch = document.getElementById('fUnitSearch');
    unitSearch.oninput = () => this.fillUnitSelect();
    unitSearch.onkeydown = event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        this.fillUnitSelect();
      }
    };

    // 等级选择器
    const lp = document.getElementById('fLevel');
    lp.innerHTML = Object.keys(LEVELS).sort((a, b) => b - a).map(l =>
      `<div class="lv-opt" data-lv="${l}" style="color:${LEVELS[l].dark}">
        <span class="lv-dot" style="background:${LEVELS[l].color}"></span>${LEVELS[l].name}
        <small>${LEVELS[l].desc}</small></div>`).join('');
    let selLevel = null;
    lp.querySelectorAll('.lv-opt').forEach(el => {
      el.onclick = () => {
        lp.querySelectorAll('.lv-opt').forEach(x => x.classList.remove('sel'));
        el.classList.add('sel');
        selLevel = +el.dataset.lv;
      };
    });

    fUnit.onchange = () => {
      const u = this.units.find(x => x.id === fUnit.value);
      const parts = u ? (DEVICE_TYPES[u.type]?.parts || []) : [];
      fPart.innerHTML = '<option value="">请选择部位</option>' + parts.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
      fCat.innerHTML = '<option value="">请先选择部位</option>';
      // 只有箱变需要选厂家
      const isTf = !!u && u.type === 'transformer';
      fBrandRow.style.display = isTf ? '' : 'none';
      fBrand.required = isTf;
      if (isTf) fBrand.value = u.brand || 'taikai';
    };
    fPart.onchange = () => {
      const u = this.units.find(x => x.id === fUnit.value);
      const p = u ? getPart(u.type, fPart.value) : null;
      fCat.innerHTML = p ? '<option value="">请选择缺陷类型</option>' + p.cats.map(c => `<option>${c}</option>`).join('') : '<option value="">请先选择部位</option>';
    };

    document.getElementById('fPhotos').onchange = e => {
      const pv = document.getElementById('photoPreview');
      pv.innerHTML = '';
      [...e.target.files].forEach(f => {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(f);
        pv.appendChild(img);
      });
    };

    document.getElementById('fDate').value = todayStr();

    document.getElementById('entryForm').onsubmit = async e => {
      e.preventDefault();
      if (!selLevel) { alert('请选择严重等级'); return; }
      const unit = this.units.find(x => x.id === fUnit.value);
      if (!unit) { alert('请选择机组 / 设备'); return; }
      const isTf = unit.type === 'transformer';
      const brand = isTf ? fBrand.value : '';
      // 厂家变更立即写回设备档案，台账 3D 随之切换为对应实物模型
      if (isTf && unit.brand !== brand) { unit.brand = brand; await DB.put('units', unit); }
      const d = {
        id: uid(),
        unitId: fUnit.value,
        brand: brand,
        part: fPart.value,
        category: fCat.value,
        level: selLevel,
        desc: document.getElementById('fDesc').value.trim(),
        foundDate: document.getElementById('fDate').value,
        reporter: document.getElementById('fReporter').value.trim(),
        remindDays: +document.getElementById('fRemind').value,
        status: 'reported',
        photos: [],
        createdAt: new Date().toISOString(),
        history: [{ ts: new Date().toISOString(), action: '填报' }]
      };
      if (d.remindDays > 0) {
        const n = new Date(); n.setDate(n.getDate() + d.remindDays);
        d.nextRemind = n.toISOString().slice(0, 10);
      }
      await DB.put('defects', d);
      const failedPhotos = [];
      for (const file of document.getElementById('fPhotos').files) {
        try {
          const pid = uid();
          await DB.put('photos', { id: pid, defectId: d.id, name: file.name, blob: file });
          d.photos.push(pid);
        } catch (error) {
          failedPhotos.push(file.name);
          console.error('照片上传失败', file.name, error);
        }
      }
      if (d.photos.length) await DB.put('defects', d);
      if (failedPhotos.length) {
        alert(`缺陷已保存，但以下照片上传失败：\n${failedPhotos.join('\n')}`);
      }
      await this.reload();
      this.currentUnitId = d.unitId;
      e.target.reset();
      fBrandRow.style.display = 'none';
      document.getElementById('photoPreview').innerHTML = '';
      lp.querySelectorAll('.lv-opt').forEach(x => x.classList.remove('sel'));
      selLevel = null;
      document.getElementById('fDate').value = todayStr();
      this.showView('ledger');
      this.renderLedger();
    };
  },

  fillUnitSelect() {
    const fUnit = document.getElementById('fUnit');
    if (!fUnit) return;
    const cur = fUnit.value;
    const queryText = (document.getElementById('fUnitSearch')?.value || '')
      .trim()
      .replace(/^#+/, '')
      .toLowerCase();
    const type = this.entryUnitType || '';
    document.querySelectorAll('#fUnitType .entry-seg').forEach(button => {
      button.classList.toggle('active', (button.dataset.type || '') === type);
    });
    const units = this.units
      .filter(unit => !type || unit.type === type)
      .filter(unit => {
        if (!queryText) return true;
        const haystack = [
          unit.name,
          unit.farm,
          unit.model,
          DEVICE_TYPES[unit.type]?.name,
          unit.type === 'transformer' ? brandName(unit.brand) : ''
        ].join(' ').toLowerCase();
        return haystack.includes(queryText);
      })
      .sort(compareUnitNames);
    fUnit.innerHTML = '<option value="">请选择机组/设备</option>' +
      units.map(unit => `<option value="${unit.id}">${esc(unit.name)}（${DEVICE_TYPES[unit.type]?.name || ''} · ${esc(unit.farm || '')}）</option>`).join('');
    const count = document.getElementById('fUnitCount');
    if (count) count.textContent = `${units.length} 台`;
    if (cur && units.some(unit => unit.id === cur)) {
      fUnit.value = cur;
    } else if (cur) {
      fUnit.value = '';
      fUnit.dispatchEvent(new Event('change'));
    }
  },

  /* ================= 弹窗 ================= */
  modal(html) {
    document.getElementById('modalBox').innerHTML = html;
    document.getElementById('modalMask').classList.remove('hidden');
  },
  closeModal() { document.getElementById('modalMask').classList.add('hidden'); },

  unitModal() {
    if (!this.isAdmin()) return;
    const opts = Object.keys(DEVICE_TYPES).map(k => {
      const t = DEVICE_TYPES[k];
      return `<option value="${k}" ${t.planned ? 'disabled' : ''}>${t.icon || ''} ${t.name}${t.planned ? '（二期规划）' : ''}</option>`;
    }).join('');
    const brandOpts = Object.values(TRANSFORMER_BRANDS)
      .map(b => `<option value="${b.id}">${b.name} · ${b.desc}</option>`).join('');
    this.modal(`<h3>新增机组 / 设备</h3>
      <div class="m-field"><label>设备类型 *</label><select id="mType">${opts}</select></div>
      <div class="m-field" id="mBrandField" style="display:none"><label>箱变厂家 *</label><select id="mBrand">${brandOpts}</select></div>
      <div class="m-field"><label>编号 / 名称 *</label><input id="mName" placeholder="例：F01 风机 / F01 箱变"></div>
      <div class="m-field"><label>所属风场</label><input id="mFarm" placeholder="例：一期风场"></div>
      <div class="m-field"><label>机型 / 型号</label><input id="mModel" placeholder="例：金风 GW165-4.0MW"></div>
      <div class="modal-actions"><button class="btn" id="mCancel">取消</button><button class="btn primary" id="mOk">保存</button></div>`);
    const mType = document.getElementById('mType');
    const mBrandField = document.getElementById('mBrandField');
    const syncBrand = () => { mBrandField.style.display = mType.value === 'transformer' ? '' : 'none'; };
    mType.onchange = syncBrand; syncBrand();
    document.getElementById('mCancel').onclick = () => this.closeModal();
    document.getElementById('mOk').onclick = async () => {
      const name = document.getElementById('mName').value.trim();
      if (!name) { alert('请填写编号/名称'); return; }
      const type = mType.value;
      const u = {
        id: uid(),
        type,
        brand: type === 'transformer' ? document.getElementById('mBrand').value : '',
        name,
        farm: document.getElementById('mFarm').value.trim() || '默认风场',
        model: document.getElementById('mModel').value.trim(),
        createdAt: new Date().toISOString()
      };
      await DB.put('units', u);
      this.currentUnitId = u.id;
      this.closeModal();
      await this.reload();
      this.showView('ledger');
      this.renderLedger();
    };
  },

  async defectModal(id, readonly) {
    const d = this.defects.find(x => x.id === id);
    if (!d) return;
    const u = this.units.find(x => x.id === d.unitId);
    const lv = LEVELS[d.level], st = STATUS[d.status];
    const hist = (d.history || []).map(h => `<div class="dc-meta">${(h.ts || '').slice(0, 16).replace('T', ' ')} · ${esc(h.action)}</div>`).join('');
    this.modal(`<h3>缺陷详情</h3>
      <div class="dc-head" style="margin-bottom:8px">
        <span class="dc-title">${esc(u?.name || '')} · ${esc(partName(u?.type, d.part))} · ${esc(d.category)}</span>
        <span class="tag" style="background:${lv.color}">${lv.name}</span>
        <span class="tag" style="background:${st.color}">${st.name}</span>
      </div>
      <div class="dc-desc">${esc(d.desc)}</div>
      <div class="dc-meta"><span>发现：${d.foundDate || '—'}</span><span>填报：${esc(d.reporter || '—')}</span>
      ${d.resolvedDate ? `<span>消除：${d.resolvedDate}</span>` : ''}</div>
      <div class="dc-photos" id="mPhotos"></div>
      <h4 style="margin:12px 0 6px">处理记录</h4>${hist || '<div class="dc-meta">无</div>'}
      <div class="modal-actions"><button class="btn" onclick="App.closeModal()">关闭</button></div>`);
    const holder = document.getElementById('mPhotos');
    for (const pid of (d.photos || [])) {
      const url = await this.photoURL(pid);
      if (url) { const img = document.createElement('img'); img.src = url; img.onclick = () => window.open(url, '_blank'); holder.appendChild(img); }
    }
  },

  /* ================= 到期提醒 ================= */
  dueReminders() {
    const today = todayStr();
    return this.defects.filter(d => d.remindDays > 0 && d.status !== 'resolved' && d.nextRemind && d.nextRemind <= today);
  },

  updateBell() {
    const n = this.dueReminders().length;
    const badge = document.getElementById('bellBadge');
    badge.textContent = n;
    badge.classList.toggle('hidden', n === 0);
  },

  checkReminders(auto, silentIfNone) {
    const due = this.dueReminders();
    this.updateBell();
    if (due.length === 0) { if (!auto && !silentIfNone) alert('当前没有到期复检的缺陷 ✅'); return; }
    const rows = due.map(d => {
      const u = this.units.find(x => x.id === d.unitId);
      const lv = LEVELS[d.level];
      return `<div class="defect-card" style="border-left-color:${lv.color}">
        <div class="dc-head"><span class="dc-title">${esc(u?.name || '')} · ${esc(partName(u?.type, d.part))} · ${esc(d.category)}</span>
        <span class="tag" style="background:${lv.color}">${lv.name}</span></div>
        <div class="dc-meta"><span>复检到期：${d.nextRemind}</span><span>周期：每 ${d.remindDays} 天</span></div>
        <div class="dc-actions"><button class="btn sm primary" data-rid="${d.id}">标记已复检</button></div>
      </div>`;
    }).join('');
    this.modal(`<h3>⏰ 到期复检提醒（${due.length} 项）</h3>${rows}
      <div class="modal-actions"><button class="btn" onclick="App.closeModal()">知道了</button></div>`);
    document.querySelectorAll('[data-rid]').forEach(b => {
      b.onclick = async () => { await this.markReviewed(b.dataset.rid); this.checkReminders(false, true); };
    });
  },

  /* ================= 导出 ================= */
  exportExcel(unitId) {
    let ds = this.defects, us = this.units, fname = '缺陷台账_全部';
    if (unitId) {
      const u = this.units.find(x => x.id === unitId);
      ds = ds.filter(d => d.unitId === unitId);
      us = [u];
      fname = `缺陷台账_${u.name}`;
    }
    const head = ['机组/设备', '设备类型', '设备厂家', '所属风场', '缺陷部位', '缺陷类型', '严重等级', '缺陷描述', '状态', '发现日期', '填报人', '复检周期(天)', '下次复检', '消除日期', '照片数'];
    const rows = ds.sort((a, b) => b.level - a.level).map(d => {
      const u = this.units.find(x => x.id === d.unitId) || {};
      return [u.name || '', DEVICE_TYPES[u.type]?.name || '', u.type === 'transformer' ? brandName(u.brand) : '', u.farm || '', partName(u.type, d.part), d.category,
        LEVELS[d.level]?.name || '', d.desc, STATUS[d.status]?.name || '', d.foundDate || '', d.reporter || '',
        d.remindDays || 0, d.nextRemind || '', d.resolvedDate || '', (d.photos || []).length];
    });
    const ws = XLSX.utils.aoa_to_sheet([head, ...rows]);
    ws['!cols'] = head.map(() => ({ wch: 16 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '缺陷台账');
    XLSX.writeFile(wb, `${fname}_${todayStr()}.xlsx`);
  },

  async printReport(unitId) {
    const u = this.units.find(x => x.id === unitId);
    if (!u) return;
    const ds = this.defects.filter(d => d.unitId === unitId).sort((a, b) => b.level - a.level);
    const h = unitHealth(ds);
    const photoCells = async d => {
      const urls = [];
      for (const pid of (d.photos || [])) { const url = await this.photoURL(pid); if (url) urls.push(`<img src="${url}">`); }
      return urls.join('') || '—';
    };
    const trs = [];
    for (const d of ds) {
      trs.push(`<tr><td>${esc(partName(u.type, d.part))}</td><td>${esc(d.category)}</td>
        <td style="color:${LEVELS[d.level].dark};font-weight:700">${LEVELS[d.level].name}</td>
        <td>${esc(d.desc)}</td><td>${STATUS[d.status].name}</td><td>${d.foundDate || ''}</td><td>${esc(d.reporter || '')}</td>
        <td>${await photoCells(d)}</td></tr>`);
    }
    document.getElementById('printArea').innerHTML = `
      <h1>${esc(u.name)} 智慧运维台账（图文报告）</h1>
      <div class="p-meta">${DEVICE_TYPES[u.type]?.name || ''}${u.type === 'transformer' ? ' · ' + brandName(u.brand) : ''} · ${esc(u.farm || '')} ${u.model ? '· ' + esc(u.model) : ''} ·
        当前状态：${h === 0 ? HEALTH_GOOD.name : LEVELS[h].name} · 累计缺陷 ${ds.length} 项 · 生成日期 ${todayStr()}</div>
      <table><thead><tr><th>部位</th><th>缺陷类型</th><th>等级</th><th>描述</th><th>状态</th><th>发现日期</th><th>填报人</th><th>照片</th></tr></thead>
      <tbody>${trs.join('')}</tbody></table>`;
    window.print();
  },

  /* ================= 统计 ================= */
  renderStats() {
    const body = document.getElementById('statsBody');
    if (!this.defects.length) { body.innerHTML = '<div class="empty-tip">暂无数据</div>'; return; }

    const byLevel = {}, byPart = {}, byStatus = {}, byMonth = {};
    this.defects.forEach(d => {
      byLevel[d.level] = (byLevel[d.level] || 0) + 1;
      const u = this.units.find(x => x.id === d.unitId);
      const pn = partName(u?.type, d.part);
      byPart[pn] = (byPart[pn] || 0) + 1;
      byStatus[d.status] = (byStatus[d.status] || 0) + 1;
      const m = (d.foundDate || '').slice(0, 7);
      if (m) byMonth[m] = (byMonth[m] || 0) + 1;
    });

    const bar = (label, n, max, color) =>
      `<div class="bar-row"><span class="bar-label">${label}</span>
       <div class="bar-track"><div class="bar-fill" style="width:${Math.max(2, n / max * 100)}%;background:${color}"></div></div>
       <span class="bar-num">${n}</span></div>`;

    const maxPart = Math.max(...Object.values(byPart));
    const partRows = Object.entries(byPart).sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([k, v]) => bar(esc(k), v, maxPart, '#1565c0')).join('');
    const maxMonth = Math.max(...Object.values(byMonth));
    const monthRows = Object.entries(byMonth).sort()
      .map(([k, v]) => bar(k, v, maxMonth, '#43a047')).join('');

    const resolved = byStatus.resolved || 0;
    const rate = Math.round(resolved / this.defects.length * 100);

    body.innerHTML = `
      <div class="stat-card"><h3>按严重等级</h3>
        ${Object.keys(LEVELS).sort((a, b) => b - a).map(l => bar(LEVELS[l].name, byLevel[l] || 0, this.defects.length, LEVELS[l].color)).join('')}
      </div>
      <div class="stat-card"><h3>按处理状态（消缺率 ${rate}%）</h3>
        ${STATUS_FLOW.map(s => bar(STATUS[s].name, byStatus[s] || 0, this.defects.length, STATUS[s].color)).join('')}
      </div>
      <div class="stat-card"><h3>高发部位 TOP10</h3>${partRows}</div>
      <div class="stat-card"><h3>月度缺陷趋势</h3>${monthRows || '<div class="empty-tip">无</div>'}</div>`;
  },

  /* ================= 数据管理 ================= */
  bindDataPanel() {
    document.getElementById('backupBtn').onclick = async () => {
      const data = await DB.exportJSON();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `wind-om-backup-${todayStr()}.json`;
      a.click();
    };
    document.getElementById('restoreFile').onchange = async e => {
      const f = e.target.files[0];
      if (!f) return;
      if (!confirm('恢复将覆盖当前全部数据，确定继续？')) { e.target.value = ''; return; }
      try {
        const data = JSON.parse(await f.text());
        await DB.importJSON(data);
        this.photos.clear();
        this.currentUnitId = null;
        await this.reload();
        alert('恢复成功');
      } catch (err) { alert('恢复失败：' + err.message); }
      e.target.value = '';
    };
    document.getElementById('seedBtn').onclick = async () => {
      await this.seed();
      alert('示例数据已载入');
    };
    document.getElementById('wipeBtn').onclick = async () => {
      if (!confirm('确定清空全部数据？此操作不可恢复！')) return;
      if (!confirm('再次确认：删除所有机组、缺陷和照片？')) return;
      await DB.clearAll();
      this.photos.clear();
      this.currentUnitId = null;
      await this.reload();
    };
    document.getElementById('modalMask').onclick = e => {
      if (e.target.id === 'modalMask') App.closeModal();
    };
  },

  offerFirstUnit() {
    this.modal(`<h3>云端台账暂无设备</h3><p>请先新增第一台风机或箱变，之后所有人都能从云端看到同一套台账。</p>
      <div class="modal-actions"><button class="btn" id="mLater">稍后再说</button>
      <button class="btn primary" id="mAddFirst">新增第一台设备</button></div>`);
    document.getElementById('mLater').onclick = () => this.closeModal();
    document.getElementById('mAddFirst').onclick = () => {
      this.closeModal();
      this.unitModal();
    };
  },

  async seed() {
    const mk = (type, name, farm, model, brand) => ({ id: uid(), type, name, farm, model,
      brand: type === 'transformer' ? (brand || 'taikai') : '', createdAt: new Date().toISOString() });
    const units = [
      mk('turbine', 'F01 风机', '一期风场', '金风 GW165-4.0MW'),
      mk('turbine', 'F02 风机', '一期风场', '金风 GW165-4.0MW'),
      mk('turbine', 'F03 风机', '一期风场', '明阳 MySE5.0'),
      mk('transformer', 'F01 箱变', '一期风场', 'ZGS11-4400/35', 'taikai'),
      mk('transformer', 'F02 箱变', '一期风场', 'YBM-12/0.4', 'dongmeng')
    ];
    const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10); };
    const mkD = (unitId, part, category, level, desc, days, status, remindDays) => {
      const d = {
        id: uid(), unitId, part, category, level, desc,
        foundDate: ago(days), reporter: '张三', status,
        remindDays: remindDays || 0, photos: [],
        createdAt: new Date().toISOString(), history: [{ ts: new Date().toISOString(), action: '填报' }]
      };
      if (d.remindDays > 0 && status !== 'resolved') {
        const n = new Date(); n.setDate(n.getDate() - 1); // 设为已到期，演示提醒
        d.nextRemind = n.toISOString().slice(0, 10);
      }
      if (status === 'resolved') d.resolvedDate = ago(Math.max(0, days - 3));
      return d;
    };
    const defects = [
      mkD(units[0].id, 'blade', '前缘腐蚀', 3, '1#叶片中部前缘腐蚀约30cm，未见分层，需限期修补', 12, 'confirmed', 30),
      mkD(units[0].id, 'gearbox', '箱体渗油', 2, '齿轮箱高速轴端盖处渗油，油迹面积约10×10cm', 20, 'processing', 30),
      mkD(units[0].id, 'tower_lamp', '灯管不亮', 1, '塔基LED灯管不亮，二段平台灯管亮度不足', 6, 'reported', 30),
      mkD(units[0].id, 'hoist', '钢丝绳磨损/断丝', 2, '塔底助爬提升机钢丝绳局部断丝，需更换', 9, 'confirmed', 30),
      mkD(units[0].id, 'fire', '灭火器过期/压力不足', 1, '塔基灭火器箱内2具灭火器压力表指针在黄区', 18, 'reported', 0),
      mkD(units[0].id, 'tower', '防腐层脱落/锈蚀', 1, '塔筒二段外壁防腐层局部脱落，轻微锈蚀', 45, 'reported', 0),
      mkD(units[1].id, 'electric', '紧急停机按钮异常', 4, '塔底控制柜急停按钮按下后机组无响应，需立即排查', 1, 'reported', 7),
      mkD(units[1].id, 'yaw', '偏航异响', 2, '偏航过程偶发异响，待登机检查卡钳', 8, 'confirmed', 30),
      mkD(units[1].id, 'hydraulic', '液压站渗油', 2, '液压站阀块结合面渗油，压力正常', 14, 'confirmed', 30),
      mkD(units[2].id, 'blade', '雷击损伤', 2, '2#叶片接闪器附近有烧灼痕迹，已观察两周无扩展', 30, 'resolved', 0),
      mkD(units[3].id, 'tank', '箱体渗油', 3, '箱变低压侧箱体焊缝渗油，地面有油迹', 5, 'confirmed', 7),
      mkD(units[3].id, 'gauge', '油温异常偏高', 2, '油温表指示 82℃，较同负荷相邻箱变高 8℃', 9, 'processing', 30),
      mkD(units[3].id, 'hv_room', '带电显示器异常', 1, '高压室B相带电显示器不亮', 11, 'reported', 90),
      mkD(units[3].id, 'conservator', '呼吸器硅胶变色', 2, '油枕呼吸器硅胶大面积变色（粉红），需更换硅胶', 18, 'reported', 30),
      mkD(units[3].id, 'radiator', '散热片渗油', 2, '后侧散热片下部渗油，油迹沿集油管滴挂', 14, 'confirmed', 15),
      mkD(units[3].id, 'enclosure', '箱变门损坏/锁失效', 1, '低压室门锁芯卡涩，门缝关闭不严', 7, 'reported', 0),
      mkD(units[4].id, 'conservator', '油位异常', 2, '东盟箱变油枕端面油位计指示偏低，玻璃管油位低于最低刻度', 10, 'confirmed', 15),
      mkD(units[4].id, 'radiator', '散热片堵塞/积尘', 1, '冲孔网板围挡内散热片积尘、柳絮堵塞，影响散热', 20, 'reported', 0),
      mkD(units[4].id, 'ground', '接地扁铁锈蚀断开', 1, '箱变南侧接地扁铁锈蚀严重，建议更换', 15, 'reported', 90)
    ];
    for (const u of units) await DB.put('units', u);
    for (const d of defects) await DB.put('defects', d);
    this.currentUnitId = units[0].id;
    await this.reload();
    this.showView('dashboard');
  }
};

function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

const unitNameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
function compareUnitNames(a, b) {
  return unitNameCollator.compare(String(a?.name || ''), String(b?.name || ''));
}

async function startCloudApp() {
  try {
    await App.boot();
    Auth.hide();
  } catch (error) {
    console.error(error);
    if (error.code === 'CONFIG_REQUIRED') {
      Auth.showSetup();
    } else {
      Auth.showLogin(error.message || '云端连接失败');
    }
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  Auth.bindUI();
  if (!Auth.configured()) {
    Auth.showSetup();
    return;
  }
  if (!Auth.session()) {
    Auth.showLogin();
    return;
  }
  await startCloudApp();
});
