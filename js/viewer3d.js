/* ============================================================
 * 3D 缺陷定位视图 v2（Three.js r128, UMD）—— 部件级精细建模
 *
 * 风机：按 1.5MW 双馈机型（上风向三叶片）
 *   外壳可透视，内部含：主轴/主轴承、齿轮箱、联轴器刹车、发电机、
 *   液压站、机舱控制柜、散热风扇、风速风向仪、偏航齿圈+电机；
 *   塔筒内含：平台×3、爬梯、照明灯管×3、动力电缆。
 *
 * 箱变：按欧式预装变电站"目"字型三室结构
 *   高压室(负荷开关柜) | 变压器室(油箱+油枕+套管+散热片) | 低压室(开关柜)
 *   含外壳、门板、百叶窗，可透视。
 *
 * 缺陷标记：depthTest=false 始终置顶显示，按等级着色，呼吸闪烁；
 * 交互：拖拽旋转 / 滚轮缩放 / 点击标记看详情 / 外壳透视切换。
 * ============================================================ */

/* 各部件在模型中的标记锚点（与下方建模坐标一一对应） */
const ANCHORS = {
  turbine: {
    blade:      [ 8, 72,  3],
    hub:        [ 9.6, 62.5, 0],
    main_shaft: [ 5.6, 62.2, 0],
    gearbox:    [ 2.6, 62.2, 0],
    coupling:   [ 0.6, 62.2, 0],
    generator:  [-1.8, 62.2, 0],
    hydraulic:  [ 0.2, 60.4, 1.6],
    nacelle_cab:[ 2.2, 60.6, -1.7],
    cooling:    [-2.4, 65.6, 0],
    anemometer: [-3.7, 66.0, 0],
    yaw:        [ 0, 59.3, 0],
    nacelle:    [ 1, 64.3, 0],
    tower_lamp: [ 0.6, 2.7, 1.9],
    ladder:     [ 1.15, 6, -1.35],
    hoist:      [ 1.15, 1.3, -1.0],
    platform:   [ 0, 15.2, 0],
    tower_cable:[-0.5, 6, -1.6],
    base_floor: [ 0.5, 0.45, 0.6],
    electric:   [-1.2, 1.5, -1.55],
    fire:       [-1.35, 0.65, 1.2],
    sign:       [ 1.9, 2.2, -1.3],
    tower:      [ 0, 30, 2.2],
    foundation: [ 0, 0.6, 3.4],
    other_t:    [ 0, 45, -1.8]
  },
  transformer: {
    hv_room:    [ 6.4, 2.6, 0.5],
    bushing_hv: [ 6.6, 6.05, -0.9],
    bushing_lv: [ 9.6, 1.4, 0],
    tank:       [-2.9, 2.2, 0],
    radiator:   [-2.9, 2.6, -2.3],
    conservator:[-2.9, 4.95, -0.35],
    buchholz:   [-2.9, 4.25, 0.1],
    gauge:      [-4.65, 4.6, -0.3],
    lv_cabinet: [ 1.2, 2.6, 0],
    enclosure:  [ 3, 3, 3.2],
    ground:     [ 7.5, 0.5, 3.6],
    base_x:     [-4, 0.3, 4.2]
  },
  /* 东盟箱变（蓝白配色、四坡尖顶；变压器外挂于 -x 端，冲孔网板围挡） */
  transformer_dm: {
    hv_room:    [-0.4, 2.6, 0.6],
    bushing_hv: [ 0.2, 3.0, 0.1],
    bushing_lv: [ 6.7, 1.5, 1.0],
    tank:       [-3.6, 2.2, 0],
    radiator:   [-3.6, 1.9, 1.9],
    conservator:[-3.6, 4.85, 0],
    buchholz:   [-1.9, 4.1, 0],
    gauge:      [-4.95, 4.85, 0],
    lv_cabinet: [ 3.0, 2.6, -1.6],
    enclosure:  [ 2.4, 3.2, 2.75],
    ground:     [ 6.9, 0.5, 3.3],
    base_x:     [-1.0, 0.4, 3.7]
  }
};

class Viewer3D {
  constructor(container, modelType, unitType, opts) {
    this.container = container;
    this.modelType = modelType;
    this._unitType = unitType || modelType;
    opts = opts || {};
    this.brand = this.modelType === 'transformer' ? (opts.brand || 'taikai') : 'taikai';
    this.label = opts.label || '';          // 机组/设备名称（塔身机号、箱变设备名用）
    this._anchors = (this.modelType === 'transformer' && this.brand === 'dongmeng')
      ? ANCHORS.transformer_dm
      : (ANCHORS[this.modelType] || {});
    this.markers = [];
    this.shellMeshes = [];   // 可透视的外壳网格
    this.onMarkerClick = null;
    this._disposed = false;

    const w = container.clientWidth || 600;
    const h = container.clientHeight || 420;

    this.scene = new THREE.Scene();
    this.scene.background = this._skyTexture();

    this.camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    /* 灯光 */
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const dir = new THREE.DirectionalLight(0xffffff, 0.75);
    dir.position.set(40, 80, 50);
    this.scene.add(dir);
    const dir2 = new THREE.DirectionalLight(0xdde8ff, 0.35);
    dir2.position.set(-40, 30, -40);
    this.scene.add(dir2);

    /* 地面与网格 */
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(90, 48),
      new THREE.MeshLambertMaterial({ color: 0xdbe7d8 })
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(140, 28, 0xb9c9b6, 0xcdd9ca);
    grid.position.y = 0.015;
    grid.material.transparent = true; grid.material.opacity = 0.45;
    this.scene.add(grid);
    // 接地软阴影
    const shadow = new THREE.Mesh(
      new THREE.CircleGeometry(modelType === 'turbine' ? 26 : 12, 32),
      new THREE.MeshBasicMaterial({ color: 0x5c6b5a, transparent: true, opacity: 0.07, depthWrite: false })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    this.scene.add(shadow);

    /* 模型 */
    this.model = modelType === 'turbine'
      ? this._buildTurbine()
      : (this.brand === 'dongmeng' ? this._buildTransformerDm() : this._buildTransformer());
    this.scene.add(this.model);

    /* 相机初始位 */
    const isDm = this.modelType === 'transformer' && this.brand === 'dongmeng';
    this._home = modelType === 'turbine'
      ? { r: 120, cy: 48, theta: 0.62, phi: 1.22 }
      : (isDm ? { r: 18.5, cx: 0.6, cy: 3.1, theta: 2.05, phi: 1.31 }
              : { r: 25.5, cx: 1.0, cy: 3.4, theta: 2.0, phi: 1.29 });
    this._sph = { theta: this._home.theta, phi: this._home.phi, r: this._home.r };
    this._target = new THREE.Vector3(this._home.cx || 0, this._home.cy, 0);

    /* 容器尺寸自适应：布局完成后再量一次，避免画布尺寸滞后导致画面偏小偏移 */
    const fit = () => {
      const cw = container.clientWidth, ch = container.clientHeight;
      if (!cw || !ch) return;
      this.camera.aspect = cw / ch;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(cw, ch);
    };
    requestAnimationFrame(fit);
    setTimeout(fit, 260);
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(fit);
      this._ro.observe(container);
    }

    this._bindEvents();
    this._raycaster = new THREE.Raycaster();
    this._mouse = new THREE.Vector2();
    this._clock = new THREE.Clock();

    /* 默认实体显示，定位内部部件时自动透视 */
    this.setGhost(false);
    this._animate();
  }

  /* 渐变天空背景纹理 */
  _skyTexture() {
    const cv = document.createElement('canvas');
    cv.width = 8; cv.height = 256;
    const ctx = cv.getContext('2d');
    const grd = ctx.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#c3ddf2');
    grd.addColorStop(0.55, '#e4eff8');
    grd.addColorStop(1, '#f2f7f4');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 8, 256);
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  /* ==================== 风机（1.5MW 双馈机型，外观对照 94/97 号机组照片） ==================== */
  _buildTurbine() {
    const g = new THREE.Group();
    const steel = new THREE.MeshPhongMaterial({ color: 0xf2f1ea, shininess: 22 }); // 乳白塔筒
    const steelDark = new THREE.MeshPhongMaterial({ color: 0xc9d3da });
    const innerMat = new THREE.MeshPhongMaterial({ color: 0x8fa3b0 });
    const gearMat = new THREE.MeshPhongMaterial({ color: 0x5b7a94 });
    const genMat = new THREE.MeshPhongMaterial({ color: 0x6b8f71 });

    /* ---- 基础（混凝土承台环，照片中塔底外露圆环） ---- */
    const found = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 5.2, 0.6, 28),
      new THREE.MeshPhongMaterial({ color: 0xd6d2c8 }));
    found.position.y = 0.3; g.add(found);
    // 塔底黑色密封胶带（法兰封边）
    const seal = new THREE.Mesh(new THREE.CylinderGeometry(2.72, 2.78, 0.28, 24),
      new THREE.MeshPhongMaterial({ color: 0x37404a }));
    seal.position.y = 0.55; g.add(seal);

    /* ---- 塔筒（外壳，可透视）——三段式，乳白收锥 ---- */
    const segs = [
      [2.62, 2.28, 20, 10.0],  // [顶r, 底r, 高, 中心y] → 0~20m
      [1.92, 2.28, 20, 30.0],
      [1.55, 1.92, 20, 50.0]
    ];
    segs.forEach(s => {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(s[0], s[1], s[2], 22, 1, true), steel.clone());
      t.position.y = s[3]; g.add(t); this.shellMeshes.push(t);
    });
    // 法兰连接环（两道，+塔顶）
    [[20, 2.3], [40, 1.94]].forEach(p => {
      const fl = new THREE.Mesh(new THREE.TorusGeometry(p[1], 0.12, 8, 24), steelDark);
      fl.rotation.x = Math.PI / 2; fl.position.y = p[0]; g.add(fl);
    });

    /* ---- 塔底外观：单扇门 + 门前台阶（地面→一级→承台面→三级台阶→进门） ---- */
    // 单扇椭圆门（居中、关闭状态，浅钢色），门底在台阶平台面上
    const doorShp = new THREE.Shape();
    doorShp.absellipse(0, 0, 0.56, 0.98, 0, Math.PI * 2);
    const doorGeo = new THREE.ExtrudeGeometry(doorShp, { depth: 0.14, bevelEnabled: false });
    const door = new THREE.Mesh(doorGeo, new THREE.MeshPhongMaterial({ color: 0xd4dadd }));
    door.position.set(0, 2.58, 2.56); g.add(door);
    // 门把手 + 百叶通风口
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.32, 0.06), steelDark);
    handle.position.set(0.22, 2.66, 2.72); g.add(handle);
    [0.3, 0.56, 0.82].forEach(dy => {
      const lv = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.1, 0.06), steelDark);
      lv.position.set(0.18, 2.0 + dy, 2.72); g.add(lv);
    });
    // 门前台阶：3 级实心混凝土踏步，从承台面（y=0.6）升到门口（y=1.6）
    const stepMat = new THREE.MeshPhongMaterial({ color: 0xbfb7a6 });
    for (let i = 0; i < 3; i++) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.3, 0.55), stepMat);
      st.position.set(0, 0.75 + i * 0.3, 4.15 - i * 0.55); g.add(st);
    }
    // 地面级台阶（从地面迈上承台面）
    const groundStep = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.3, 0.55), stepMat);
    groundStep.position.set(0, 0.15, 5.0); g.add(groundStep);
    // 门口平台（与门底平齐，y 顶面 1.6）
    const landing = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 0.85), stepMat);
    landing.position.set(0, 1.55, 2.75); g.add(landing);
    // 台阶两侧斜扶手（从承台面升到门口平台）
    [-0.85, 0.85].forEach(x => {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.8, 8), stepMat);
      rail.position.set(x, 1.17, 3.5);
      rail.rotation.x = -0.49;
      g.add(rail);
    });
    // 红漆机号（照片：塔身喷红漆编号，门顶上方）
    const code = (this.label.match(/[A-Za-z]?\d+/) || ['94'])[0];
    const num = this._textPlane(code, '#c62828', 1.0);
    num.position.set(0, 4.1, 2.62); g.add(num); this._numTag = num;

    /* ---- 塔基内部（对照塔底照片：花纹钢平台/爬梯/提升机/控制柜/电缆/灯管/消防） ---- */
    const floorMat = new THREE.MeshPhongMaterial({ color: 0x9aa3a8 });
    const floor = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.1, 24), floorMat);
    floor.position.y = 0.4; g.add(floor);
    // 电缆孔盖板（圆形暗色盖板）
    const hatch = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 16),
      new THREE.MeshPhongMaterial({ color: 0x6b7680 }));
    hatch.position.set(0.5, 0.47, 0.6); g.add(hatch);

    // 爬梯（双立柱 + 踏步 + 防坠导轨，贴后壁直通塔顶）
    const railMat = new THREE.MeshPhongMaterial({ color: 0x7f8c96 });
    [-0.26, 0.26].forEach(dx => {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 57, 0.07), railMat);
      rail.position.set(1.15 + dx, 29, -1.35); g.add(rail);
    });
    for (let y = 0.6; y < 57; y += 0.55) {
      const rung = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.05), railMat);
      rung.position.set(1.15, y, -1.35); g.add(rung);
    }
    // 防坠导轨（中间亮色竖轨）
    const fall = new THREE.Mesh(new THREE.BoxGeometry(0.09, 56, 0.09),
      new THREE.MeshPhongMaterial({ color: 0xc8b26a }));
    fall.position.set(1.15, 29, -1.28); g.add(fall);

    // 助爬提升机（黄色绞车 + 黑色控制盒，照片特征件）
    const hoist = new THREE.Group();
    const hb = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.38),
      new THREE.MeshPhongMaterial({ color: 0xe6a817 }));
    hoist.add(hb);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.42, 12),
      new THREE.MeshPhongMaterial({ color: 0xd8d2c4 }));
    drum.rotation.x = Math.PI / 2; drum.position.y = 0.1; hoist.add(drum);
    const ctrl = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.22),
      new THREE.MeshPhongMaterial({ color: 0x2f3a44 }));
    ctrl.position.y = -0.4; hoist.add(ctrl);
    hoist.position.set(1.15, 1.35, -1.0); g.add(hoist);

    // 塔底控制柜（左，白色高柜 + 按钮面板 + 显示窗）
    const cabMat = new THREE.MeshPhongMaterial({ color: 0xeceff1 });
    const cab1 = new THREE.Mesh(new THREE.BoxGeometry(0.95, 2.1, 0.55), cabMat);
    cab1.position.set(-1.25, 1.5, -1.45); g.add(cab1);
    const cab1Panel = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.45, 0.06),
      new THREE.MeshPhongMaterial({ color: 0x37474f }));
    cab1Panel.position.set(-1.25, 1.95, -1.14); g.add(cab1Panel);
    // 控制柜 2（右前，带急停红色蘑菇按钮）
    const cab2 = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.85, 0.55), cabMat);
    cab2.position.set(1.0, 1.4, -1.5); g.add(cab2);
    const cab2Panel = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.5, 0.06),
      new THREE.MeshPhongMaterial({ color: 0xdde3e6 }));
    cab2Panel.position.set(1.0, 1.75, -1.19); g.add(cab2Panel);
    const estop = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.1, 10),
      new THREE.MeshPhongMaterial({ color: 0xd32f2f }));
    estop.position.set(0.75, 1.7, -1.15); g.add(estop);

    // 上塔动力电缆（黑色成束，沿塔壁爬升到塔顶，顶部收向偏航中心 + 底部白色缓冲弯）
    const cabBlack = new THREE.MeshPhongMaterial({ color: 0x26313a });
    // 塔筒各段半径（与上面的三段锥体一致）
    const towerR = y => y <= 20
      ? 2.62 - (y / 20) * 0.34
      : (y <= 40 ? 2.28 - ((y - 20) / 20) * 0.36 : 1.92 - ((y - 40) / 20) * 0.37);
    const dirR = new THREE.Vector3(-0.30, 0, -0.954).normalize();  // 电缆束所在方位（-z 壁侧）
    const dirT = new THREE.Vector3(0.954, 0, -0.30).normalize();   // 切向（并排间距方向）
    const cabHeights = [2.0, 10, 20, 30, 40, 48, 54, 57.2, 59.2];
    for (let i = 0; i < 4; i++) {
      const spread = (i - 1.5) * 0.17;
      const pts = cabHeights.map(h => {
        // 57m 以上略微向内收，贴塔壁爬到塔顶即止（不接机舱）
        const shrink = h > 54 ? 0.92 - (h - 54) * 0.05 : 0.92;
        const rad = towerR(h) * shrink;
        const p = dirR.clone().multiplyScalar(rad)
          .add(dirT.clone().multiplyScalar(spread));
        p.y = h;
        return p;
      });
      const curve = new THREE.CatmullRomCurve3(pts);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 60, 0.078, 6, false), cabBlack);
      g.add(tube);
    }
    const bendMat = new THREE.MeshPhongMaterial({ color: 0xe8e6df });
    for (let i = 0; i < 3; i++) {
      const bend = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.085, 8, 14, Math.PI), bendMat);
      bend.position.set(-0.5 + i * 0.22, 1.6, -1.62);
      bend.rotation.set(0, Math.PI / 2, 0);
      g.add(bend);
    }

    // 塔内 LED 灯管（基段一支亮灯 + 上部三支，发光便于识别）
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xf5fbff });
    const baseLamp = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.15, 0.12), lampMat);
    baseLamp.position.set(0.6, 2.7, 1.9); baseLamp.rotation.z = 0.06; g.add(baseLamp);
    [13, 28, 43].forEach((y, i) => {
      const r = 2.5 - i * 0.33;
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.24, 1.3, 0.12), lampMat);
      lamp.position.set(-r + 0.35, y, r - 0.5); lamp.rotation.y = -0.7; g.add(lamp);
    });

    // 消防器材（三个红色灭火器箱 + 黄盖桶，沿左壁摆放）
    const fireMat = new THREE.MeshPhongMaterial({ color: 0xc63434 });
    [[-1.7, 1.0], [-1.25, 1.6], [-1.95, 0.35]].forEach(p => {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.5, 0.34), fireMat);
      box.position.set(p[0], 0.65, p[1]); g.add(box);
      const ext = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.42, 8),
        new THREE.MeshPhongMaterial({ color: 0xd84343 }));
      ext.position.set(p[0], 0.98, p[1]); g.add(ext);
    });
    const drumY = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.55, 14),
      new THREE.MeshPhongMaterial({ color: 0x546e7a }));
    drumY.position.set(1.75, 0.68, 1.15); g.add(drumY);
    const lidY = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 14),
      new THREE.MeshPhongMaterial({ color: 0xe6a817 }));
    lidY.position.set(1.75, 0.99, 1.15); g.add(lidY);

    // 安全标识牌（墙面白色告示牌 ×2）
    const signMat = new THREE.MeshBasicMaterial({ color: 0xf2f4f6 });
    [[-2.0, 2.3, 0.4], [1.9, 2.2, -1.3]].forEach(p => {
      const sg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.7, 0.04), signMat);
      const ang = Math.atan2(p[2], p[0]);
      sg.position.set(p[0], p[1], p[2]);
      sg.rotation.y = ang + Math.PI / 2;
      g.add(sg);
    });

    /* ---- 塔筒上部平台 ×3 ---- */
    [[15, 1.95], [30, 1.62], [45, 1.42]].forEach(p => {
      const pf = new THREE.Mesh(new THREE.CylinderGeometry(p[1], p[1], 0.16, 18),
        new THREE.MeshPhongMaterial({ color: 0xa8b6c0 }));
      pf.position.y = p[0]; g.add(pf);
    });

    /* ---- 偏航（塔顶齿圈 + 电机） ---- */
    const yawRing = new THREE.Mesh(new THREE.TorusGeometry(1.35, 0.26, 10, 24),
      new THREE.MeshPhongMaterial({ color: 0xc9a86a }));
    yawRing.rotation.x = Math.PI / 2; yawRing.position.y = 59.4; g.add(yawRing);
    for (let i = 0; i < 3; i++) {
      const ym = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.9, 10), innerMat);
      const a = i * Math.PI * 2 / 3;
      ym.position.set(Math.cos(a) * 1.15, 59.6, Math.sin(a) * 1.15); g.add(ym);
    }

    /* ---- 机舱外壳（可透视） ---- */
    const nac = new THREE.Mesh(new THREE.BoxGeometry(10.5, 4.4, 4.4), steel.clone());
    nac.position.set(1, 62.5, 0); g.add(nac); this.shellMeshes.push(nac);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3.2, 3.2), steelDark);
    tail.position.set(-4.6, 62.5, 0); g.add(tail);
    const avLight = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xff1744 }));
    avLight.position.set(-4.8, 65.2, 0); g.add(avLight);

    /* ---- 机舱内部传动链（前 → 后） ---- */
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 3.6, 14), innerMat);
    shaft.rotation.z = Math.PI / 2; shaft.position.set(5.6, 62.2, 0); g.add(shaft);
    const bearing = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 1.1, 14), gearMat);
    bearing.rotation.z = Math.PI / 2; bearing.position.set(4.6, 62.2, 0); g.add(bearing);
    const gb = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.6, 16), gearMat);
    gb.rotation.z = Math.PI / 2; gb.position.set(2.6, 62.2, 0); g.add(gb);
    const gbBox = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.5, 2.1), gearMat);
    gbBox.position.set(2.6, 61.15, 0); g.add(gbBox);
    const cpl = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.9, 12), innerMat);
    cpl.rotation.z = Math.PI / 2; cpl.position.set(0.9, 62.2, 0); g.add(cpl);
    const brake = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.75, 0.22, 16),
      new THREE.MeshPhongMaterial({ color: 0xb3534a }));
    brake.rotation.z = Math.PI / 2; brake.position.set(0.35, 62.2, 0); g.add(brake);
    const gen = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 2.6, 16), genMat);
    gen.rotation.z = Math.PI / 2; gen.position.set(-1.8, 62.2, 0); g.add(gen);
    const genFin = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.5, 1.6), genMat);
    genFin.position.set(-1.8, 63.5, 0); g.add(genFin);
    const hyd = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.0, 0.9),
      new THREE.MeshPhongMaterial({ color: 0x7e6b9e }));
    hyd.position.set(0.2, 60.4, 1.5); g.add(hyd);
    const cabN = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.7, 1.2),
      new THREE.MeshPhongMaterial({ color: 0x546e7a }));
    cabN.position.set(2.2, 60.6, -1.6); g.add(cabN);
    /* ---- 发电机旁三联柜（并排平行布置，最后一台最靠机舱尾部） ---- */
    const cabBodyMat = new THREE.MeshPhongMaterial({ color: 0x55626c });
    const cabDoorMat = new THREE.MeshPhongMaterial({ color: 0x64727c });
    const cabEdgeMat = new THREE.MeshPhongMaterial({ color: 0x3f4a52 });
    const cabSteelMat = new THREE.MeshPhongMaterial({ color: 0xc2cbd2 });
    const cabBaseY = 60.3;                        // 机舱底板标高
    const cabZ = -1.62, cabH = 1.38, cabW = 0.86, cabD = 0.62;
    const cabXs = [-0.78, -1.74, -2.7];           // 三台并排，-2.7 最靠尾部
    cabXs.forEach((cx, i) => {
      // 柜体
      const body = new THREE.Mesh(new THREE.BoxGeometry(cabW, cabH, cabD), cabBodyMat);
      body.position.set(cx, cabBaseY + cabH / 2, cabZ); g.add(body);
      // 柜门（面向走道 +z）
      const dr = new THREE.Mesh(new THREE.BoxGeometry(cabW - 0.08, cabH - 0.12, 0.04), cabDoorMat);
      dr.position.set(cx, cabBaseY + cabH / 2, cabZ + cabD / 2 + 0.02); g.add(dr);
      // 门缝压条 + 把手
      const seam = new THREE.Mesh(new THREE.BoxGeometry(0.04, cabH - 0.14, 0.02), cabEdgeMat);
      seam.position.set(cx - 0.2, cabBaseY + cabH / 2, cabZ + cabD / 2 + 0.045); g.add(seam);
      const hd = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.05), cabSteelMat);
      hd.position.set(cx + 0.3, cabBaseY + 0.62, cabZ + cabD / 2 + 0.06); g.add(hd);
      // 门上部通风栅（三条）
      for (let k = 0; k < 3; k++) {
        const gr = new THREE.Mesh(new THREE.BoxGeometry(cabW - 0.16, 0.05, 0.03), cabEdgeMat);
        gr.position.set(cx, cabBaseY + cabH - 0.16 - k * 0.1, cabZ + cabD / 2 + 0.045); g.add(gr);
      }
      // 运行指示灯（尾部柜为红色告警灯，其余绿色）
      const lampMat = new THREE.MeshBasicMaterial({ color: i === 2 ? 0xef5350 : 0x66bb6a });
      const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.05, 10), lampMat);
      lamp.position.set(cx - 0.3, cabBaseY + 1.05, cabZ + cabD / 2 + 0.05); g.add(lamp);
      // 柜底槽钢基座
      const plinth = new THREE.Mesh(new THREE.BoxGeometry(cabW + 0.04, 0.1, cabD + 0.04), cabEdgeMat);
      plinth.position.set(cx, cabBaseY + 0.05, cabZ); g.add(plinth);
    });
    // 三联柜顶部走线槽（汇到尾部柜）
    const tray = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.08, 0.26),
      new THREE.MeshPhongMaterial({ color: 0x9aa7b0 }));
    tray.position.set(-1.74, cabBaseY + cabH + 0.05, cabZ); g.add(tray);

    /* ---- 尾部柜下引电缆：只留穿底板的一小段（不做长距离垂吊） ---- */
    const cableMat = new THREE.MeshPhongMaterial({ color: 0x171a1d, shininess: 40 });
    [-0.15, 0.05].forEach(dz => {
      const gland = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.1, 10), cableMat);
      gland.position.set(cabXs[2] + dz, cabBaseY - 0.02, cabZ + 0.12 + dz);
      g.add(gland);
    });

    const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.7, 14), innerMat);
    fan.position.set(-2.4, 65.4, 0); g.add(fan);
    const fanGrid = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.85, 0.1, 14), steelDark);
    fanGrid.position.set(-2.4, 65.8, 0); g.add(fanGrid);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 8), innerMat);
    mast.position.set(3.2, 65.6, 0); g.add(mast);
    const vane = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.12, 0.12),
      new THREE.MeshBasicMaterial({ color: 0xef5350 }));
    vane.position.set(3.2, 66.4, 0); g.add(vane);

    /* ---- 超声波风速仪（机舱顶部尾端，竖直安装：立柱 + 三臂 + 上下对射换能器） ---- */
    const usG = new THREE.Group();
    usG.position.set(-3.7, 64.62, 0);
    usG.scale.setScalar(1.25);
    g.add(usG);
    const usDark = new THREE.MeshPhongMaterial({ color: 0x2f3a41 });
    const usArm = new THREE.MeshPhongMaterial({ color: 0x3f4d55 });
    // 底座（法兰盘 + 短柱）
    const usFlange = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.32, 0.1, 14), usDark);
    usFlange.position.y = 0.05; usG.add(usFlange);
    const usBase = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, 0.55, 12), usDark);
    usBase.position.y = 0.38; usG.add(usBase);
    const usBody = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.55, 12), usArm);
    usBody.position.y = 0.92; usG.add(usBody);
    // 上环（三臂安装盘）
    const usTopRing = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.08, 14), usDark);
    usTopRing.position.y = 1.24; usG.add(usTopRing);
    // 三臂 + 上下对射换能器
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI * 2 / 3 + 0.5;
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.05, 0.08), usArm);
      arm.position.set(Math.cos(a) * 0.31, 1.26, Math.sin(a) * 0.31);
      arm.rotation.y = -a; usG.add(arm);
      [-1, 1].forEach(s2 => {
        const px = Math.cos(a) * (0.31 + s2 * 0.27), pz = Math.sin(a) * (0.31 + s2 * 0.27);
        const probe = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.16, 10),
          new THREE.MeshPhongMaterial({ color: 0x1f272c }));
        probe.position.set(px, 1.17, pz); usG.add(probe);
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6),
          new THREE.MeshBasicMaterial({ color: 0x90a4ae }));
        tip.position.set(px, 1.09, pz); usG.add(tip);
      });
    }
    const usCap = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.1, 10), usDark);
    usCap.position.y = 1.36; usG.add(usCap);

    /* ---- 风轮（轮毂 + 导流罩 + 三叶片，可慢转） ---- */
    this.rotor = new THREE.Group();
    this.rotor.position.set(7.8, 62.5, 0);
    const hub = new THREE.Mesh(new THREE.SphereGeometry(1.8, 18, 14), steelDark);
    this.rotor.add(hub);
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(1.8, 2.6, 18), steel.clone());
    spinner.rotation.z = -Math.PI / 2; spinner.position.x = 1.6;
    this.rotor.add(spinner); this.shellMeshes.push(spinner);

    const bladeMat = new THREE.MeshPhongMaterial({ color: 0xf7fafc });
    const redMat = new THREE.MeshBasicMaterial({ color: 0xd84343 });
    for (let i = 0; i < 3; i++) {
      const pivot = new THREE.Group();
      const root = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.92, 3, 12), bladeMat);
      root.position.y = 1.5; pivot.add(root);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(1.0, 24, 3.8), bladeMat);
      blade.position.y = 15; pivot.add(blade);
      const tip = new THREE.Mesh(new THREE.BoxGeometry(0.55, 8, 2.2), bladeMat);
      tip.position.y = 31; pivot.add(tip);
      [27.6, 30.2, 32.8].forEach(y => {
        const band = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.9, 2.3), redMat);
        band.position.y = y; pivot.add(band);
      });
      pivot.rotation.x = i * (Math.PI * 2 / 3) + 0.35;
      this.rotor.add(pivot);
    }
    g.add(this.rotor);

    return g;
  }

  /* 纯文字纹理平面（canvas 宽度自适应文字，避免截断/变形；支持 \n 多行）
   * 返回 Mesh，平面宽高比与纹理一致，h 为世界高度 */
  _textPlane(text, color, h) {
    const cv = document.createElement('canvas');
    const ctx0 = cv.getContext('2d');
    const lines = String(text).split('\n');
    const fs = lines.length > 1 ? 64 : 110;
    ctx0.font = `700 ${fs}px "Microsoft YaHei", sans-serif`;
    const maxW = Math.max(...lines.map(l => ctx0.measureText(l).width || 1));
    cv.width = Math.ceil(maxW) + 40;
    cv.height = lines.length > 1 ? lines.length * fs + 40 : 160;
    const ctx = cv.getContext('2d');
    ctx.font = `700 ${fs}px "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    lines.forEach((ln, i) => {
      const y = lines.length > 1 ? 20 + fs * (i + 0.5) : cv.height / 2;
      ctx.fillText(ln, cv.width / 2, y);
    });
    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    return new THREE.Mesh(
      new THREE.PlaneGeometry(h * cv.width / cv.height, h),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true })
    );
  }

  /* 旧接口保留（内部转调 _textPlane，仅返回纹理的调用已全部替换） */

  /* 气体继电器（瓦斯保护）本体：壳体 + 上下法兰 + 双视察窗 + 接线盒 + 出线电缆
   * 局部坐标原点在壳体中心；scale=1 时整体高约 0.5m */
  _gasRelayBody(scale) {
    const g = new THREE.Group();
    const dark = new THREE.MeshPhongMaterial({ color: 0x39444c });
    const steel = new THREE.MeshPhongMaterial({ color: 0x9aa8b2 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.4, 0.28), dark);
    g.add(body);
    // 上下连接法兰
    [0.225, -0.225].forEach(dy => {
      const fl = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.34), steel);
      fl.position.y = dy; g.add(fl);
    });
    // 前表面双视察窗（玻璃 + 红色浮子挡板 + 窗框）
    [-0.085, 0.085].forEach(dx => {
      const win = new THREE.Mesh(new THREE.CircleGeometry(0.058, 16),
        new THREE.MeshPhongMaterial({ color: 0xcfe0e8, transparent: true, opacity: 0.72 }));
      win.position.set(dx, 0.07, 0.142); g.add(win);
      const flt = new THREE.Mesh(new THREE.CircleGeometry(0.028, 12),
        new THREE.MeshBasicMaterial({ color: 0xc62828 }));
      flt.position.set(dx, 0.06, 0.146); g.add(flt);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.062, 0.008, 6, 16), steel);
      ring.position.set(dx, 0.07, 0.145); g.add(ring);
    });
    // 底部放油小阀
    const drain = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.032, 0.1, 8), steel);
    drain.position.set(0.07, -0.29, 0.09); g.add(drain);
    // 侧挂接线盒 + 两个电缆密封接头 + 下垂出线
    const jb = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.17, 0.13), dark);
    jb.position.set(0.245, 0.03, 0); g.add(jb);
    [-0.04, 0.04].forEach(dz => {
      const gl = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.07, 8), steel);
      gl.position.set(0.245, -0.1, dz); g.add(gl);
    });
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 6),
      new THREE.MeshPhongMaterial({ color: 0x21282d }));
    cable.position.set(0.245, -0.42, 0); g.add(cable);
    if (scale && scale !== 1) g.scale.setScalar(scale);
    return g;
  }

  /* 呼吸器（硅胶罐）：顶部接管进、玻璃罩内蓝色硅胶、底部油杯；原点=顶部接管处，向下延伸 */
  _breatherBody(scale) {
    const g = new THREE.Group();
    const dark = new THREE.MeshPhongMaterial({ color: 0x3c4750 });
    const glass = new THREE.MeshPhongMaterial({ color: 0xcfe3ec, transparent: true, opacity: 0.5 });
    const silica = new THREE.MeshPhongMaterial({ color: 0x2e6bd0 });
    const bolt = new THREE.MeshPhongMaterial({ color: 0x8fa0ab });
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.09, 14), dark);
    top.position.y = -0.045; g.add(top);
    const topBolt = new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.018, 6, 16), bolt);
    topBolt.rotation.x = Math.PI / 2; topBolt.position.y = -0.09; g.add(topBolt);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.125, 0.36, 14), glass);
    cup.position.y = -0.27; g.add(cup);
    const gel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.28, 14), silica);
    gel.position.y = -0.27; g.add(gel);
    const bot = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.155, 0.06, 14), dark);
    bot.position.y = -0.48; g.add(bot);
    const oilcup = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.065, 0.09, 12),
      new THREE.MeshPhongMaterial({ color: 0xe8f2e9, transparent: true, opacity: 0.65 }));
    oilcup.position.y = -0.55; g.add(oilcup);
    if (scale && scale !== 1) g.scale.setScalar(scale);
    return g;
  }

  /* ==================== 箱变（泰开 TAIKAI 预装变电站，对照 94 号箱变实拍） ====================
   * 布局：右半为配电室箱体（正面左=低压室双开大门、右=高压室小门）；
   *       左半为外露变压器区（油箱+散热片+油枕+套管），蓝色网格围栏独立围挡；
   *       右端面百叶通风门；低压室内表计板/框架断路器/按钮排/红色电抗器。
   * ============================================================ */
  _buildTransformer() {
    const g = new THREE.Group();
    const blue = 0x4a8fc4;                       // 正泰蓝（箱体）
    const blueDoor = 0x3f83b5;                   // 门板蓝（稍深）
    const shellMat = () => new THREE.MeshPhongMaterial({ color: blue });
    const doorMat = new THREE.MeshPhongMaterial({ color: blueDoor });
    const trimMat = new THREE.MeshPhongMaterial({ color: 0x35709d });  // 立柱/边框深蓝
    const roofMat = new THREE.MeshPhongMaterial({ color: 0x9fb2bc });  // 灰蓝屋顶
    const tankMat = new THREE.MeshPhongMaterial({ color: 0x3d6f96 });  // 油箱深蓝
    const fenceMat = new THREE.MeshPhongMaterial({ color: 0x3a7fb4 }); // 围栏框架蓝
    const cabMat = new THREE.MeshPhongMaterial({ color: 0xe8e9e4 });   // 室内柜体米白

    /* ---- 混凝土基座 + 散水台（照片：箱体坐在高出地面的混凝土台上） ---- */
    const apron = new THREE.Mesh(new THREE.BoxGeometry(18.6, 0.24, 9.0),
      new THREE.MeshPhongMaterial({ color: 0xb7b3a8 }));
    apron.position.set(0.6, 0.12, 0); g.add(apron);
    const base = new THREE.Mesh(new THREE.BoxGeometry(17.2, 0.5, 7.6),
      new THREE.MeshPhongMaterial({ color: 0xc9c5ba }));
    base.position.set(0.6, 0.37, 0); g.add(base);

    /* ==================== 配电室箱体（右半，x∈[-1,9]） ==================== */
    const H = 5.4, W = 10, D = 6, T = 0.16, y0 = 0.62, X0 = -1; // X0 = 箱体左壁
    const xc = X0 + W / 2; // 箱体中心 x=4
    const mkWall = (w, h, d, x, y, z, mat) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat || shellMat());
      m.position.set(x, y, z); g.add(m); this.shellMeshes.push(m); return m;
    };
    mkWall(W, H, T, xc, y0 + H / 2, D / 2);          // 前壁
    mkWall(W, H, T, xc, y0 + H / 2, -D / 2);         // 后壁
    mkWall(T, H, D, X0, y0 + H / 2, 0);              // 左壁（面向变压器区）
    mkWall(T, H, D, X0 + W, y0 + H / 2, 0);          // 右壁
    // 屋顶挑檐（照片：灰色大挑檐，前沿略下垂）
    const roof = mkWall(W + 1.0, 0.3, D + 1.0, xc, y0 + H + 0.15, 0, roofMat);
    const eave = new THREE.Mesh(new THREE.BoxGeometry(W + 1.0, 0.34, 0.12), roofMat);
    eave.position.set(xc, y0 + H - 0.02, D / 2 + 0.5); g.add(eave);
    // 檐口 "泰开 TAIKAI" 白字（照片特征，檐口正中偏左）
    const chnt = this._textPlane('泰开 TAIKAI', '#ffffff', 0.42);
    chnt.position.set(xc - 0.6, y0 + H - 0.02, D / 2 + 0.57); g.add(chnt);

    /* ---- 正面（+z）：低压室双开大门（左） + 高压室小门（右） ---- */
    const doorH = 4.25, doorY = y0 + doorH / 2 + 0.05, fz = D / 2 + 0.12;
    const TZ = D / 2 + 0.27;                 // 门面贴字所在 z（高于门板外表面，避免 z-fighting）
    // 低压室双开大门（照片上带"止步 高压危险" + 机号 94）
    [-0.85, 0.85].forEach(dx => {
      const dp = new THREE.Mesh(new THREE.BoxGeometry(1.66, doorH, 0.1), doorMat);
      dp.position.set(1.4 + dx, doorY, fz); g.add(dp);
      // 银色长把手（门中缝侧）
      const hd = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1),
        new THREE.MeshPhongMaterial({ color: 0xd8dde2 }));
      hd.position.set(1.4 + dx * 0.12, doorY + 0.1, fz + 0.1); g.add(hd);
    });
    // 门中缝立柱 + 门框横梁
    const colMid = new THREE.Mesh(new THREE.BoxGeometry(0.12, doorH, 0.14), trimMat);
    colMid.position.set(1.4, doorY, fz); g.add(colMid);
    // 机号（左大门右扇，白色；取自设备名称中的编号）
    const tcode = (this.label.match(/[A-Za-z]?\d+/) || ['94'])[0];
    const num94 = this._textPlane(tcode, '#eef4f8', 0.72);
    num94.position.set(2.25, doorY + 0.7, TZ); g.add(num94); this._numTag = num94;
    // 设备名称（门顶上方白字，如"F02 箱变"）
    const nameTag = this._textPlane(this.label || '泰开箱变', '#ffffff', 0.52);
    nameTag.position.set(4.9, y0 + H - 0.42, D / 2 + 0.22); g.add(nameTag);
    // "止步 高压危险"（左大门左扇，两行白字）
    const warn = this._textPlane('止步\n高压危险', '#dfe9f0', 0.95);
    warn.position.set(0.55, doorY + 0.55, TZ); g.add(warn);
    // 安全标识牌（照片：左门旁白底组合警示图标牌）
    const signBd = new THREE.Mesh(new THREE.BoxGeometry(1.05, 1.35, 0.05),
      new THREE.MeshPhongMaterial({ color: 0xf2f4f5 }));
    signBd.position.set(-0.45, doorY + 0.6, TZ - 0.03); g.add(signBd);
    const signDots = [0xe53935, 0x1e88e5, 0xf9a825, 0xe53935, 0x1e88e5, 0xf9a825];
    signDots.forEach((c, i) => {
      const dot = new THREE.Mesh(new THREE.CircleGeometry(0.13, 12),
        new THREE.MeshBasicMaterial({ color: c }));
      dot.position.set(-0.72 + (i % 2) * 0.55, doorY + 0.95 - Math.floor(i / 2) * 0.42, TZ + 0.01);
      g.add(dot);
    });
    // 高压室小门（右，带把手）
    const dHV = new THREE.Mesh(new THREE.BoxGeometry(1.7, doorH, 0.1), doorMat);
    dHV.position.set(6.9, doorY, fz); g.add(dHV);
    const dHVh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1),
      new THREE.MeshPhongMaterial({ color: 0xd8dde2 }));
    dHVh.position.set(6.25, doorY + 0.1, fz + 0.1); g.add(dHVh);
    // 正面分隔立柱（三室分界，照片门两侧深蓝立柱）
    [3.2, 5.9, 7.85].forEach(x => {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.22, H, 0.24), trimMat);
      col.position.set(x, y0 + H / 2, D / 2 + 0.14); g.add(col);
    });
    // 门顶横梁
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(W, 0.28, 0.2), trimMat);
    lintel.position.set(xc, y0 + doorH + 0.25, D / 2 + 0.13); g.add(lintel);

    /* ---- 背面（-z）：双开大门（照片图4，检修门） ---- */
    [-0.8, 0.8].forEach(dx => {
      const dp = new THREE.Mesh(new THREE.BoxGeometry(1.56, doorH, 0.1), doorMat);
      dp.position.set(3.4 + dx, doorY, -D / 2 - 0.12); g.add(dp);
    });
    const dBh = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.5, 0.1),
      new THREE.MeshPhongMaterial({ color: 0xd8dde2 }));
    dBh.position.set(3.4, doorY + 0.1, -D / 2 - 0.22); g.add(dBh);

    /* ---- 右端面（+x）：百叶通风门（照片图3右侧） ---- */
    const dLou = new THREE.Mesh(new THREE.BoxGeometry(0.1, 3.9, 2.3), doorMat);
    dLou.position.set(X0 + W + 0.12, y0 + 2.05, 0); g.add(dLou);
    for (let i = 0; i < 6; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 1.9), trimMat);
      slat.position.set(X0 + W + 0.2, y0 + 0.75 + i * 0.55, 0);
      slat.rotation.z = 0.42; // 百叶斜片
      g.add(slat);
    }

    /* ==================== 变压器区（左半外露，蓝色网格围栏） ==================== */
    /* ---- 变压器油箱本体 ---- */
    const tank = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.2, 3.0), tankMat);
    tank.position.set(-2.9, y0 + 1.6, 0); g.add(tank);
    // 油箱盖（略大一圈）
    const lid = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.18, 3.2), trimMat);
    lid.position.set(-2.9, y0 + 3.3, 0); g.add(lid);

    /* ---- 散热片组（油箱背面 -z 侧，照片图4/5：竖直散热片阵） ---- */
    const finMat = new THREE.MeshPhongMaterial({ color: 0x41779f });
    for (let i = 0; i < 12; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.13, 2.5, 0.55), finMat);
      fin.position.set(-4.25 + i * 0.245, y0 + 1.75, -1.85); g.add(fin);
    }
    // 上下集油管
    [y0 + 0.55, y0 + 2.95].forEach(y => {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 3.1, 8), finMat);
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(-2.9, y, -1.85); g.add(pipe);
    });

    /* ---- 油枕（横置圆筒，架在油箱上方，照片最显眼的特征件） ---- */
    const consY = y0 + 4.56, consZ = -0.35;
    const cons = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 3.1, 18), tankMat);
    cons.rotation.z = Math.PI / 2;
    cons.position.set(-2.9, consY, consZ); g.add(cons);
    // 两端法兰端盖（螺栓圈）
    [-1.62, 1.62].forEach(dx => {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.12, 18), trimMat);
      cap.rotation.z = Math.PI / 2;
      cap.position.set(-2.9 + dx, consY, consZ); g.add(cap);
    });
    // 油枕支架（A 形斜撑 ×2，撑在油箱盖上）
    [-1.1, 1.1].forEach(dx => {
      const br = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.56, 0.16), trimMat);
      br.position.set(-2.9 + dx, y0 + 3.67, consZ); g.add(br);
    });
    // 油位计（照片图7：油枕端面竖直玻璃管，上下红色浮球刻度）
    const gTube = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.95, 8),
      new THREE.MeshPhongMaterial({ color: 0xdfe9ee, transparent: true, opacity: 0.85 }));
    gTube.position.set(-4.65, consY, consZ); g.add(gTube);
    const gFloat = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.22, 8),
      new THREE.MeshPhongMaterial({ color: 0xc62828 }));
    gFloat.position.set(-4.65, consY + 0.1, consZ); g.add(gFloat);
    // 油位计连接弯管（端盖→玻璃管）
    const gPipe = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.35, 6), trimMat);
    gPipe.rotation.z = Math.PI / 2;
    gPipe.position.set(-4.55, consY + 0.42, consZ); g.add(gPipe);
    // 呼吸器（照片：油枕端部立管上翻 180° 弯头，呼吸器倒挂末端）
    const brX = -1.5, brTopY = consY + 1.37;
    const brPipeMat = new THREE.MeshPhongMaterial({ color: 0x4a5862 });
    const brRiser = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.82, 10), brPipeMat);
    brRiser.position.set(brX, consY + 0.96, consZ); g.add(brRiser);
    const brArc = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.045, 8, 18, Math.PI), brPipeMat);
    brArc.position.set(brX - 0.28, brTopY, consZ); g.add(brArc);
    const brDrop = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 10), brPipeMat);
    brDrop.position.set(brX - 0.56, brTopY - 0.07, consZ); g.add(brDrop);
    const breather = this._breatherBody(1.0);
    breather.position.set(brX - 0.56, brTopY - 0.13, consZ); g.add(breather);

    /* ---- 瓦斯保护（气体继电器）：油箱顶、油枕前下方的连接管上 ---- */
    const grX = -2.9, grY = y0 + 3.66, grZ = 0.62;
    const gasRelay = this._gasRelayBody(1.0);
    gasRelay.position.set(grX, grY, grZ); g.add(gasRelay);
    const grPipeMat = new THREE.MeshPhongMaterial({ color: 0x4a5862 });
    // 下短管（油箱盖 → 继电器下法兰）
    const grLow = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.13, 10), grPipeMat);
    grLow.position.set(grX, y0 + 3.42, grZ); g.add(grLow);
    // 上立管（继电器上法兰 → 油枕前下方）+ 阀门 + 手轮
    const grUp = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.42, 10), grPipeMat);
    grUp.position.set(grX, y0 + 4.1, grZ); g.add(grUp);
    const grElbow = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.3, 10), grPipeMat);
    grElbow.rotation.x = Math.PI / 2;
    grElbow.position.set(grX, y0 + 4.3, grZ - 0.16); g.add(grElbow);
    const grValve = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.08, 12), trimMat);
    grValve.position.set(grX, y0 + 3.98, grZ); g.add(grValve);
    const grWheel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.05),
      new THREE.MeshPhongMaterial({ color: 0xc62828 }));
    grWheel.position.set(grX, y0 + 4.04, grZ); g.add(grWheel);
    // 安装角钢（撑在油箱盖上）
    const grSeat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.4), trimMat);
    grSeat.position.set(grX, y0 + 3.42, grZ); g.add(grSeat);

    /* ---- 蓝色网格围栏（照片图1/6/7：两横杆网格围挡，高约 2.2m） ---- */
    const F = { x0: -7.3, x1: -1.08, z0: -3.08, z1: 3.08, y0: 0.62, h: 2.35 };
    const meshTex = this._fenceTexture();
    const mkNet = (w, h, x, y, z, ry) => {
      const net = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: meshTex, transparent: true, side: THREE.DoubleSide, opacity: 0.92 }));
      net.position.set(x, y, z); net.rotation.y = ry; g.add(net);
    };
    const fenceY = F.y0 + F.h / 2;
    mkNet(F.x1 - F.x0, F.h, (F.x0 + F.x1) / 2, fenceY, F.z1, 0);           // 前网
    mkNet(F.x1 - F.x0, F.h, (F.x0 + F.x1) / 2, fenceY, F.z0, 0);           // 后网
    mkNet(F.z1 - F.z0, F.h, F.x0, fenceY, 0, Math.PI / 2);                 // 左端网
    // 围栏框架：四角立柱 + 上下横杆 + 中立柱
    const post = (x, z) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.09, F.h + 0.08, 0.09), fenceMat);
      p.position.set(x, fenceY, z); g.add(p);
    };
    [F.x0, F.x1].forEach(x => [F.z0, F.z1].forEach(z => post(x, z)));
    [-4.2].forEach(x => { post(x, F.z0); post(x, F.z1); });               // 前后中柱
    post(F.x0, 0);                                                         // 左端中柱
    [F.y0 + 0.04, F.y0 + F.h - 0.04, F.y0 + F.h / 2].forEach(y => {        // 上/下/中横杆
      const mkBar = (len, x, z, ry) => {
        const b = new THREE.Mesh(new THREE.BoxGeometry(len, 0.07, 0.07), fenceMat);
        b.position.set(x, y, z); b.rotation.y = ry; g.add(b);
      };
      mkBar(F.x1 - F.x0, (F.x0 + F.x1) / 2, F.z1, 0);
      mkBar(F.x1 - F.x0, (F.x0 + F.x1) / 2, F.z0, 0);
      mkBar(F.z1 - F.z0, F.x0, 0, Math.PI / 2);
    });
    // 围栏门（正面右扇，带门闩，与网片同材稍深）
    const fDoor = new THREE.Mesh(new THREE.PlaneGeometry(1.5, F.h - 0.1),
      new THREE.MeshBasicMaterial({ map: meshTex, transparent: true, side: THREE.DoubleSide, opacity: 0.95 }));
    fDoor.position.set(-1.85, fenceY, F.z1 + 0.02); g.add(fDoor);
    const fLatch = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.06), trimMat);
    fLatch.position.set(-2.5, fenceY + 0.15, F.z1 + 0.06); g.add(fLatch);

    /* ==================== 低压室内部（透视可见，对照图8/9/10） ==================== */
    // 表计柜（米白，贴后壁）：宽 3.4 高 4.2 深 0.8
    const lvCab = new THREE.Mesh(new THREE.BoxGeometry(3.4, 4.2, 0.8), cabMat);
    lvCab.position.set(1.2, y0 + 2.1, -2.4); g.add(lvCab);
    // 6 块指针表（2 行 3 列，黑框白盘）
    for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) {
      const mFr = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.52, 0.06),
        new THREE.MeshPhongMaterial({ color: 0x263238 }));
      mFr.position.set(0.25 + c * 0.85, y0 + 3.62 - r * 0.72, -1.97); g.add(mFr);
      const mFc = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.03),
        new THREE.MeshPhongMaterial({ color: 0xf5f2e8 }));
      mFc.position.set(0.25 + c * 0.85, y0 + 3.62 - r * 0.72, -1.93); g.add(mFc);
    }
    // 万能转换开关（表排左上黑色旋钮）
    const swMat = new THREE.MeshPhongMaterial({ color: 0x212121 });
    const sel2 = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.1, 10), swMat);
    sel2.rotation.x = Math.PI / 2;
    sel2.position.set(-0.55, y0 + 3.62, -1.95); g.add(sel2);
    // 红色铭牌"690V 风电94号箱变低压侧"
    const plate = this._textPlane(`690V 风电${tcode}号箱变低压侧`, '#c62828', 0.3);
    plate.position.set(1.0, y0 + 2.68, -1.96); g.add(plate);
    // 框架断路器（CHNT，带观察窗面板）
    const acb = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.5, 0.5),
      new THREE.MeshPhongMaterial({ color: 0xdfe3e6 }));
    acb.position.set(0.85, y0 + 1.85, -2.05); g.add(acb);
    const acbWin = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.9, 0.06),
      new THREE.MeshPhongMaterial({ color: 0x37474f }));
    acbWin.position.set(0.85, y0 + 1.95, -1.77); g.add(acbWin);
    // 按钮指示排（5 钮：绿红红绿红 + 下方 4 个小开关）
    const btnCols = [0x43a047, 0xe53935, 0xfb8c00, 0x43a047, 0xe53935];
    btnCols.forEach((c, i) => {
      const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.09, 10),
        new THREE.MeshPhongMaterial({ color: c }));
      btn.rotation.x = Math.PI / 2;
      btn.position.set(-0.15 + i * 0.42, y0 + 1.12, -1.96); g.add(btn);
    });
    for (let i = 0; i < 4; i++) {
      const mini = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, 0.08),
        new THREE.MeshPhongMaterial({ color: 0x455a64 }));
      mini.position.set(0.05 + i * 0.42, y0 + 0.78, -1.96); g.add(mini);
    }
    // 右侧 MCB 排（照片：一排蓝色微型断路器）
    for (let i = 0; i < 10; i++) {
      const mcb = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.34, 0.3),
        new THREE.MeshPhongMaterial({ color: 0x2e6da4 }));
      mcb.position.set(2.05 + (i % 5) * 0.2, y0 + 1.85 + Math.floor(i / 5) * 0.45, -1.95); g.add(mcb);
    }
    // 底部红色电抗器 ×3（照片图9/10 底部三个红色圆柱）
    const reacMat = new THREE.MeshPhongMaterial({ color: 0xb7322c });
    [0.3, 1.2, 2.1].forEach(x => {
      const re = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.85, 12), reacMat);
      re.position.set(x, y0 + 0.48, -1.7); g.add(re);
      const reTop = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 10),
        new THREE.MeshPhongMaterial({ color: 0x37474f }));
      reTop.position.set(x, y0 + 0.95, -1.7); g.add(reTop);
    });

    /* ---- 高压室内部：负荷开关柜（深灰） ---- */
    const hvCab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 3.9, 1.8),
      new THREE.MeshPhongMaterial({ color: 0x607d8b }));
    hvCab.position.set(6.6, y0 + 1.95, -1.6); g.add(hvCab);
    const hvPanel = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.9, 0.1),
      new THREE.MeshPhongMaterial({ color: 0x455a64 }));
    hvPanel.position.set(6.6, y0 + 3.2, -0.66); g.add(hvPanel);

    /* ---- 低压出线电缆管（右壁下侧穿出，照片位置） ---- */
    [-0.7, 0.7].forEach(z => {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.9, 10),
        new THREE.MeshPhongMaterial({ color: 0x455a64 }));
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(X0 + W + 0.3, y0 + 0.8, z); g.add(pipe);
    });

    /* ---- 接地扁铁（基础右前角外露） ---- */
    const gnd = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.08, 1.6),
      new THREE.MeshPhongMaterial({ color: 0xa1887f }));
    gnd.position.set(7.5, 0.55, 3.6); g.add(gnd);

    return g;
  }

  /* ==================== 箱变（东盟预装变电站，对照 9 张实拍照片） ====================
   * 造型：蓝色彩钢板箱体 + 浅灰四坡尖顶大挑檐；正面左侧蓝门（止步 高压危险）、
   *       右侧双开浅灰大门（银框 + 挂锁）；-x 端外挂变压器——油箱、横置油枕（端面
   *       法兰盘 + 玻璃管油位计）、冲孔网板散热器围挡；低压室内表计板 / 双排微断 /
   *       塑壳断路器 / 红色电抗器 / 电缆束。基础为混凝土平台 + 散水。
   * ============================================================ */
  _buildTransformerDm() {
    const g = new THREE.Group();
    const blue = 0x2f6fa8;                                   // 东盟蓝（箱体）
    const blueDeep = 0x24578a;                               // 立柱/边框
    const blueDoor = 0x2a6699;                               // 蓝色门板
    const silver = 0xcfd8dd;                                 // 铝型材门框
    const doorPale = 0xdde4e8;                               // 浅灰白大门
    const roofMat = new THREE.MeshPhongMaterial({ color: 0x6d8ba1 });
    const shellMat = () => new THREE.MeshPhongMaterial({ color: blue });
    const trimMat = new THREE.MeshPhongMaterial({ color: blueDeep });
    const tankMat = new THREE.MeshPhongMaterial({ color: 0x2b6396 });
    const cabMat = new THREE.MeshPhongMaterial({ color: 0x3a7cb0 });

    /* ---- 混凝土散水 + 平台 ---- */
    const apron = new THREE.Mesh(new THREE.BoxGeometry(14.2, 0.22, 8.8),
      new THREE.MeshPhongMaterial({ color: 0xb2ada2 }));
    apron.position.set(0.2, 0.11, 0); g.add(apron);
    const base = new THREE.Mesh(new THREE.BoxGeometry(12.8, 0.68, 7.4),
      new THREE.MeshPhongMaterial({ color: 0xc4bfb4 }));
    base.position.set(0.2, 0.45, 0); g.add(base);

    /* ---- 箱体四壁（可透视） ---- */
    const H = 4.7, W = 8, D = 5.2, T = 0.14, y0 = 0.79;
    const X0 = -1.6, xc = X0 + W / 2;        // 箱体左壁 x=-1.6，中心 x=2.4
    const mkWall = (w, h, d, x, y, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), shellMat());
      m.position.set(x, y, z); g.add(m); this.shellMeshes.push(m); return m;
    };
    mkWall(W, H, T, xc, y0 + H / 2, D / 2);      // 前壁（门后衬板）
    mkWall(W, H, T, xc, y0 + H / 2, -D / 2);     // 后壁
    mkWall(T, H, D, X0, y0 + H / 2, 0);          // 左壁（贴变压器）
    mkWall(T, H, D, X0 + W, y0 + H / 2, 0);      // 右壁

    /* ---- 四坡尖顶（矢高 0.9，挑檐 0.55，脊线沿 x，四角起翘为戗脊） ---- */
    const RISE = 0.9, OH = 0.55, halfD = D / 2 + OH;
    const W2 = W / 2 + OH, RX = Math.max(0.6, W2 - halfD * 1.15);   // 屋脊半长
    const rbH = y0 + H;
    const V = [
      [-W2, 0,  halfD], [ W2, 0,  halfD], [ W2, 0, -halfD], [-W2, 0, -halfD],  // A B C D
      [-RX, RISE, 0], [ RX, RISE, 0]                                            // R1 R2
    ];
    const faces = [
      [0, 1, 5, 4],   // 前坡
      [3, 4, 5, 2],   // 后坡
      [1, 2, 5],      // 右歇山（三角）
      [0, 4, 3]       // 左歇山（三角）
    ];
    const pos = [], idx = [];
    V.forEach(v => pos.push(v[0], v[1], v[2]));
    faces.forEach(f => { for (let i = 1; i < f.length - 1; i++) idx.push(f[0], f[i], f[i + 1]); });
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    rg.setIndex(idx);
    rg.computeVertexNormals();
    const roofMesh = new THREE.Mesh(rg, new THREE.MeshPhongMaterial({
      color: 0x6d8ba1, side: THREE.DoubleSide, flatShading: true
    }));
    roofMesh.position.set(xc, rbH, 0);
    g.add(roofMesh); this.shellMeshes.push(roofMesh);
    // 屋脊压条
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(RX * 2 + 0.1, 0.16, 0.3), trimMat);
    ridge.position.set(xc, rbH + RISE + 0.04, 0); g.add(ridge);
    // 四条戗脊（四角斜脊，深蓝细条）
    [[-W2, halfD, -RX], [W2, halfD, RX], [W2, -halfD, RX], [-W2, -halfD, -RX]].forEach(([hx, hz, rx2]) => {
      const a = new THREE.Vector3(xc + hx, rbH, hz);
      const b = new THREE.Vector3(xc + rx2, rbH + RISE, 0);
      const dir = new THREE.Vector3().subVectors(b, a);
      const len = dir.length();
      const blade = new THREE.Mesh(new THREE.BoxGeometry(len, 0.09, 0.14), trimMat);
      blade.position.copy(a).addScaledVector(dir, 0.5);
      blade.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir.normalize());
      g.add(blade);
    });
    // 檐口滴水线（前后各一条）
    [1, -1].forEach(s => {
      const eave = new THREE.Mesh(new THREE.BoxGeometry(W + OH * 2, 0.14, 0.1), roofMat);
      eave.position.set(xc, rbH - 0.02, s * (halfD + 0.02)); g.add(eave);
    });

    /* ---- 正面（+z）：左蓝门 + 窄门 + 右侧双开浅灰大门 ---- */
    const doorH = 3.85, doorY = y0 + doorH / 2, fz = D / 2 + 0.09;
    const doorTrim = new THREE.MeshPhongMaterial({ color: silver });
    // 蓝色左门（一宽一窄，照片2/7），带门锁与"止步 高压危险"
    [[-0.55, 1.7], [0.78, 1.0]].forEach(([dx, dw]) => {
      const dp = new THREE.Mesh(new THREE.BoxGeometry(dw, doorH, 0.09),
        new THREE.MeshPhongMaterial({ color: blueDoor }));
      dp.position.set(dx, doorY, fz); g.add(dp);
      // 门框（铝型材四周）
      const fr = new THREE.Mesh(new THREE.BoxGeometry(dw + 0.09, doorH + 0.09, 0.05), doorTrim);
      fr.position.set(dx, doorY, fz - 0.04); g.add(fr);
    });
    // 嵌入式门锁（窄门中部，深灰小方块）
    const lock1 = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.3, 0.08),
      new THREE.MeshPhongMaterial({ color: 0x37474f }));
    lock1.position.set(0.62, doorY - 0.15, fz + 0.06); g.add(lock1);
    // "止步 高压危险"（灰白字，两行，在蓝门中部）
    const dmWarn = this._textPlane('止步\n高压危险', '#dfe7ec', 0.9);
    dmWarn.position.set(-0.55, doorY + 0.15, fz + 0.10); g.add(dmWarn);
    // 门上小铭牌（白底，蓝门右上）
    const dmPlate = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.34, 0.03),
      new THREE.MeshPhongMaterial({ color: 0xeef2f4 }));
    dmPlate.position.set(-0.78, doorY + 1.35, fz + 0.09); g.add(dmPlate);

    // 右侧双开浅灰大门（照片2/3：两扇，中间挂锁）
    [2.55, 4.45].forEach(dx => {
      const dp = new THREE.Mesh(new THREE.BoxGeometry(1.86, doorH, 0.1),
        new THREE.MeshPhongMaterial({ color: doorPale }));
      dp.position.set(dx, doorY, fz); g.add(dp);
      // 银框
      const fr = new THREE.Mesh(new THREE.BoxGeometry(1.95, doorH + 0.08, 0.05), doorTrim);
      fr.position.set(dx, doorY, fz - 0.045); g.add(fr);
      // 门芯（浅色嵌板，上下两段）
      [0.95, -0.95].forEach(dy => {
        const inlay = new THREE.Mesh(new THREE.BoxGeometry(1.62, 1.55, 0.04),
          new THREE.MeshPhongMaterial({ color: 0xe9eef1 }));
        inlay.position.set(dx, doorY + dy, fz + 0.06); g.add(inlay);
      });
      // 合页（左缘三处银色小块）
      [-1.3, 0, 1.3].forEach(dy => {
        const hg = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.22, 0.08),
          new THREE.MeshPhongMaterial({ color: 0xbfc9ce }));
        hg.position.set(dx - 0.9, doorY + dy, fz + 0.06); g.add(hg);
      });
    });
    // 中间挂锁（银灰锁体 + 锁梁）
    const lockBody = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.12),
      new THREE.MeshPhongMaterial({ color: 0xb0b8bd }));
    lockBody.position.set(3.5, doorY - 0.1, fz + 0.12); g.add(lockBody);
    const lockArc = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.022, 6, 12, Math.PI),
      new THREE.MeshPhongMaterial({ color: 0x9aa3a8 }));
    lockArc.position.set(3.5, doorY + 0.06, fz + 0.12); g.add(lockArc);

    // 正面竖向铝型材立柱 + 门顶横梁 + 底槛
    [-1.5, 0.28, 1.42, 5.5].forEach(x => {
      const col = new THREE.Mesh(new THREE.BoxGeometry(0.12, H, 0.12), doorTrim);
      col.position.set(x, y0 + H / 2, D / 2 + 0.1); g.add(col);
    });
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(W, 0.16, 0.14), doorTrim);
    lintel.position.set(xc, y0 + doorH + 0.14, D / 2 + 0.1); g.add(lintel);
    const sill = new THREE.Mesh(new THREE.BoxGeometry(W, 0.12, 0.16), doorTrim);
    sill.position.set(xc, y0 + 0.06, D / 2 + 0.08); g.add(sill);

    // 设备名称（照片：箱门上方喷字/标牌）
    const nm = this._textPlane(this.label || '东盟箱变', '#eaf1f6', 0.5);
    nm.position.set(xc, y0 + H - 0.42, D / 2 + 0.12); g.add(nm);

    /* ---- 右端面（+x）：上部通气百叶 ---- */
    for (let i = 0; i < 5; i++) {
      const slat = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.12, 2.0), trimMat);
      slat.position.set(X0 + W + 0.09, y0 + H - 0.75 - i * 0.28, 0);
      slat.rotation.z = 0.35; g.add(slat);
    }

    /* ==================== 变压器区（-x 端外挂） ==================== */
    const tankX = -3.6;
    // 油箱本体 + 顶盖法兰
    const tank = new THREE.Mesh(new THREE.BoxGeometry(3.2, 2.8, 3.0), tankMat);
    tank.position.set(tankX, y0 + 1.4, 0); g.add(tank);
    const lid = new THREE.Mesh(new THREE.BoxGeometry(3.42, 0.16, 3.2), trimMat);
    lid.position.set(tankX, y0 + 2.88, 0); g.add(lid);
    // 油箱加强筋（竖向后壁筋板）
    [-1.1, 0, 1.1].forEach(dy => {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(3.0, 0.1, 0.08), trimMat);
      rib.position.set(tankX, y0 + 1.4 + dy, 1.52); g.add(rib);
    });

    /* ---- 横置油枕（端面朝 -x：大法兰盘 + 螺栓圈 + 玻璃管油位计） ---- */
    const consY = y0 + 4.05, consR = 0.64, consL = 2.4;
    const cons = new THREE.Mesh(new THREE.CylinderGeometry(consR, consR, consL, 20), tankMat);
    cons.rotation.z = Math.PI / 2;
    cons.position.set(tankX, consY, 0); g.add(cons);
    // 两端大法兰盘（照片6：螺栓密集的圆形端盖）
    [-consL / 2, consL / 2].forEach(dx => {
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(consR + 0.12, consR + 0.12, 0.14, 20), trimMat);
      cap.rotation.z = Math.PI / 2;
      cap.position.set(tankX + dx, consY, 0); g.add(cap);
      // 端面螺栓圈
      for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.06, 6),
          new THREE.MeshPhongMaterial({ color: 0x8fa0ab }));
        bolt.rotation.z = Math.PI / 2;
        bolt.position.set(tankX + dx + (dx > 0 ? 0.1 : -0.1), consY + Math.cos(a) * (consR + 0.04), Math.sin(a) * (consR + 0.04));
        g.add(bolt);
      }
    });
    // 油位计（-x 端盖外侧的竖直玻璃管 + 红色浮球）
    const gTube = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.78, 8),
      new THREE.MeshPhongMaterial({ color: 0xdfe9ee, transparent: true, opacity: 0.9 }));
    gTube.position.set(tankX - consL / 2 - 0.16, consY, 0); g.add(gTube);
    const gFloat = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.2, 8),
      new THREE.MeshPhongMaterial({ color: 0xc62828 }));
    gFloat.position.set(tankX - consL / 2 - 0.16, consY + 0.08, 0); g.add(gFloat);
    [-0.42, 0.42].forEach(dy => {
      const hd = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.14, 6), trimMat);
      hd.rotation.z = Math.PI / 2;
      hd.position.set(tankX - consL / 2 - 0.1, consY + dy, 0); g.add(hd);
    });
    // 油枕支架（撑在油箱顶盖上）
    [-0.85, 0.85].forEach(dx => {
      const br = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.1, 0.14), trimMat);
      br.position.set(tankX + dx, y0 + 3.5, 0); g.add(br);
    });
    // 油枕下方波纹连管（照片6：黑色金属软管）
    const bellows = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.9, 10),
      new THREE.MeshPhongMaterial({ color: 0x39434b }));
    bellows.position.set(tankX + 0.55, y0 + 3.42, 0.55); g.add(bellows);
    // 呼吸器（照片红框：油枕端部立管上翻 180° 弯头，呼吸器倒挂末端）
    const brX = -2.55, brTopY = consY + 1.46;
    const brPipeMat = new THREE.MeshPhongMaterial({ color: 0x4a5862 });
    const brRiser = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.86, 10), brPipeMat);
    brRiser.position.set(brX, consY + 1.0, 0); g.add(brRiser);
    const brArc = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.045, 8, 18, Math.PI), brPipeMat);
    brArc.position.set(brX - 0.28, brTopY, 0); g.add(brArc);
    const brDrop = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.14, 10), brPipeMat);
    brDrop.position.set(brX - 0.56, brTopY - 0.07, 0); g.add(brDrop);
    const breather = this._breatherBody(1.0);
    breather.position.set(brX - 0.56, brTopY - 0.13, 0); g.add(breather);

    /* ---- 瓦斯保护（气体继电器）：油罐与箱变本体之间的夹缝内，连管上通油枕 ---- */
    const grX = -1.9, grY = y0 + 3.3, grZ = 0;
    const gasRelay = this._gasRelayBody(0.8);
    gasRelay.position.set(grX, grY, grZ); g.add(gasRelay);
    const grPipeMat = new THREE.MeshPhongMaterial({ color: 0x4a5862 });
    // 下短管（油箱顶盖 → 继电器下法兰）
    const grLow = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.16, 10), grPipeMat);
    grLow.position.set(grX, y0 + 3.03, grZ); g.add(grLow);
    // 上立管（继电器上法兰 → 油枕高度）
    const grUp = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.5, 10), grPipeMat);
    grUp.position.set(grX, y0 + 3.75, grZ); g.add(grUp);
    // 顶部水平连管（油枕右端 → 立管）
    const grHoriz = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.52, 10), grPipeMat);
    grHoriz.rotation.z = Math.PI / 2;
    grHoriz.position.set(-2.14, y0 + 4.05, grZ); g.add(grHoriz);
    // 阀门 + 红色手轮（上立管中部）
    const grValve = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.06, 12), trimMat);
    grValve.position.set(grX, y0 + 3.68, grZ); g.add(grValve);
    const grWheel = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.03, 0.05),
      new THREE.MeshPhongMaterial({ color: 0xc62828 }));
    grWheel.position.set(grX, y0 + 3.74, grZ); g.add(grWheel);
    // 下支座（角钢撑在油箱顶盖边缘）
    const grSeat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.4), trimMat);
    grSeat.position.set(grX, y0 + 2.99, grZ); g.add(grSeat);

    /* ---- 散热器：冲孔网板三面围挡（照片1/5：蓝色穿孔钢板） ---- */
    const punchTex = this._punchTexture();
    const punchMat = new THREE.MeshPhongMaterial({ map: punchTex, color: 0xffffff });
    const FX0 = -6.0, FX1 = -1.72, FZ = 1.68, FH = 2.45, fy = y0 + FH / 2;
    const mkPunch = (w, h, x, y, z, ry) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.06), punchMat);
      p.position.set(x, y, z); p.rotation.y = ry; g.add(p);
      // 边框型钢
      const fr = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, 0.09), trimMat);
      fr.position.set(x, y - h / 2 + 0.04, z); fr.rotation.y = ry; g.add(fr);
      const fr2 = fr.clone(); fr2.position.y = y + h / 2 - 0.04; g.add(fr2);
    };
    mkPunch(FX1 - FX0, FH, (FX0 + FX1) / 2, fy, FZ, 0);       // 前挡板
    mkPunch(FX1 - FX0, FH, (FX0 + FX1) / 2, fy, -FZ, 0);      // 后挡板
    mkPunch(FZ * 2, FH, FX0, fy, 0, Math.PI / 2);             // 左端挡板
    // 围挡立柱
    [[FX0, FZ], [FX0, -FZ], [FX1, FZ], [FX1, -FZ], [(FX0 + FX1) / 2, FZ], [(FX0 + FX1) / 2, -FZ]].forEach(([x, z]) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.1, FH + 0.1, 0.1), trimMat);
      p.position.set(x, fy, z); g.add(p);
    });
    // 网板内可见的散热片（从网板上缘露出的翅片阵列）
    for (let i = 0; i < 12; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.75, 0.5), tankMat);
      fin.position.set(FX0 + 0.35 + i * 0.33, y0 + FH + 0.32, 0.95); g.add(fin);
    }
    // 变压器底座型钢（照片6：蓝色工字钢底座）
    const skid = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.28, 3.4), trimMat);
    skid.position.set(tankX, y0 + 0.12, 0); g.add(skid);

    /* ==================== 箱内：低压室（右侧，照片8） ==================== */
    // 后壁蓝色表计板
    const panel = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.1, 0.12), cabMat);
    panel.position.set(3.4, y0 + 3.3, -2.35); g.add(panel);
    // 3 块指针表（白盘黑框）
    [2.55, 3.35, 4.15].forEach(x => {
      const pf = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.06),
        new THREE.MeshPhongMaterial({ color: 0x263238 }));
      pf.position.set(x, y0 + 3.7, -2.26); g.add(pf);
      const pc = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.03),
        new THREE.MeshPhongMaterial({ color: 0xf3f1e7 }));
      pc.position.set(x, y0 + 3.7, -2.22); g.add(pc);
    });
    // 转换开关 ×3 + 数显表 + 指示灯
    [1.95, 2.2, 2.45].forEach(x => {
      const sw = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.2, 0.08),
        new THREE.MeshPhongMaterial({ color: 0x212121 }));
      sw.position.set(x, y0 + 3.72, -2.25); g.add(sw);
    });
    const lcd = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.2, 0.05),
      new THREE.MeshPhongMaterial({ color: 0x1b2b33 }));
    lcd.position.set(1.95, y0 + 3.28, -2.25); g.add(lcd);
    [[4.55, 0xe53935], [4.8, 0x43a047], [5.05, 0xe53935]].forEach(([x, c]) => {
      const lamp = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.06, 8),
        new THREE.MeshBasicMaterial({ color: c }));
      lamp.rotation.x = Math.PI / 2; lamp.position.set(x, y0 + 3.55, -2.25); g.add(lamp);
    });
    // 双排微型断路器（蓝色，位于中部导轨）
    for (let row = 0; row < 2; row++) for (let i = 0; i < 9; i++) {
      const mcb = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.28, 0.16),
        new THREE.MeshPhongMaterial({ color: 0x2e6da4 }));
      mcb.position.set(2.0 + i * 0.13, y0 + 2.55 - row * 0.36, -2.24); g.add(mcb);
    }
    // 塑壳断路器（右下，带液晶面板与铭牌）
    const mccb = new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.25, 0.42),
      new THREE.MeshPhongMaterial({ color: 0x5b646b }));
    mccb.position.set(4.5, y0 + 2.1, -2.2); g.add(mccb);
    const mccbFace = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 0.06),
      new THREE.MeshPhongMaterial({ color: 0x333c42 }));
    mccbFace.position.set(4.5, y0 + 2.1, -1.98); g.add(mccbFace);
    const mccbLcd = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.03),
      new THREE.MeshPhongMaterial({ color: 0x9fd3c0 }));
    mccbLcd.position.set(4.5, y0 + 2.35, -1.94); g.add(mccbLcd);
    const mccbPlate = this._textPlane('690V 低压侧 5071 开关', '#e8f0f4', 0.17);
    mccbPlate.position.set(4.5, y0 + 2.72, -1.97); g.add(mccbPlate);
    // "禁止合闸 有人工作" 牌（挂在内壁）
    const stopSg = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.44, 0.03),
      new THREE.MeshPhongMaterial({ color: 0xf4f6f7 }));
    stopSg.position.set(5.75, y0 + 3.5, -2.37); g.add(stopSg);
    const stopTx = this._textPlane('禁止合闸\n有人工作', '#c62828', 0.14);
    stopTx.position.set(5.75, y0 + 3.5, -2.34); g.add(stopTx);
    // 红色电抗器 ×3（左下角，照片8）
    [2.1, 2.95, 3.8].forEach(x => {
      const re = new THREE.Mesh(new THREE.CylinderGeometry(0.29, 0.29, 0.9, 14),
        new THREE.MeshPhongMaterial({ color: 0xb7322c }));
      re.position.set(x, y0 + 0.6, -1.5); g.add(re);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.19, 0.1, 10),
        new THREE.MeshPhongMaterial({ color: 0x37474f }));
      cap.position.set(x, y0 + 1.07, -1.5); g.add(cap);
    });
    // 低压出线电缆束（红黄绿黑，沿右壁竖向进柜）
    [0xe53935, 0xfbc02d, 0x43a047, 0x26313a].forEach((c, i) => {
      const cab = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 2.3, 8),
        new THREE.MeshPhongMaterial({ color: c }));
      cab.position.set(5.55 - i * 0.16, y0 + 1.35, -1.85); g.add(cab);
    });

    /* ==================== 箱内：高压室（左侧，负荷开关柜 + 电缆头） ==================== */
    const hvCab = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3.5, 1.6),
      new THREE.MeshPhongMaterial({ color: 0x707f88 }));
    hvCab.position.set(-0.15, y0 + 1.75, -1.55); g.add(hvCab);
    const hvFace = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.1, 0.07),
      new THREE.MeshPhongMaterial({ color: 0x4b5a63 }));
    hvFace.position.set(-0.15, y0 + 2.7, -0.73); g.add(hvFace);
    // 带电显示器（三只小灯）
    [[-0.65, 0xe53935], [-0.15, 0xfbc02d], [0.35, 0x43a047]].forEach(([dx, c]) => {
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6),
        new THREE.MeshBasicMaterial({ color: c }));
      led.position.set(-0.15 + dx, y0 + 2.95, -0.69); g.add(led);
    });
    // 电缆肘型头（柜前上方，三只）
    [[-0.85, 0xe53935], [-0.15, 0xfbc02d], [0.55, 0x43a047]].forEach(([dx, c]) => {
      const elbow = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.42, 10),
        new THREE.MeshPhongMaterial({ color: c }));
      elbow.position.set(dx, y0 + 2.35, -0.62); g.add(elbow);
      const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 8),
        new THREE.MeshPhongMaterial({ color: 0x2b3238 }));
      wire.position.set(dx, y0 + 1.85, -0.55); g.add(wire);
    });

    /* ---- 低压出线穿管（右壁下方外部） ---- */
    [-0.8, 0.8].forEach(z => {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.9, 10),
        new THREE.MeshPhongMaterial({ color: 0x455a64 }));
      pipe.rotation.z = Math.PI / 2;
      pipe.position.set(X0 + W + 0.35, y0 + 0.85, z); g.add(pipe);
    });

    /* ---- 接地扁铁（基础右前角外露） ---- */
    const gnd = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 1.5),
      new THREE.MeshPhongMaterial({ color: 0xa1887f }));
    gnd.position.set(6.9, 0.6, 3.3); g.add(gnd);

    return g;
  }

  /* 冲孔网板纹理（蓝色钢板 + 深色圆孔，平铺） */
  _punchTexture() {
    const cv = document.createElement('canvas');
    cv.width = 64; cv.height = 64;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#2f6fa8'; ctx.fillRect(0, 0, 64, 64);
    ctx.fillStyle = '#1c4467';
    for (let y = 6; y < 64; y += 12) {
      for (let x = 6; x < 64; x += 12) {
        ctx.beginPath(); ctx.arc(x, y, 3.0, 0, Math.PI * 2); ctx.fill();
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(14, 3);
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  /* 围栏网格纹理（蓝色方格网片，透明底） */
  _fenceTexture() {
    const cv = document.createElement('canvas');
    cv.width = 128; cv.height = 128;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    ctx.strokeStyle = 'rgba(52,116,164,0.9)';
    ctx.lineWidth = 2;
    for (let i = 0; i <= 128; i += 12) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, 128); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(128, i); ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(6, 2);
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }

  /* ==================== 外壳透视 ==================== */
  setGhost(on) {
    this._ghost = on;
    for (const m of this.shellMeshes) {
      m.material.transparent = on;
      m.material.opacity = on ? 0.22 : 1;
      m.material.depthWrite = !on;
      m.material.side = on ? THREE.DoubleSide : THREE.FrontSide;
      m.material.needsUpdate = true;
    }
    if (this._numTag) this._numTag.visible = !on;
  }

  /* ==================== 视角定位 / 复位 ==================== */
  /* 将视角对准某部件（缺陷定位用）：注视点移到部件，相机转到部件所在侧，并高亮该部件 */
  focusPart(partId) {
    const a = (this._anchors || {})[partId];
    if (!a) return;
    this._target.set(a[0], a[1], a[2]);
    // 相机绕到部件所在一侧，避免被结构挡住
    const horiz = Math.hypot(a[0], a[2]);
    if (horiz > 0.4) this._sph.theta = Math.atan2(a[2], a[0]);
    const BASE = ['tower_lamp', 'ladder', 'hoist', 'tower_cable', 'base_floor',
      'electric', 'fire', 'sign', 'foundation'];
    const INTERNAL = ['main_shaft', 'gearbox', 'coupling', 'generator', 'hydraulic',
      'nacelle_cab', 'cooling', 'anemometer', 'yaw', 'nacelle', 'platform'];
    if (this.modelType === 'turbine' && BASE.includes(partId)) {
      // 塔基/塔底部件：近景观察（约 7m 距离，与部件同高）
      this._sph.r = 9.5;
      this._sph.phi = 1.32;
    } else if (this.modelType === 'turbine' && INTERNAL.includes(partId)) {
      // 机舱内部件：从侧面观察（正面会被轮毂遮挡）
      this._sph.theta = Math.PI / 2 + 0.3;
      this._sph.phi = Math.PI / 2.35;
      this._sph.r = partId === 'platform' ? 24 : 20;
    } else if (this.modelType === 'transformer' && ['hv_room', 'lv_cabinet'].includes(partId)) {
      // 箱变室内部件：近景透视观察
      this._sph.r = 15;
      this._sph.phi = 1.28;
    } else if (this.modelType === 'transformer' && partId === 'buchholz') {
      // 瓦斯保护（气体继电器）：从箱体侧斜俯视油箱顶，避免被油枕/油箱挡住
      this._sph.theta = this.brand === 'dongmeng' ? 1.9 : 2.2;
      this._sph.phi = this.brand === 'dongmeng' ? 1.45 : 1.22;
      this._sph.r = this.brand === 'dongmeng' ? 8 : 9;
    } else if (this.modelType === 'transformer') {
      // 箱变外露部件（油枕/围栏区/外壳等）：中景环视
      this._sph.r = 14;
      this._sph.phi = 1.18;
    } else {
      this._sph.r = 26;
      this._sph.phi = 1.32;
    }
    // 箱变外露部件无需透视；仅透视观察内部
    const EXTERIOR = ['radiator', 'conservator', 'gauge', 'buchholz', 'bushing_hv', 'bushing_lv',
      'ground', 'base_x', 'enclosure'];
    if (!(this.modelType === 'transformer' && EXTERIOR.includes(partId))) {
      if (!this._ghost) this.setGhost(true);
      const gt = document.getElementById('ghostToggle');
      if (gt) gt.checked = true;
    }
    // 高亮光晕
    this._showHalo(a);
  }

  /* 塔基一览视角：贴近塔底环视内部器件 */
  focusBase() {
    this._target.set(0, 1.6, 0);
    this._sph.r = 15.5;
    this._sph.phi = 0.92;
    this._sph.theta = 0.95;
    this.setGhost(true);
    const gt = document.getElementById('ghostToggle');
    if (gt) gt.checked = true;
  }

  _showHalo(a) {
    if (this._halo) { this.scene.remove(this._halo); this._halo = null; }
    const R = this.modelType === 'turbine' ? (a[1] < 20 ? 1.0 : 2.4) : 1.3;
    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(R, 20, 16),
      new THREE.MeshBasicMaterial({ color: 0x2979ff, transparent: true, opacity: 0.1, depthWrite: false })
    );
    halo.position.set(a[0], a[1], a[2]);
    halo.renderOrder = 990;
    this.scene.add(halo);
    this._halo = halo;
  }

  resetView() {
    this._target.set(this._home.cx || 0, this._home.cy, 0);
    this._sph.r = this._home.r;
    this._sph.theta = this._home.theta;
    this._sph.phi = this._home.phi;
    if (this._halo) { this.scene.remove(this._halo); this._halo = null; }
  }

  /* ==================== 缺陷标记 ==================== */
  setDefects(defects) {
    for (const m of this.markers) this.scene.remove(m.group);
    this.markers = [];

    const anchors = this._anchors || ANCHORS[this.modelType] || {};
    const byPart = {};
    defects.filter(d => d.status !== 'resolved').forEach(d => {
      (byPart[d.part] = byPart[d.part] || []).push(d);
    });

    let labelIdx = 0;
    const ballR = this.modelType === 'turbine' ? 0.55 : 0.42;
    for (const partId in byPart) {
      const anchor = anchors[partId] || [0, 10, 0];
      byPart[partId].forEach((d, i, arr) => {
        const lvl = LEVELS[d.level];
        const grp = new THREE.Group();
        // 标记球：depthTest=false，穿透外壳始终可见
        const ball = new THREE.Mesh(
          new THREE.SphereGeometry(ballR, 16, 12),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(lvl.color), depthTest: false, transparent: true, opacity: 0.95 })
        );
        ball.renderOrder = 999;
        ball.userData.defectId = d.id;
        grp.add(ball);
        // 外发光环
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(ballR * 1.6, ballR * 2.0, 24),
          new THREE.MeshBasicMaterial({ color: new THREE.Color(lvl.color), transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthTest: false })
        );
        ring.renderOrder = 998;
        grp.add(ring);
        // 部件名称悬浮标签（直接显示"塔筒照明/灯管"这类器件名）
        const label = this._makeLabel(partName(this._unitType, d.part), lvl.color);
        const li = labelIdx++;
        label.position.set(
          (li % 2 ? 1 : -1) * (this.modelType === 'turbine' ? 2.3 : 2.1),
          (this.modelType === 'turbine' ? 2.1 : 0.9) + Math.floor(li / 2) % 4 * (this.modelType === 'turbine' ? 1.6 : 1.25),
          0
        );
        grp.add(label);
        // 同部件多缺陷 → 环形偏移
        const ang = (i / arr.length) * Math.PI * 2;
        const off = arr.length > 1 ? ballR * 4 : 0;
        grp.position.set(anchor[0] + Math.cos(ang) * off, anchor[1] + (arr.length > 1 ? Math.sin(ang) * off : 0), anchor[2]);
        grp.userData = { defect: d, ball, ring, label, phase: Math.random() * Math.PI * 2 };
        this.scene.add(grp);
        this.markers.push({ group: grp, defect: d });
      });
    }
    this._updateLegend();
  }

  /* 生成文字标签精灵（Canvas 纹理） */
  _makeLabel(text, color) {
    const pad = 12, fontSize = 34;
    const cv = document.createElement('canvas');
    const ctx0 = cv.getContext('2d');
    ctx0.font = `600 ${fontSize}px "Microsoft YaHei", sans-serif`;
    const w = Math.ceil(ctx0.measureText(text).width) + pad * 2;
    const h = fontSize + pad * 2;
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    // 圆角底板
    const r = 10;
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(r, 1); ctx.lineTo(w - r, 1); ctx.quadraticCurveTo(w - 1, 1, w - 1, r);
    ctx.lineTo(w - 1, h - r); ctx.quadraticCurveTo(w - 1, h - 1, w - r, h - 1);
    ctx.lineTo(r, h - 1); ctx.quadraticCurveTo(1, h - 1, 1, h - r);
    ctx.lineTo(1, r); ctx.quadraticCurveTo(1, 1, r, 1);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // 文字
    ctx.font = `600 ${fontSize}px "Microsoft YaHei", sans-serif`;
    ctx.fillStyle = '#22303c';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 1);

    const tex = new THREE.CanvasTexture(cv);
    tex.minFilter = THREE.LinearFilter;
    const spr = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthTest: false, depthWrite: false
    }));
    spr.renderOrder = 1000;
    const worldH = this.modelType === 'turbine' ? 2.0 : 1.1;
    spr.scale.set(worldH * (w / h), worldH, 1);
    spr.userData.aspect = w / h;
    return spr;
  }

  _updateLegend() {
    const el = document.getElementById('legend3d');
    if (!el) return;
    const counts = {};
    this.markers.forEach(m => { counts[m.defect.level] = (counts[m.defect.level] || 0) + 1; });
    el.innerHTML = Object.keys(LEVELS).sort((a, b) => b - a)
      .filter(l => counts[l])
      .map(l => `<span class="lg-item"><i style="background:${LEVELS[l].color}"></i>${LEVELS[l].name} ×${counts[l]}</span>`)
      .join('') || '<span class="lg-item"><i style="background:#43a047"></i>无未闭环缺陷，机组良好</span>';
  }

  /* ==================== 交互 ==================== */
  _bindEvents() {
    const dom = this.renderer.domElement;
    let dragging = false, px = 0, py = 0, moved = 0;

    dom.addEventListener('pointerdown', e => { dragging = true; px = e.clientX; py = e.clientY; moved = 0; });
    window.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - px, dy = e.clientY - py;
      moved += Math.abs(dx) + Math.abs(dy);
      this._sph.theta -= dx * 0.006;
      this._sph.phi = Math.max(0.15, Math.min(Math.PI / 2 + 0.3, this._sph.phi - dy * 0.005));
      px = e.clientX; py = e.clientY;
    });
    window.addEventListener('pointerup', e => {
      if (dragging && moved < 5) this._pick(e);
      dragging = false;
    });
    dom.addEventListener('wheel', e => {
      e.preventDefault();
      this._sph.r = Math.max(6, Math.min(220, this._sph.r * (1 + e.deltaY * 0.001)));
    }, { passive: false });

    this._resizeHandler = () => {
      const w = this.container.clientWidth, h = this.container.clientHeight;
      if (!w || !h) return;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };
    window.addEventListener('resize', this._resizeHandler);
  }

  _pick(e) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this._mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this._mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this._raycaster.setFromCamera(this._mouse, this.camera);
    const balls = this.markers.map(m => m.group.userData.ball);
    const hits = this._raycaster.intersectObjects(balls);
    if (hits.length && this.onMarkerClick) {
      const id = hits[0].object.userData.defectId;
      const mk = this.markers.find(m => m.defect.id === id);
      if (mk) this.onMarkerClick(mk.defect);
    }
  }

  _animate() {
    if (this._disposed) return;
    requestAnimationFrame(() => this._animate());
    const dt = this._clock.getDelta();
    const t = this._clock.elapsedTime;

    // 风轮慢转（停机怠速感）
    if (this.rotor) this.rotor.rotation.x += dt * 0.25;

    // 标记呼吸闪烁（标记与标签随距离自适应，保持屏幕尺寸稳定）
    const r0 = this.modelType === 'turbine' ? 95 : 24;
    const k = Math.max(0.15, Math.min(2.4, this._sph.r / r0));
    for (const m of this.markers) {
      const u = m.group.userData;
      const s = 1 + 0.18 * Math.sin(t * 3 + u.phase);
      u.ball.scale.setScalar(s * k);
      u.ring.scale.setScalar((1 + 0.3 * Math.sin(t * 3 + u.phase)) * k);
      u.ring.lookAt(this.camera.position);
      const hh = this._sph.r * 0.028;
      u.label.scale.set(hh * u.label.userData.aspect, hh, 1);
    }

    // 相机轨道（围绕注视点）
    const { theta, phi, r } = this._sph;
    this.camera.position.set(
      this._target.x + r * Math.sin(phi) * Math.cos(theta),
      this._target.y + r * Math.cos(phi),
      this._target.z + r * Math.sin(phi) * Math.sin(theta)
    );
    this.camera.lookAt(this._target);

    if (this._halo) this._halo.material.opacity = 0.06 + 0.07 * (0.5 + 0.5 * Math.sin(t * 2.5));

    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this._disposed = true;
    window.removeEventListener('resize', this._resizeHandler);
    if (this._ro) { this._ro.disconnect(); this._ro = null; }
    if (this.renderer) {
      this.renderer.dispose();
      if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}
