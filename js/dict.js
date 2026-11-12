/* ============================================================
 * 缺陷字典与基础常量（v2 部件级）
 * 设计原则：四级标准化 —— 设备类型 → 部件 → 缺陷类型 → 严重等级
 * 部件与 3D 模型中的真实器件一一对应（见 viewer3d.js ANCHORS）。
 * 扩展新设备类型（线路/铁塔/地埋线）只需在 DEVICE_TYPES 中增加条目。
 * ============================================================ */

const LEVELS = {
  4: { key: 'critical', name: '紧急', color: '#e53935', dark: '#b71c1c', desc: '危及人身设备安全，需立即停机处理' },
  3: { key: 'major',    name: '重大', color: '#fb8c00', dark: '#e65100', desc: '影响安全运行，需限期处理' },
  2: { key: 'minor',    name: '一般', color: '#fbc02d', dark: '#f57f17', desc: '暂不影响运行，列入计划处理' },
  1: { key: 'observe',  name: '观察', color: '#1e88e5', dark: '#0d47a1', desc: '暂不处理，持续跟踪观察' }
};
const HEALTH_GOOD = { key: 'good', name: '良好', color: '#43a047' };

const STATUS_FLOW = ['reported', 'confirmed', 'processing', 'resolved'];
const STATUS = {
  reported:   { name: '已填报', color: '#8e24aa', next: 'confirmed',   nextName: '确认' },
  confirmed:  { name: '已确认', color: '#3949ab', next: 'processing',  nextName: '开始处理' },
  processing: { name: '处理中', color: '#fb8c00', next: 'resolved',    nextName: '消除闭环' },
  resolved:   { name: '已消除', color: '#43a047', next: null,          nextName: null }
};

/* 设备类型字典（部件级，对应 1.5MW 双馈机组 / 欧式预装箱变） */
const DEVICE_TYPES = {
  turbine: {
    name: '风机本体', icon: '🌀', model3d: 'turbine',
    parts: [
      /* ---- 风轮 ---- */
      { id: 'blade',      name: '叶片',            cats: ['前缘腐蚀', '叶尖裂纹', '蒙皮分层/开裂', '雷击损伤', '表面砂眼', '运行异响', '叶根螺栓松动/断裂', '其他'] },
      { id: 'hub',        name: '轮毂/变桨系统',    cats: ['变桨轴承异响', '变桨电机故障', '变桨减速器渗油', '轮毂罩开裂', '变桨电池/超级电容异常', '变桨通讯故障', '其他'] },
      /* ---- 机舱传动链 ---- */
      { id: 'main_shaft', name: '主轴/主轴承',      cats: ['主轴承异响', '主轴承温度高', '轴承润滑不良/漏油', '主轴探伤裂纹', '其他'] },
      { id: 'gearbox',    name: '齿轮箱',          cats: ['箱体渗油', '油位异常', '油温高', '齿面点蚀/断齿', '滤芯堵塞报警', '油泵电机故障', '弹性支撑老化', '其他'] },
      { id: 'coupling',   name: '联轴器/高速刹车',  cats: ['刹车片磨损超限', '刹车盘裂纹/划痕', '联轴器对中超差', '高速轴护罩松动', '其他'] },
      { id: 'generator',  name: '发电机',          cats: ['轴承温度高', '运行异响', '绝缘/接地报警', '滑环碳刷磨损', '冷却风扇故障', '其他'] },
      { id: 'hydraulic',  name: '液压站',          cats: ['液压站渗油', '系统压力异常', '油泵电机故障', '蓄能器压力不足', '其他'] },
      { id: 'nacelle_cab',name: '机舱控制柜',       cats: ['端子排发热', 'PLC/模块报警', '柜内凝露/进水', '柜门密封失效', '其他'] },
      { id: 'cooling',    name: '机舱散热系统',     cats: ['散热风扇故障', '冷却器翅片堵塞', '冷却水管渗漏', '其他'] },
      { id: 'anemometer', name: '风速风向仪',       cats: ['风速仪损坏', '风向标卡涩', '加热器故障(结冰)', '支架松动', '其他'] },
      { id: 'yaw',        name: '偏航系统',         cats: ['偏航异响', '偏航卡钳渗油', '偏航电机故障', '偏航齿圈断齿/磨损', '扭缆超限', '其他'] },
      { id: 'nacelle',    name: '机舱罩体/天窗',    cats: ['机舱罩开裂/破损', '天窗密封漏水', '罩体固定螺栓松动', '其他'] },
      /* ---- 塔筒/塔基内部（对照现场照片：94/97 号机组） ---- */
      { id: 'tower_lamp', name: '塔内照明/灯管',   cats: ['灯管不亮', '应急灯失效', '照明开关故障', '线路破损', '其他'] },
      { id: 'ladder',     name: '爬梯/防坠导轨',   cats: ['爬梯变形/锈蚀', '防坠导轨卡涩', '爬梯螺栓松动', '安全带挂点缺失', '其他'] },
      { id: 'hoist',      name: '助爬器/提升机',   cats: ['提升机不动作/异响', '钢丝绳磨损/断丝', '控制盒故障', '固定支架松动', '其他'] },
      { id: 'platform',   name: '塔筒平台',        cats: ['平台盖板变形', '护栏缺失/损坏', '平台螺栓松动', '人孔盖板铰链损坏', '其他'] },
      { id: 'tower_cable',name: '塔筒电缆/导电轨', cats: ['电缆缓冲弯变形/拖拽', '电缆固定夹松动/脱落', '电缆绝缘破损', '导电轨打火/烧蚀', '其他'] },
      { id: 'base_floor', name: '塔基平台/地面',   cats: ['花纹钢板锈蚀/变形', '电缆孔盖板缺失', '平台积水/油污', '螺栓/杂物遗留', '其他'] },
      { id: 'electric',   name: '塔底控制柜',      cats: ['变流器故障/报警', '主控系统报警', '柜内端子发热', '柜门密封失效', '加热器/风扇故障', '紧急停机按钮异常', '其他'] },
      { id: 'fire',       name: '消防设施',        cats: ['灭火器过期/压力不足', '灭火器箱缺失/损坏', '消防沙箱异常', '消防报警装置故障', '其他'] },
      { id: 'sign',       name: '安全标识/警示牌', cats: ['标识缺失/破损', '警示牌褪色', '操作规程牌缺失', '其他'] },
      /* ---- 塔筒壁/基础/塔门 ---- */
      { id: 'tower',      name: '塔筒壁/焊缝/防腐', cats: ['塔筒焊缝裂纹', '防腐层脱落/锈蚀', '法兰连接螺栓松动', '塔筒门损坏/密封失效', '其他'] },
      { id: 'foundation', name: '基础',            cats: ['基础环渗水', '基础混凝土开裂', '基础不均匀沉降', '锚栓锈蚀', '接地电阻超标', '其他'] },
      { id: 'other_t',    name: '其他部位',        cats: ['振动监测报警', '消防系统异常', '其他'] }
    ]
  },
  transformer: {
    name: '箱式变压器', icon: '⚡', model3d: 'transformer',
    parts: [
      { id: 'hv_room',    name: '高压室(负荷开关)', cats: ['负荷开关操作卡涩', '熔断器熔断', '带电显示器异常', '电缆肘型头过热', '高压室凝露', '其他'] },
      { id: 'bushing_hv', name: '高压套管/电缆头',  cats: ['套管破损/裂纹', '电缆终端发热', '表面放电痕迹', '渗油', '其他'] },
      { id: 'bushing_lv', name: '低压套管',         cats: ['套管破损', '接线端子发热', '渗油', '其他'] },
      { id: 'tank',       name: '变压器油箱/本体',  cats: ['箱体渗油', '外壳锈蚀', '外壳变形', '焊缝开裂', '运行异响', '其他'] },
      { id: 'radiator',   name: '散热片',           cats: ['散热片渗油', '散热片堵塞/积尘', '散热片锈蚀', '其他'] },
      { id: 'conservator',name: '油枕',             cats: ['油位异常', '油枕渗油', '呼吸器硅胶变色', '其他'] },
      { id: 'buchholz',   name: '气体继电器(瓦斯保护)', cats: ['轻瓦斯告警', '重瓦斯动作跳闸', '继电器渗油', '接线盒进水受潮', '二次接线松脱', '其他'] },
      { id: 'gauge',      name: '油温/油位计',      cats: ['油温异常偏高', '油位计指示异常', '温度计损坏', '压力释放阀动作', '其他'] },
      { id: 'lv_cabinet', name: '低压室(开关柜)',   cats: ['断路器故障', '接触器烧损', '母排发热', '补偿电容鼓包', '指示灯/仪表异常', '其他'] },
      { id: 'enclosure',  name: '箱变外壳/门窗',    cats: ['外壳锈蚀', '箱变门损坏/锁失效', '百叶窗损坏/堵塞', '防小动物措施失效', '外壳凝露', '其他'] },
      { id: 'ground',     name: '接地装置',         cats: ['接地扁铁锈蚀断开', '接地电阻超标', '接地标识缺失', '其他'] },
      { id: 'base_x',     name: '基础/围栏',        cats: ['基础开裂/下沉', '围栏损坏', '周边积水/杂草', '其他'] }
    ]
  },
  /* ---- 二期规划设备类型（界面中置灰显示） ---- */
  line:  { name: '集电线路', icon: '🗼', planned: true, parts: [] },
  tower: { name: '杆塔',     icon: '🗼', planned: true, parts: [] },
  cable: { name: '地埋电缆', icon: '〰️', planned: true, parts: [] }
};

/* 箱变厂家字典（现场仅两种实物，3D 模型按厂家切换）
 * taikai   —— 蓝色三室型，变压器外置于箱体端头，蓝色网格围栏
 * dongmeng —— 蓝白配色、四坡尖顶，油枕与冲孔网板散热器外挂于端头 */
const TRANSFORMER_BRANDS = {
  taikai:   { id: 'taikai',   name: '泰开箱变', short: '泰开', model: 'taikai',
              desc: '蓝色三室结构 · 变压器外置网格围栏' },
  dongmeng: { id: 'dongmeng', name: '东盟箱变', short: '东盟', model: 'dongmeng',
              desc: '蓝白配色四坡顶 · 油枕/冲孔网板散热器外挂' }
};
function brandShort(id) { return (TRANSFORMER_BRANDS[id] || TRANSFORMER_BRANDS.taikai).short; }
function brandName(id) { return (TRANSFORMER_BRANDS[id] || TRANSFORMER_BRANDS.taikai).name; }

/* 工具函数 */
function uid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
}
function todayStr() { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0'); }
function getPart(type, partId) {
  const t = DEVICE_TYPES[type]; if (!t) return null;
  return t.parts.find(p => p.id === partId) || null;
}
function partName(type, partId) { const p = getPart(type, partId); return p ? p.name : (partId || '—'); }
/* 机组健康度：取未闭环缺陷中最高等级；无未闭环 → 良好(绿) */
function unitHealth(defects) {
  let max = 0;
  for (const d of defects) if (d.status !== 'resolved') max = Math.max(max, d.level);
  return max; // 0 = 良好
}
