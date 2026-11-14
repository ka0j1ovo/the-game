/* ============================================================
   The Game · 黄狗国赛事数据中心
   纯前端单页应用：数据存于 localStorage，可导出/导入 JSON
   ============================================================ */

'use strict';

/* ---------------- 常量 ---------------- */
const STORAGE_KEY = 'thegame-data-v1';

const CATEGORY_LABELS = { hupl: 'HUPL席位队伍', secondary: '次级队伍', external: '外赛区队伍' };
const REGIONS = { HO: '红狗国', CH: '橙狗', LV: '绿狗', OP: '剩余赛区', GP: '粉金赛区' };
const TYPE_LABELS = { secondary: '次级赛事', hupl: 'HUPL', international: '国际赛事' };
const FORMAT_LABELS = { group: '小组赛', swiss: '瑞士轮', single: '单败赛制', double: '双败赛制', 'tiered-double': '分级双败', wc: 'WC赛制' };
const WC_SOURCES = ['小世界赛冠军', '世界积分直邀', '地区积分第一', 'world2晋级'];
const REGION_COLORS = { HO: '#a83232', CH: '#e07b3e', LV: '#2e7d4f', OP: '#1e3a5f', GP: '#d85c8e' };
const CATEGORY_COLORS = { hupl: '#c9a227', secondary: '#e6d58a' };
const QUICK_IMPORT = [
  { category: 'external', region: 'HO', teams: ['GLA','SPR','HOE','MRS','LALG','NO1','SOL','LAKS','MX'] },
  { category: 'hupl', teams: ['DRE','FLC','FOR','BOTV','DGE','NF','DOUZ','RBG','DIP','GLX'] },
  { category: 'secondary', teams: ['FOH','exDOUZ','RS','DF','exDREY','FLASH','PSG','VLK','HBDJ','YHZJ'] },
  { category: 'external', region: 'CH', teams: ['ORA','CES','YS','HLS','CDK','FOX','CHG'] },
  { category: 'external', region: 'LV', teams: ['GL','GLO','1NV','LK','ENT','TZ','LF'] },
  { category: 'external', region: 'OP', teams: ['RIV','BS','ISL','PUR','sharks','cloud','GRA','UNG','XY'] },
  { category: 'external', region: 'GP', teams: ['PKY','SUF','WDG','KBG','SKR','MGO','BTW','KG','GOD','XLN'] }
];
function autoColor(category, region){
  if(category === 'hupl') return CATEGORY_COLORS.hupl;
  if(category === 'secondary') return CATEGORY_COLORS.secondary;
  if(category === 'external') return REGION_COLORS[region] || '#8899aa';
  return '#8899aa';
}
const SUBTYPES = {
  secondary:  [['aleague','A-League'], ['promotion','晋升赛'], ['hudl','HUDL']],
  hupl:       [['national','National'], ['thecup','the Cup'], ['leaguecup','League Cup'], ['clash','Clash'], ['other','其他']],
  international: [['worldchampionship','World Championship'], ['world2','World2'], ['series','Series'], ['serieschallenge','Series Challenge'], ['cashcup','Cash Cup'], ['other','其他']]
};
function subtypeLabel(v){ const all=[].concat(...Object.values(SUBTYPES)); const f=all.find(x=>x[0]===v); return f?f[1]:(v||'—'); }

/* ---------------- 状态 ---------------- */
let state;
let view = 'dashboard';
let currentSeasonId = null;
let currentTournamentId = null;
let currentClubId = null;
let editingClubId = null;
let editingSeasonId = null;
let seasonCopyFrom = null;      // 新建赛年时复制的源赛年 id
let tournamentCopyFrom = null;  // 新建赛事时复制的源赛事 id
let filters = { clubCategory: 'all', tournamentType: 'all', tournamentQuery: '' };
let teamPicker = null;       // { target, selected:Set }
let tForm = null;            // 新建赛事临时表单 { formats:[], teams:Set }
let quickFill = { stageId: '', queue: [] };  // 快捷填入：当前阶段与待填队伍队列
let pointsSort = {};         // 积分表排序：'ctx:ownerId' -> 排序列栈（最近的在前）
let teamHistorySort = [];    // 队伍历届成绩排序栈（最近的在前）
let tournamentSort = [];     // 赛事列表排序栈（最近的在前；首页与赛事页共用）
let confirmCallback = null;

/* ---------------- 工具 ---------------- */
function uid(p){ return (p||'x') + '_' + Math.random().toString(36).slice(2,8) + Date.now().toString(36).slice(-3); }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function $(id){ return document.getElementById(id); }
function clone(x){ return x == null ? x : JSON.parse(JSON.stringify(x)); }
function num(v){ const n = parseFloat(v); return isNaN(n) ? 0 : n; }

function getClub(id){ return state.clubs.find(c => c.id === id); }
function getSeason(id){ return state.seasons.find(s => s.id === id); }
function getTournament(id){ return state.tournaments.find(t => t.id === id); }
function clubName(id){ const c = getClub(id); return c ? c.name : '（已删除队伍）'; }
function clubColor(id){ const c = getClub(id); return c ? (c.color || autoColor(c.category, c.region)) : '#8899aa'; }
function clubMatchesQuery(c, q){
  if(!q) return true;
  const hay = ((c.name || '') + ' ' + (c.shortName || '') + ' ' + (c.note || '')).toLowerCase();
  return hay.indexOf(q) >= 0;
}

function categoryBadge(cat){
  const m = { hupl: 'badge-hupl', secondary: 'badge-secondary', external: 'badge-external' }[cat] || 'badge-type';
  return '<span class="badge ' + m + '">' + esc(CATEGORY_LABELS[cat] || cat) + '</span>';
}
function typeBadge(type){
  return '<span class="badge badge-type">' + esc(TYPE_LABELS[type] || type) + '</span>';
}
function teamSwatch(id, showName){
  const c = getClub(id);
  return '<span class="team-swatch"><span class="dot" style="background:' + clubColor(id) + '"></span>' +
    (showName ? esc(clubName(id)) : '') + (c && c.shortName ? ' <span class="muted">(' + esc(c.shortName) + ')</span>' : '') + '</span>';
}

/* ---------------- 存储 ----------------
   分层持久化：IndexedDB 主存（容量大、不易被配额挡住）
              + localStorage 镜像（兼容旧版本、可被导出/诊断）
              + 历史快照（回滚误删/误覆盖）
   每次写入都会留下可追踪的状态；写入失败会常驻提示，而不是只闪 2 秒。
------------------------------------------ */
const STORAGE_META_KEY = 'thegame-meta-v1';
const DB_NAME = 'thegame-db';
const DB_VER = 1;
const KV_STORE = 'kv';
const SNAP_STORE = 'snapshots';
const SNAPDATA_STORE = 'snapshotData';
const KEY_CURRENT = 'current';
const SNAP_LIMIT = 15;                    // 最多保留的历史快照数量
const SNAP_INTERVAL = 5 * 60 * 1000;      // 自动快照最小间隔
const IDB_TIMEOUT = 4000;
const TAB_ID = 'tab_' + Math.random().toString(36).slice(2, 8);

const storage = {
  db: null,
  idbOk: false, idbError: '',
  lsOk: true, lsError: '',
  origin: 'file://',
  lastSavedAt: 0,
  lastLocalAt: 0,
  chars: 0,
  bytes: 0,
  rev: 0,
  snapAt: 0,
  snapCount: 0,
  pendingPayload: null,
  pendingSavedAt: 0,
  writeTimer: null,
  brokenKey: '',
  notice: null,          // { type:'err'|'warn'|'info', html }
  otherTabAt: 0,
  lastAnnounce: 0,
  edited: false,
  idbHydrating: null,
  idbPending: true,
  idbFailed: false,
  loading: true
};

function defaultState(){
  return {
    version: 1,
    meta: { tournamentName: 'The Game', countryName: '黄狗国' },
    clubs: [], seasons: [], tournaments: []
  };
}

function currentOriginLabel(){
  if(location.protocol === 'file:') return 'file://（本地文件）';
  if(location.protocol === 'blob:') return 'blob:（沙箱预览）';
  return location.origin || (location.protocol + '//' + location.host);
}
function fmtBytes(n){
  n = n || 0;
  if(n < 1024) return n + ' B';
  if(n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(2) + ' MB';
}
function pad2(n){ return n < 10 ? '0' + n : '' + n; }
function fmtTime(ts){
  if(!ts) return '—';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  const hm = pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  if(sameDay) return hm;
  return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm;
}
function fmtDateTime(ts){
  if(!ts) return '—';
  const d = new Date(ts);
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' +
    pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
}
function dataCounts(s){
  s = s || state || defaultState();
  let stages = 0, matches = 0, filled = 0;
  (s.tournaments || []).forEach(t => (t.stages || []).forEach(st => {
    stages++;
    (st.matches || []).forEach(m => { matches++; if(m.teamAId || m.teamBId) filled++; });
  }));
  return {
    clubs: (s.clubs || []).length,
    seasons: (s.seasons || []).length,
    tournaments: (s.tournaments || []).length,
    stages: stages,
    matches: matches,
    filledMatches: filled
  };
}
function countsText(c){
  return (c.tournaments || 0) + ' 赛事 · ' + (c.stages || 0) + ' 阶段 · ' + (c.matches || 0) + ' 对局';
}

/* 把任意来源的数据补齐成可用结构，避免旧数据/坏数据导致整页空白 */
function normalizeState(raw){
  const s = Object.assign(defaultState(), raw && typeof raw === 'object' ? raw : {});
  if(!s.meta || typeof s.meta !== 'object') s.meta = { tournamentName: 'The Game', countryName: '黄狗国' };
  else {
    if(!s.meta.tournamentName) s.meta.tournamentName = 'The Game';
    if(!s.meta.countryName) s.meta.countryName = '黄狗国';
  }
  if(!Array.isArray(s.clubs)) s.clubs = [];
  if(!Array.isArray(s.seasons)) s.seasons = [];
  if(!Array.isArray(s.tournaments)) s.tournaments = [];
  s.clubs = s.clubs.filter(c => c && typeof c === 'object');
  s.seasons = s.seasons.filter(x => x && typeof x === 'object');
  s.tournaments = s.tournaments.filter(t => t && typeof t === 'object');
  s.clubs.forEach(c => {
    if(!c.id) c.id = uid('c');
    if(!Array.isArray(c.relatedIds)) c.relatedIds = [];
  });
  s.seasons.forEach(x => {
    if(!x.id) x.id = uid('s');
    if(!x.points || typeof x.points !== 'object') x.points = { stations: [], clubIds: [], data: {} };
    if(!Array.isArray(x.points.stations)) x.points.stations = [];
    if(!Array.isArray(x.points.clubIds)) x.points.clubIds = [];
    if(!x.points.data || typeof x.points.data !== 'object') x.points.data = {};
  });
  s.tournaments.forEach(t => {
    if(!t.id) t.id = uid('t');
    if(!Array.isArray(t.teamIds)) t.teamIds = [];
    if(!Array.isArray(t.stages)) t.stages = [];
    if(!Array.isArray(t.finalStandings)) t.finalStandings = [];
    t.stages.forEach(st => {
      if(!st.id) st.id = uid('stg');
      if(!Array.isArray(st.matches)) st.matches = [];
      if(!st.config || typeof st.config !== 'object') st.config = {};
      st.matches.forEach(m => { if(!m.id) m.id = uid('m'); });
    });
  });
  // 阶段 id 必须全局唯一：复制赛事曾经会留下重复 id，导致编辑到别的赛事里
  const stageIds = new Set();
  s.tournaments.forEach(t => (t.stages || []).forEach(st => {
    if(!st.id || stageIds.has(st.id)) st.id = uid('stg');
    stageIds.add(st.id);
  }));
  return s;
}

/* ---------------- 内置静态数据集 ----------------
   数据固化在 data/seed-data.js（window.THEGAME_SEED，由 tools/build-seed.mjs 生成）。
   每次启动都会把「内置数据里有、但本地缺了」的部分补齐，
   所以即使浏览器存储被清、或者以后重写渲染/赛制代码，原有对阵框架也会回来。
   手动删掉的内置条目会被记到 meta.seedRemoved 里，不会反复复活。
------------------------------------------------ */
function getSeedBundle(){
  const b = (typeof window !== 'undefined') ? window.THEGAME_SEED : null;
  if(!b || !b.data) return null;
  if(!b._state){
    try{
      const copy = JSON.parse(JSON.stringify(b.data));
      b._state = normalizeState(copy);
      b._state.meta = Object.assign({}, b._state.meta, { seedBundle: true });
      b._stats = dataCounts(b._state);
    }catch(e){
      console.warn('内置数据集解析失败', e);
      return null;
    }
  }
  return b;
}
function seedStats(){
  const b = getSeedBundle();
  return b ? (b.stats || dataCounts(b._state)) : null;
}
function seedHasId(id){
  const b = getSeedBundle();
  if(!b || !id) return false;
  const st = b._state;
  if((st.clubs || []).some(x => x.id === id)) return true;
  if((st.seasons || []).some(x => x.id === id)) return true;
  return (st.tournaments || []).some(t => t.id === id ||
    (t.stages || []).some(s => s.id === id || (s.matches || []).some(m => m.id === id)));
}
function seedRemovedSet(s){
  s = s || state;
  if(!s.meta || typeof s.meta !== 'object') s.meta = {};
  if(!Array.isArray(s.meta.seedRemoved)) s.meta.seedRemoved = [];
  return new Set(s.meta.seedRemoved);
}
/* 记录「这是用户主动删掉的」，避免下次启动又被内置数据补回来 */
function rememberSeedId(id){
  if(!id) return;
  const b = getSeedBundle();
  if(!b || !seedHasId(id)) return;
  if(!state.meta || typeof state.meta !== 'object') state.meta = {};
  if(!Array.isArray(state.meta.seedRemoved)) state.meta.seedRemoved = [];
  if(state.meta.seedRemoved.indexOf(id) < 0) state.meta.seedRemoved.push(id);
}

/* ---------------- 重复队伍合并 ----------------
   内置数据和本机旧数据可能是同一批队伍、只是 id 不同。
   这里按「简称 + 全称」把两份合成一份：保留本机原有的记录（颜色/备注不动），
   把内置数据里的队伍 id 记成别名（meta.seedClubAlias），并把所有引用改过去。
------------------------------------------------ */
function clubKey(c){
  return String((c && c.shortName) || '').trim().toLowerCase() + '|' + String((c && c.name) || '').trim().toLowerCase();
}
function seedClubIds(){
  const b = getSeedBundle();
  return b ? new Set((b._state.clubs || []).map(c => c.id)) : new Set();
}
function seedClubAliases(target){
  target = target || state;
  if(!target.meta || typeof target.meta !== 'object') target.meta = {};
  if(!target.meta.seedClubAlias || typeof target.meta.seedClubAlias !== 'object') target.meta.seedClubAlias = {};
  return target.meta.seedClubAlias;
}
function uniq(arr){ return Array.from(new Set(arr)); }
function remapStateClubRefs(map){
  const r = id => (id && map[id]) || id;
  (state.tournaments || []).forEach(t => {
    if(Array.isArray(t.teamIds)) t.teamIds = uniq(t.teamIds.map(r));
    (t.finalStandings || []).forEach(x => { if(x && x.clubId) x.clubId = r(x.clubId); });
    if(t.points && Array.isArray(t.points.clubIds)) t.points.clubIds = uniq(t.points.clubIds.map(r));
    (t.stages || []).forEach(st => {
      if(st.config && Array.isArray(st.config.groups)) st.config.groups.forEach(g => {
        if(Array.isArray(g.teamIds)) g.teamIds = uniq(g.teamIds.map(r));
      });
      if(st.config && st.config.seeds && typeof st.config.seeds === 'object'){
        Object.keys(st.config.seeds).forEach(k => { if(st.config.seeds[k]) st.config.seeds[k] = r(st.config.seeds[k]); });
      }
      (st.matches || []).forEach(m => {
        if(m.teamAId) m.teamAId = r(m.teamAId);
        if(m.teamBId) m.teamBId = r(m.teamBId);
      });
      (st.standings || []).forEach(x => { if(x && x.clubId) x.clubId = r(x.clubId); });
    });
  });
  (state.seasons || []).forEach(s => {
    if(s.points && Array.isArray(s.points.clubIds)) s.points.clubIds = uniq(s.points.clubIds.map(r));
  });
  (state.clubs || []).forEach(c => {
    if(Array.isArray(c.relatedIds)) c.relatedIds = uniq(c.relatedIds.map(r)).filter(id => id !== c.id);
  });
}
/* 把「同一支队伍的两份记录」合成一份，返回合并掉的数量 */
function dedupeSeedClubDuplicates(){
  const seedIds = seedClubIds();
  if(!seedIds.size) return 0;
  const alias = seedClubAliases(state);
  // 先清掉指向已不存在队伍的别名
  Object.keys(alias).forEach(sid => {
    if(!state.clubs.some(c => c.id === alias[sid])) delete alias[sid];
  });
  const localByKey = new Map();
  state.clubs.forEach(c => {
    if(seedIds.has(c.id)) return;                 // 本机原有的那份
    const k = clubKey(c);
    if(k && !localByKey.has(k)) localByKey.set(k, c.id);
  });
  const drop = new Set();
  state.clubs.forEach(c => {
    if(!seedIds.has(c.id)) return;
    const localId = localByKey.get(clubKey(c));
    if(localId && localId !== c.id){
      alias[c.id] = localId;                       // 内置 id → 本机 id
      drop.add(c.id);
    }
  });
  if(!drop.size) return 0;
  state.clubs = state.clubs.filter(c => !drop.has(c.id));
  remapStateClubRefs(alias);
  return drop.size;
}

/* 把内置数据合并进当前数据：只补缺失，不覆盖已有内容 */
function mergeSeedData(target, seed){
  const removed = seedRemovedSet(target);
  let added = 0, restored = 0;
  const hasId = (arr, id) => (arr || []).some(x => x && x.id === id);

  // 同一支队伍在本地可能已经存在、只是 id 不同（例如早期用「快速导入」建的）。
  // 这里按简称/名字建立「内置 id → 本地 id」映射，避免合并后出现两份同名队伍，
  // 同时把内置赛事里的队伍引用改到本地 id 上。
  const norm = s => String(s == null ? '' : s).trim().toLowerCase();
  const localByKey = new Map();
  (target.clubs || []).forEach(c => {
    [norm(c.shortName), norm(c.name)].forEach(k => { if(k && !localByKey.has(k)) localByKey.set(k, c.id); });
  });
  const alias = seedClubAliases(target);
  const clubIdMap = new Map();
  Object.keys(alias).forEach(sid => {
    if(hasId(target.clubs, alias[sid])) clubIdMap.set(sid, alias[sid]);
    else delete alias[sid];
  });
  (seed.clubs || []).forEach(c => {
    if(hasId(target.clubs, c.id)) return;
    if(clubIdMap.has(c.id)) return;
    const localId = localByKey.get(norm(c.shortName)) || localByKey.get(norm(c.name));
    if(localId && localId !== c.id){
      clubIdMap.set(c.id, localId);
      alias[c.id] = localId;
    }
  });
  const remapClubRefs = obj => {
    const r = id => clubIdMap.get(id) || id;
    if(Array.isArray(obj.teamIds)) obj.teamIds = obj.teamIds.map(r);
    if(Array.isArray(obj.finalStandings)) obj.finalStandings.forEach(x => { if(x && x.clubId) x.clubId = r(x.clubId); });
    if(obj.points && Array.isArray(obj.points.clubIds)) obj.points.clubIds = obj.points.clubIds.map(r);
    (obj.stages || []).forEach(st => {
      if(st.config && Array.isArray(st.config.groups)) st.config.groups.forEach(g => {
        if(Array.isArray(g.teamIds)) g.teamIds = g.teamIds.map(r);
      });
      if(st.config && st.config.seeds && typeof st.config.seeds === 'object'){
        Object.keys(st.config.seeds).forEach(k => { if(st.config.seeds[k]) st.config.seeds[k] = r(st.config.seeds[k]); });
      }
      (st.matches || []).forEach(m => {
        if(m.teamAId) m.teamAId = r(m.teamAId);
        if(m.teamBId) m.teamBId = r(m.teamBId);
      });
      (st.standings || []).forEach(x => { if(x && x.clubId) x.clubId = r(x.clubId); });
    });
    return obj;
  };
  const seedTournamentCopy = t => remapClubRefs(clone(t));

  (seed.clubs || []).forEach(c => {
    if(removed.has(c.id)) return;
    if(clubIdMap.has(c.id)) return;            // 本地已有同名队伍，不重复添加
    if(!hasId(target.clubs, c.id)){ target.clubs.push(clone(c)); added++; }
  });
  (seed.seasons || []).forEach(s => {
    if(removed.has(s.id)) return;
    if(!hasId(target.seasons, s.id)){ target.seasons.push(clone(s)); added++; }
  });
  (seed.tournaments || []).forEach(t => {
    if(removed.has(t.id)) return;
    const local = (target.tournaments || []).find(x => x.id === t.id);
    if(!local){
      target.tournaments.push(seedTournamentCopy(t));
      added++;
      return;
    }
    if(!Array.isArray(local.stages)) local.stages = [];
    (t.stages || []).forEach(st => {
      if(removed.has(st.id)) return;
      const lst = local.stages.find(x => x.id === st.id);
      if(!lst){ local.stages.push(remapClubRefs(clone(st))); restored++; return; }
      if(!Array.isArray(lst.matches)) lst.matches = [];
      (st.matches || []).forEach(m => {
        if(removed.has(m.id)) return;
        if(!lst.matches.some(x => x && x.id === m.id)){ lst.matches.push(remapClubRefs(clone({ stages: [{ matches: [m] }] })).stages[0].matches[0]); restored++; }
      });
      // 分组 / 轮数等配置只在缺失时补
      if(st.config && typeof st.config === 'object'){
        if(!lst.config || typeof lst.config !== 'object') lst.config = {};
        if(Array.isArray(st.config.groups) && !Array.isArray(lst.config.groups)) lst.config.groups = clubIdMap.size ? remapClubRefs(clone({ stages: [{ config: { groups: st.config.groups } }] })).stages[0].config.groups : clone(st.config.groups);
        if(st.config.rounds && !lst.config.rounds) lst.config.rounds = st.config.rounds;
        if(st.config.seeds && !lst.config.seeds){
          lst.config.seeds = remapClubRefs(clone({ stages: [{ config: { seeds: st.config.seeds } }] })).stages[0].config.seeds;
        }
      }
    });
  });
  return { added, restored };
}

/* 启动时补齐内置数据；返回是否改动了 state */
function applySeedOnBoot(){
  const b = getSeedBundle();
  if(!b) return false;
  if(state.meta && state.meta.seedAutoMerge === false) return false;
  let changed = false;
  if(!hasAnyData(state)){
    state = normalizeState(clone(b._state));
    state.meta.seedBundle = true;
    changed = true;
  } else {
    // 先把「同一支队伍的两份记录」合成一份，再补缺失，避免队伍数量翻倍
    try{
      if(dedupeSeedClubDuplicates() > 0) changed = true;
    }catch(e){ console.warn('重复队伍合并失败', e); }
    const r = mergeSeedData(state, b._state);
    if((r.added + r.restored) > 0) changed = true;
  }
  if(!state.meta || typeof state.meta !== 'object') state.meta = {};
  if(state.meta.seedVersion !== b.version){ state.meta.seedVersion = b.version; changed = true; }
  if(changed){
    try{ saveState(); }catch(e){ console.warn('内置数据写入失败', e); }
  }
  return changed;
}

function seedMergeNow(){
  const b = getSeedBundle();
  if(!b){ toast('没有内置数据集', 'err'); return; }
  const dup = dedupeSeedClubDuplicates();
  const r = mergeSeedData(state, b._state);
  state.meta.seedVersion = b.version;
  saveState();
  renderStoragePanel();
  go(view);
  toast('内置数据已补齐：新增 ' + r.added + ' 项，补回 ' + r.restored + ' 条阶段/对局' +
    (dup ? '，合并重复队伍 ' + dup + ' 支' : ''));
}
function seedReplaceAll(){
  const b = getSeedBundle();
  if(!b){ toast('没有内置数据集', 'err'); return; }
  const c = dataCounts(b._state);
  confirmDialog('用内置数据覆盖',
    '将用内置数据集覆盖当前数据（会先自动存一份快照）。\n' + countsText(c) + '\n确定继续吗？', async () => {
      await takeSnapshot('覆盖内置数据前');
      state = normalizeState(clone(b._state));
      state.meta.seedBundle = true;
      state.meta.seedRemoved = [];
      state.meta.seedClubAlias = {};
      state.meta.seedVersion = b.version;
      state.meta.seedAutoMerge = true;
      saveState();
      currentSeasonId = null; currentTournamentId = null; currentClubId = null;
      closeModal('modal-storage');
      go('dashboard');
      toast('已用内置数据覆盖', 'ok');
    });
}
function dedupeClubsNow(){
  const n = dedupeSeedClubDuplicates();
  if(!n){ toast('没有发现重复队伍'); return; }
  saveState();
  renderStoragePanel();
  go(view);
  toast('已合并 ' + n + ' 支重复队伍', 'ok');
}
function seedToggleAuto(){
  state.meta.seedAutoMerge = (state.meta.seedAutoMerge === false);
  saveState();
  renderStoragePanel();
  toast(state.meta.seedAutoMerge ? '已开启启动时自动补齐内置数据' : '已关闭启动时自动补齐');
}
function downloadSeed(){
  const b = getSeedBundle();
  if(!b){ toast('没有内置数据集', 'err'); return; }
  downloadJson(b.data, 'thegame-seed-data.json');
}
function downloadJson(obj, filename){
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
}

/* ---------------- IndexedDB 低层 ---------------- */
let dbPromise = null;
function openDb(){
  if(dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if(!window.indexedDB){ reject(new Error('浏览器不支持或已禁用 IndexedDB')); return; }
    let settled = false;
    const timer = setTimeout(() => {
      if(settled) return;
      settled = true;
      reject(new Error('打开超时（可能被浏览器安全策略阻止）'));
    }, IDB_TIMEOUT);
    let req;
    try{ req = indexedDB.open(DB_NAME, DB_VER); }
    catch(e){ clearTimeout(timer); settled = true; reject(e); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains(KV_STORE)) db.createObjectStore(KV_STORE);
      if(!db.objectStoreNames.contains(SNAP_STORE)){
        const os = db.createObjectStore(SNAP_STORE, { keyPath: 'id', autoIncrement: true });
        os.createIndex('ts', 'ts');
      }
      if(!db.objectStoreNames.contains(SNAPDATA_STORE)) db.createObjectStore(SNAPDATA_STORE);
    };
    req.onsuccess = () => {
      if(settled) return;
      settled = true; clearTimeout(timer);
      const db = req.result;
      db.onversionchange = () => { try{ db.close(); }catch(e){} };
      resolve(db);
    };
    req.onerror = () => {
      if(settled) return;
      settled = true; clearTimeout(timer);
      reject(req.error || new Error('IndexedDB 打开失败'));
    };
    req.onblocked = () => {
      if(settled) return;
      settled = true; clearTimeout(timer);
      reject(new Error('IndexedDB 被其他标签页占用'));
    };
  }).catch(e => {
    storage.idbError = (e && e.message) || String(e);
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}
function idbGet(store, key){
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const rq = tx.objectStore(store).get(key);
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error || new Error('读取失败'));
  }));
}
function idbPut(store, key, value){
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    const rq = key === null ? os.put(value) : os.put(value, key);
    tx.oncomplete = () => resolve(rq.result);
    tx.onerror = () => reject(tx.error || rq.error || new Error('写入失败'));
    tx.onabort = () => reject(tx.error || new Error('写入被中止'));
  }));
}
function idbDelete(store, key){
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error || new Error('删除失败'));
  }));
}
function idbGetAll(store){
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const rq = tx.objectStore(store).getAll();
    rq.onsuccess = () => resolve(rq.result || []);
    rq.onerror = () => reject(rq.error || new Error('读取失败'));
  }));
}

/* ---------------- 启动读取 ----------------
   先用 localStorage 同步把界面拉起来，IndexedDB 在后台补齐：
   某些环境（隐私模式 / 旧版浏览器 / 沙箱预览）IndexedDB 会卡住不回调，
   绝不能让它挡住首屏渲染。
------------------------------------------ */
function storageInit(){
  storage.origin = currentOriginLabel();
  let lsRaw = null, lsState = null, lsSavedAt = 0, brokenRaw = '';
  try{
    lsRaw = localStorage.getItem(STORAGE_KEY);
    storage.lsOk = true;
  }catch(e){
    storage.lsOk = false;
    storage.lsError = (e && e.message) || String(e);
  }
  if(lsRaw){
    try{
      lsState = JSON.parse(lsRaw);
      lsSavedAt = readMetaSavedAt();
    }catch(e){
      brokenRaw = lsRaw;
      storage.notice = {
        type: 'err',
        html: '本机存档（localStorage）内容已损坏，无法直接读取。原始内容已另存备份，请打开「存储与备份」从历史快照恢复，或导入之前导出的 JSON。'
      };
    }
  }

  if(brokenRaw){
    try{
      storage.brokenKey = STORAGE_KEY + '.broken.' + Date.now();
      localStorage.setItem(storage.brokenKey, brokenRaw);
    }catch(e){ /* 空间不够就放弃另存 */ }
  }

  state = normalizeState(lsState);
  storage.loadSource = lsState ? 'localStorage' : '新建';
  storage.loading = false;
  storage.lastSavedAt = lsSavedAt || 0;
  storage.chars = lsRaw ? lsRaw.length : 0;
  updateStoragePill();

  // 后台尝试 IndexedDB（不阻塞首屏）
  storage.idbHydrating = hydrateIdb(lsSavedAt);
}

/* 后台：连接 IndexedDB，取更完整/更新的记录，并把当前数据补写进去 */
async function hydrateIdb(bootLsAt){
  // IndexedDB 某些环境下会「永不回调」，这里加一道兜底，避免一直显示"正在连接"
  const watchdog = setTimeout(() => {
    if(storage.idbOk) return;
    storage.idbPending = false;
    storage.idbFailed = true;
    storage.idbError = storage.idbError || '长时间无响应（可能被浏览器禁用）';
    updateStoragePill();
    if(storage.lsOk && hasAnyData(state)){
      showStorageAlert('warn',
        'IndexedDB 未能启动（' + esc(storage.idbError) + '），目前使用 localStorage 保存（约 5 MB 上限）。功能不受影响，建议定期导出备份。');
    }
    refreshStoragePanelIfOpen();
  }, 6000);
  try{
    await openDb();
    storage.idbOk = true;
    storage.idbError = '';
    storage.idbPending = false;
    storage.idbFailed = false;
  }catch(e){
    clearTimeout(watchdog);
    storage.idbOk = false;
    storage.idbPending = false;
    storage.idbFailed = true;
    storage.idbError = (e && e.message) || String(e) || '未知原因';
    updateStoragePill();
    if(storage.lsOk && hasAnyData(state)){
      showStorageAlert('warn',
        'IndexedDB 不可用（' + esc(storage.idbError) + '），当前使用 localStorage 保存（约 5 MB 上限）。功能不受影响，建议定期导出。');
    }
    refreshStoragePanelIfOpen();
    return;
  }
  clearTimeout(watchdog);
  updateStoragePill();

  // 1) IndexedDB 里有比 localStorage 更新的数据 → 采用它（用户还没动手编辑时）
  try{
    const rec = await idbGet(KV_STORE, KEY_CURRENT);
    if(rec && rec.data && !storage.edited && hasAnyData(rec.data) && (rec.savedAt || 0) > (bootLsAt || 0) + 1000){
      state = normalizeState(rec.data);
      storage.loadSource = 'IndexedDB';
      storage.lastSavedAt = rec.savedAt || Date.now();
      storage.rev = Math.max(storage.rev, rec.rev || 0);
      persistToLocalStorage();
      go(view);
      updateStoragePill();
    }
  }catch(e){ /* 读取失败就继续用 localStorage 的数据 */ }

  // 2) 保证 IndexedDB 主存和当前数据一致（首次使用时相当于迁移）
  try{
    const payload = JSON.stringify(state);
    await idbPut(KV_STORE, KEY_CURRENT, {
      savedAt: storage.lastSavedAt || Date.now(),
      rev: storage.rev,
      origin: storage.origin,
      chars: payload.length,
      data: JSON.parse(payload)
    });
    storage.idbError = '';
  }catch(e){
    storage.idbError = (e && e.message) || String(e);
    updateStoragePill();
  }

  // 3) 快照信息
  try{
    const snaps = await idbGetAll(SNAP_STORE);
    storage.snapCount = snaps.length;
    storage.snapAt = snaps.reduce((m, x) => Math.max(m, x.ts || 0), 0);
    if(storage.snapCount && !hasAnyData(state) && !storage.edited){
      showStorageAlert('warn',
        '当前数据是空的，但检测到 <b>' + storage.snapCount + '</b> 个历史快照（最近一次：' + fmtDateTime(storage.snapAt) +
        '）。可能是浏览器数据被清理或换了一种打开方式，建议从快照恢复。');
    }
    // 第一次使用（尤其是刚载入内置数据）先留一份基线快照
    if(!storage.snapCount && hasAnyData(state)){
      takeSnapshot('初始');
    }
  }catch(e){ storage.snapCount = 0; }
  updateStoragePill();
  refreshStoragePanelIfOpen();
}
function refreshStoragePanelIfOpen(){
  const m = $('modal-storage');
  if(m && m.classList.contains('open')) renderStoragePanel();
}

function persistToLocalStorage(){
  try{
    const raw = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, raw);
    localStorage.setItem(STORAGE_META_KEY, JSON.stringify({ savedAt: storage.lastSavedAt || Date.now(), rev: storage.rev, origin: storage.origin }));
    storage.lsOk = true; storage.lsError = '';
    storage.chars = raw.length;
    storage.lastLocalAt = Date.now();
  }catch(e){
    storage.lsOk = false;
    storage.lsError = (e && e.message) || String(e);
  }
  updateStoragePill();
}

function hasAnyData(s){
  return !!(s && ((s.clubs || []).length || (s.seasons || []).length || (s.tournaments || []).length));
}
function readMetaSavedAt(){
  try{
    const meta = JSON.parse(localStorage.getItem(STORAGE_META_KEY) || 'null');
    return (meta && meta.savedAt) || 0;
  }catch(e){ return 0; }
}

/* ---------------- 写入 ---------------- */
function saveState(){
  if(!state) state = defaultState();
  storage.rev++;
  storage.edited = true;
  const now = Date.now();
  let payload;
  try{
    payload = JSON.stringify(state);
  }catch(e){
    showStorageAlert('err', '数据序列化失败（可能含有无法保存的内容）：' + esc((e && e.message) || e));
    return;
  }
  storage.chars = payload.length;
  storage.bytes = payload.length * 2;
  storage.lastSavedAt = now;

  // 1) localStorage 镜像：同步写入，关掉页面也不会丢最后一步
  let lsErr = null;
  try{
    localStorage.setItem(STORAGE_KEY, payload);
    localStorage.setItem(STORAGE_META_KEY, JSON.stringify({ savedAt: now, rev: storage.rev, origin: storage.origin }));
    storage.lsOk = true; storage.lsError = '';
    storage.lastLocalAt = now;
  }catch(e){
    lsErr = e;
    storage.lsOk = false;
    storage.lsError = (e && e.name === 'QuotaExceededError')
      ? 'localStorage 容量已满（约 5 MB）'
      : ((e && e.message) || String(e));
  }

  // 2) IndexedDB 主存：防抖写入，避免连续编辑卡顿
  scheduleIdbWrite(payload, now);

  if(lsErr && !storage.idbOk){
    showStorageAlert('err',
      '数据写入失败：' + esc(storage.lsError) + '。当前修改只存在于这个页面里，<b>关闭页面就会丢失</b>，请立即导出备份。');
  } else if(lsErr){
    showStorageAlert('warn',
      '浏览器 localStorage 写入失败（' + esc(storage.lsError) + '），已自动改用 IndexedDB 主存，数据仍会保存。建议导出一次备份。');
  } else {
    if(!storage.otherTabAt || now - storage.otherTabAt > 30000) hideStorageAlert();
  }
  updateStoragePill();
  announceSave(now);
  maybeSnapshot(now);
}

function scheduleIdbWrite(payload, savedAt){
  if(!storage.idbOk){ return; }
  storage.pendingPayload = payload;
  storage.pendingSavedAt = savedAt;
  if(storage.writeTimer) clearTimeout(storage.writeTimer);
  storage.writeTimer = setTimeout(() => { storage.writeTimer = null; flushIdbWrite(); }, 250);
}
function flushIdbWrite(){
  const payload = storage.pendingPayload;
  if(payload == null) return Promise.resolve();
  storage.pendingPayload = null;
  let data;
  try{ data = JSON.parse(payload); }
  catch(e){ return Promise.resolve(); }
  return idbPut(KV_STORE, KEY_CURRENT, {
    savedAt: storage.pendingSavedAt || Date.now(),
    rev: storage.rev,
    origin: storage.origin,
    chars: payload.length,
    data: data
  }).then(() => {
    storage.idbOk = true; storage.idbError = '';
    updateStoragePill();
  }).catch(e => {
    storage.idbError = (e && e.message) || String(e);
    // 连接可能已失效：丢弃缓存的连接，下一次写入自动重连
    try{ if(dbPromise) dbPromise.then(db => { try{ db.close(); }catch(err){} }).catch(() => {}); }catch(err){}
    dbPromise = null;
    if(storage.lsOk) showStorageAlert('warn', 'IndexedDB 写入失败（' + esc(storage.idbError) + '），当前使用 localStorage 镜像保存。');
    else showStorageAlert('err', '两种存储都写入失败：' + esc(storage.idbError) + '。请立即导出备份。');
    updateStoragePill();
  });
}
function flushPendingSave(){
  if(storage.writeTimer){ clearTimeout(storage.writeTimer); storage.writeTimer = null; }
  if(storage.pendingPayload != null) flushIdbWrite();
}

/* ---------------- 快照 ---------------- */
function maybeSnapshot(now){
  if(storage.loading) return;
  if(!storage.idbOk) return;
  if(now - storage.snapAt < SNAP_INTERVAL) return;
  storage.snapAt = now;
  takeSnapshot('自动');
}
async function takeSnapshot(reason){
  if(!storage.idbOk){
    if(storage.idbFailed){
      toast('IndexedDB 不可用，无法创建快照；请用「导出」保存备份', 'err');
      return null;
    }
    try{ await openDb(); storage.idbOk = true; storage.idbFailed = false; }
    catch(e){ toast('无法创建快照：' + ((e && e.message) || e), 'err'); return null; }
  }
  const now = Date.now();
  let payload;
  try{ payload = JSON.stringify(state); }
  catch(e){ toast('快照失败：数据无法序列化', 'err'); return null; }
  const meta = {
    ts: now,
    reason: reason || '手动',
    origin: storage.origin,
    counts: dataCounts(state),
    chars: payload.length
  };
  try{
    const id = await idbPut(SNAP_STORE, null, meta);
    await idbPut(SNAPDATA_STORE, id, JSON.parse(payload));
    storage.snapCount++;
    storage.snapAt = now;
    await pruneSnapshots();
    if(reason && reason !== '自动') toast('已创建快照');
    return id;
  }catch(e){
    toast('快照失败：' + ((e && e.message) || e), 'err');
    return null;
  }
  finally{
    refreshStoragePanelIfOpen();
  }
}
async function pruneSnapshots(){
  try{
    const all = await idbGetAll(SNAP_STORE);
    all.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    while(all.length > SNAP_LIMIT){
      const old = all.shift();
      await idbDelete(SNAP_STORE, old.id);
      try{ await idbDelete(SNAPDATA_STORE, old.id); }catch(e){}
    }
    storage.snapCount = all.length;
  }catch(e){ /* 清理失败不影响主流程 */ }
}
async function listSnapshots(){
  if(!storage.idbOk){
    if(storage.idbFailed) return [];
    try{ await openDb(); storage.idbOk = true; storage.idbFailed = false; }
    catch(e){ return []; }
  }
  const all = await idbGetAll(SNAP_STORE);
  all.sort((a, b) => (b.ts || 0) - (a.ts || 0));
  storage.snapCount = all.length;
  return all;
}
async function restoreSnapshot(id){
  let data;
  try{ data = await idbGet(SNAPDATA_STORE, id); }
  catch(e){ toast('快照读取失败：' + ((e && e.message) || e), 'err'); return; }
  if(!data){ toast('快照内容已丢失', 'err'); return; }
  confirmDialog('恢复历史快照',
    '将用该快照覆盖当前数据（当前数据会先自动存一份快照）。\n' + countsText(dataCounts(data)) + '\n\n确定恢复吗？',
    async () => {
      await takeSnapshot('恢复前');
      state = normalizeState(data);
      saveState();
      currentSeasonId = null; currentTournamentId = null; currentClubId = null;
      closeModal('modal-storage');
      go('dashboard');
      toast('已恢复到所选快照', 'ok');
    });
}

/* ---------------- 存储状态 UI ---------------- */
function updateStoragePill(){
  const pill = $('storage-pill');
  if(!pill) return;
  const txt = $('storage-pill-text');
  let cls = 'ok', label = '';
  const bothOk = storage.lsOk && storage.idbOk;
  if(!storage.lsOk && !storage.idbOk && !storage.idbPending){
    cls = 'err'; label = '未保存';
  } else if(storage.lastSavedAt){
    label = '已保存 ' + fmtTime(storage.lastSavedAt);
    if(!bothOk && !storage.idbPending) cls = 'warn';
  } else {
    label = bothOk ? '存储就绪' : (storage.idbPending && storage.lsOk ? '已就绪' : '兼容模式');
    if(!bothOk && !storage.idbPending) cls = 'warn';
  }
  pill.className = 'storage-pill ' + cls;
  if(txt) txt.textContent = label;
  pill.title = '存储状态：' + label + '\n当前地址：' + storage.origin +
    '\nIndexedDB：' + (storage.idbOk ? '可用' : (storage.idbPending ? '连接中…' : '不可用' + (storage.idbError ? '（' + storage.idbError + '）' : ''))) +
    '\nlocalStorage：' + (storage.lsOk ? '可用' : '不可用' + (storage.lsError ? '（' + storage.lsError + '）' : ''));
}
function showStorageAlert(type, html){
  const el = $('storage-alert');
  if(!el) return;
  el.className = 'storage-alert ' + type;
  el.innerHTML = '<span class="sa-icon">' + (type === 'err' ? '⚠' : type === 'warn' ? '!' : 'i') + '</span>' +
    '<span class="sa-text">' + html + '</span>' +
    '<button class="btn btn-sm" onclick="openStoragePanel()">存储与备份</button>' +
    '<button class="btn btn-sm btn-danger-text" onclick="exportData()">立即导出</button>' +
    '<span class="sa-close" onclick="hideStorageAlert()" title="关闭">×</span>';
  el.style.display = '';
}
function hideStorageAlert(){
  const el = $('storage-alert');
  if(el) el.style.display = 'none';
}
function showStorageNotice(){
  if(storage.notice){
    showStorageAlert(storage.notice.type || 'info', storage.notice.html);
    storage.notice = null;
    return;
  }
  // 只提示「已确认」的问题；IndexedDB 还在连接中不算异常
  if(!storage.lsOk && hasAnyData(state)){
    showStorageAlert('err',
      'localStorage 不可用（' + esc(storage.lsError || '未知原因') + '）。如果 IndexedDB 可用数据仍会保存，否则请立即导出备份。');
  } else if(storage.idbFailed && hasAnyData(state)){
    showStorageAlert('warn',
      'IndexedDB 不可用（' + esc(storage.idbError || '未知原因') + '），当前使用 localStorage 保存（约 5 MB 上限）。功能不受影响，建议定期导出。');
  }
}

/* ---------------- 存储面板 ---------------- */
function openStoragePanel(){
  openModal('modal-storage');
  renderStoragePanel();
}
async function renderStoragePanel(){
  const body = $('storage-panel-body');
  if(!body) return;
  const c = dataCounts(state);
  const usedChars = storage.chars || JSON.stringify(state).length;
  let html = '';
  html += '<div class="store-grid">' +
    kvHtml('保存位置', esc(storage.origin)) +
    kvHtml('数据规模', esc(countsText(c))) +
    kvHtml('当前大小', fmtBytes(usedChars * 2) + ' <span class="muted">(' + usedChars.toLocaleString() + ' 字符)</span>') +
    kvHtml('上次保存', storage.lastSavedAt ? fmtDateTime(storage.lastSavedAt) : '尚未保存') +
    kvHtml('存储引擎', (storage.idbOk ? '<span class="ok-text">IndexedDB 主存</span>' : (storage.idbPending ? '<span class="muted">IndexedDB 连接中…</span>' : '<span class="warn-text">IndexedDB 不可用</span>')) +
      ' ＋ ' + (storage.lsOk ? '<span class="ok-text">localStorage 镜像</span>' : '<span class="warn-text">localStorage 不可用</span>')) +
    kvHtml('浏览器配额', '<span id="store-quota">—</span>') +
    kvHtml('历史快照', '<span id="store-snapcount">' + (storage.snapCount || 0) + '</span> 个') +
    kvHtml('启动来源', esc(storage.loadSource || '—')) +
    '</div>';
  if(storage.idbError || storage.lsError){
    html += '<div class="store-errs">' +
      (storage.idbError ? '<div>IndexedDB：' + esc(storage.idbError) + '</div>' : '') +
      (storage.lsError ? '<div>localStorage：' + esc(storage.lsError) + '</div>' : '') +
      '</div>';
  }
  html += '<p class="muted store-tip">数据属于「当前浏览器 + 当前打开地址」。用 file:// 打开和用 GitHub Pages / 本地服务器打开，会是相互独立的两份数据——需要带走数据时，请用「导出」再在另一处「导入」。</p>';
  html += '<div class="store-actions">' +
    '<button class="btn btn-sm btn-primary" onclick="takeSnapshot(\'手动\')">立即快照</button>' +
    '<button class="btn btn-sm" onclick="exportData()">导出 JSON</button>' +
    '<button class="btn btn-sm" onclick="triggerImport()">导入 JSON</button>' +
    '<button class="btn btn-sm" onclick="renderStoragePanel()">刷新</button>' +
    '</div>';

  // 内置静态数据集（写死在 data/seed-data.js 里，清缓存/换架构都不影响）
  const seedBundle = getSeedBundle();
  if(seedBundle){
    const sc = seedBundle.stats || dataCounts(seedBundle._state);
    const auto = !(state.meta && state.meta.seedAutoMerge === false);
    html += '<h4 class="snap-title">内置数据集 <span class="muted" style="font-weight:400">（随网站一起发布，不依赖浏览器存储）</span></h4>';
    html += '<div class="store-grid">' +
      kvHtml('名称 / 版本', esc(seedBundle.name || '内置数据集') + ' <span class="muted">' + esc(seedBundle.version || '') + '</span>') +
      kvHtml('规模', esc(countsText(sc)) + ' · ' + sc.clubs + ' 队伍 · ' + sc.seasons + ' 赛年') +
      kvHtml('启动时自动补齐', auto ? '<span class="ok-text">已开启</span>' : '<span class="warn-text">已关闭</span>') +
      kvHtml('生成时间', seedBundle.generatedAt ? fmtDateTime(Date.parse(seedBundle.generatedAt)) : '—') +
      '</div>';
    html += '<div class="store-actions">' +
      '<button class="btn btn-sm btn-primary" onclick="seedMergeNow()">补齐缺失数据</button>' +
      '<button class="btn btn-sm" onclick="seedReplaceAll()">用内置数据覆盖</button>' +
      '<button class="btn btn-sm" onclick="dedupeClubsNow()">合并重复队伍</button>' +
      '<button class="btn btn-sm" onclick="seedToggleAuto()">' + (auto ? '关闭自动补齐' : '开启自动补齐') + '</button>' +
      '<button class="btn btn-sm" onclick="downloadSeed()">下载内置 JSON</button>' +
      '</div>';
  }

  html += '<h4 class="snap-title">历史快照（最多 ' + SNAP_LIMIT + ' 个，自动每 ' + (SNAP_INTERVAL / 60000) + ' 分钟一份）</h4>' +
    '<div id="store-snaps"><div class="muted" style="padding:6px 2px">正在读取快照…</div></div>';
  body.innerHTML = html;

  // 面板先出来，耗时信息（配额 / 快照）异步补上，避免 IndexedDB 卡住整个弹窗
  fillStoragePanelAsync();
}
async function fillStoragePanelAsync(){
  try{
    if(navigator.storage && navigator.storage.estimate){
      const e = await Promise.race([navigator.storage.estimate(), new Promise(r => setTimeout(() => r(null), 1500))]);
      const el = $('store-quota');
      if(el && e && e.quota) el.innerHTML = fmtBytes(e.usage || 0) + ' / ' + fmtBytes(e.quota);
    }
  }catch(e){}
  let snaps = null;
  if(storage.idbOk || !storage.idbFailed){
    snaps = await Promise.race([listSnapshots().catch(() => []), new Promise(r => setTimeout(() => r(null), 2500))]);
  } else {
    snaps = [];
  }
  const el = $('store-snaps');
  if(!el) return;
  if(snaps === null){
    el.innerHTML = '<div class="empty" style="padding:18px">IndexedDB 响应较慢，快照暂时读不出来；可点「刷新」重试，或先导出 JSON 备份。</div>';
    return;
  }
  const cnt = $('store-snapcount');
  if(cnt) cnt.textContent = snaps.length;
  if(!storage.idbOk){
    el.innerHTML = '<div class="empty" style="padding:18px">' +
      (storage.idbPending ? 'IndexedDB 正在连接，稍后刷新即可看到快照。' : '当前环境无法使用 IndexedDB，历史快照不可用。请用「导出 JSON」保存备份。') +
      '</div>';
    return;
  }
  if(!snaps.length){
    el.innerHTML = '<div class="empty" style="padding:18px">还没有历史快照。点击「立即快照」可手动保存一份。</div>';
    return;
  }
  let html = '<div class="table-wrap"><table class="plain"><thead><tr><th>时间</th><th>来源</th><th>规模</th><th style="width:120px">操作</th></tr></thead><tbody>';
  snaps.forEach(sn => {
    html += '<tr>' +
      '<td class="nowrap">' + fmtDateTime(sn.ts) + '</td>' +
      '<td>' + esc(sn.reason || '—') + '</td>' +
      '<td class="nowrap">' + countsText(sn.counts || {}) + ' · ' + fmtBytes((sn.chars || 0) * 2) + '</td>' +
      '<td class="nowrap"><button class="btn btn-sm" onclick="restoreSnapshot(' + sn.id + ')">恢复</button> ' +
      '<button class="btn btn-sm btn-danger-text" onclick="deleteSnapshot(' + sn.id + ')">删</button></td></tr>';
  });
  html += '</tbody></table></div>';
  el.innerHTML = html;
}
function kvHtml(k, v){
  return '<div class="kv"><span class="kv-k">' + k + '</span><span class="kv-v">' + v + '</span></div>';
}
async function deleteSnapshot(id){
  confirmDialog('删除快照', '确定删除这条历史快照吗？', async () => {
    try{ await idbDelete(SNAP_STORE, id); }catch(e){}
    try{ await idbDelete(SNAPDATA_STORE, id); }catch(e){}
    renderStoragePanel();
    toast('已删除快照');
  });
}

/* ---------------- 多标签页保护 ---------------- */
let syncChannel = null;
function initMultiTabGuard(){
  try{
    if(typeof BroadcastChannel === 'function'){
      syncChannel = new BroadcastChannel('thegame-sync');
      syncChannel.onmessage = ev => {
        const d = ev.data || {};
        if(d.type !== 'save' || d.tab === TAB_ID) return;
        onOtherTabSave(d.savedAt || Date.now());
      };
    }
  }catch(e){ syncChannel = null; }
  window.addEventListener('storage', e => {
    if(e.key === STORAGE_KEY && e.newValue) onOtherTabSave(Date.now());
  });
  window.addEventListener('pagehide', () => { flushPendingSave(); });
  document.addEventListener('visibilitychange', () => { if(document.visibilityState === 'hidden') flushPendingSave(); });
}
function announceSave(now){
  if(!syncChannel) return;
  if(now - storage.lastAnnounce < 1500) return;
  storage.lastAnnounce = now;
  try{ syncChannel.postMessage({ type: 'save', tab: TAB_ID, savedAt: now, counts: dataCounts(state) }); }catch(e){}
}
function onOtherTabSave(ts){
  if(ts && ts <= storage.lastSavedAt + 1000) return;
  storage.otherTabAt = ts || Date.now();
  const el = $('storage-alert');
  if(!el) return;
  el.className = 'storage-alert warn';
  el.innerHTML = '<span class="sa-icon">!</span>' +
    '<span class="sa-text">另一个标签页刚刚保存了更新的数据。继续在本页编辑可能覆盖它。</span>' +
    '<button class="btn btn-sm btn-primary" onclick="location.reload()">载入最新</button>' +
    '<span class="sa-close" onclick="hideStorageAlert()" title="关闭">×</span>';
  el.style.display = '';
}
function toast(msg, type){
  const t = $('toast');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ' ' + type : '');
  clearTimeout(t._h); t._h = setTimeout(() => { t.className = 'toast'; }, 2200);
}

/* ---------------- 路由 / 视图 ---------------- */
function go(v){
  if(v === 'season-detail' && !currentSeasonId){ v = 'seasons'; }
  if(v === 'tournament-detail' && !currentTournamentId){ v = 'tournaments'; }
  if(v === 'team' && !currentClubId){ v = 'clubs'; }
  view = v;
  document.querySelectorAll('.view').forEach(el => el.classList.remove('on'));
  const target = $('view-' + v);
  if(target) target.classList.add('on');
  document.querySelectorAll('.nav-link').forEach(a => a.classList.toggle('active', a.dataset.view === v));
  renderBreadcrumb();
  render();
  window.scrollTo(0, 0);
}
function renderBreadcrumb(){
  const parts = ['<a onclick="go(\'dashboard\')">首页</a>'];
  if(view === 'clubs' || view === 'team') parts.push('<span class="sep">/</span><a onclick="go(\'clubs\')">俱乐部</a>');
  if(view === 'seasons' || view === 'season-detail') parts.push('<span class="sep">/</span><a onclick="go(\'seasons\')">赛年</a>');
  if(view === 'tournaments' || view === 'tournament-detail') parts.push('<span class="sep">/</span><a onclick="go(\'tournaments\')">赛事</a>');
  if(view === 'season-detail' && currentSeasonId) parts.push('<span class="sep">/</span><span>' + esc(getSeason(currentSeasonId).name) + '</span>');
  if(view === 'tournament-detail' && currentTournamentId) parts.push('<span class="sep">/</span><span>' + esc(getTournament(currentTournamentId).name) + '</span>');
  if(view === 'team' && currentClubId) parts.push('<span class="sep">/</span><span>' + esc(clubName(currentClubId)) + '</span>');
  if(view === 'search') parts.push('<span class="sep">/</span><span>搜索</span>');
  $('breadcrumb').innerHTML = parts.join('');
}
function render(){
  switch(view){
    case 'dashboard': renderDashboard(); break;
    case 'clubs': renderClubs(); break;
    case 'seasons': renderSeasons(); break;
    case 'season-detail': renderSeasonDetail(); break;
    case 'tournaments': renderTournaments(); break;
    case 'tournament-detail': renderTournamentDetail(); break;
    case 'team': renderTeam(); break;
    case 'search': renderSearch(); break;
  }
}

/* ============================================================
   首页
   ============================================================ */
function renderDashboard(){
  const c = state.clubs.length, s = state.seasons.length, t = state.tournaments.length;
  const huplCount = state.clubs.filter(x => x.category === 'hupl').length;
  let html = '<div class="view-head"><h1>' + esc(state.meta.countryName) + ' · 赛事数据中心</h1></div>';
  html += '<div class="stats">' +
    stat(c, '俱乐部') + stat(s, '赛年') + stat(t, '赛事') + stat(huplCount, 'HUPL 队伍') + '</div>';

  if(c === 0 && s === 0 && t === 0){
    html += '<div class="empty"><div class="big">🐕</div><h3>欢迎使用 The Game 数据中心</h3>' +
      '<p>还没有数据。可以先载入一套示例数据熟悉功能，或直接开始创建。</p>' +
      '<button class="btn btn-primary" onclick="loadSample()">载入示例数据</button> ' +
      '<button class="btn" onclick="openClubModal()">新建俱乐部</button></div>';
    $('view-dashboard').innerHTML = html;
    return;
  }

  // 当前赛年 HUPL 积分榜
  const latest = state.seasons.slice().sort((a,b) => (b.year||0) - (a.year||0))[0];
  if(latest){
    const totals = computePointsTotals(latest.points);
    html += '<div class="section"><h2>' + esc(latest.name) + ' · HUPL 积分榜</h2>';
    if(totals.length === 0){
      html += '<div class="empty">该赛年尚未填写积分表。<a class="clickable" onclick="openSeason(\'' + latest.id + '\')">前往填写</a></div>';
    } else {
      const leader = totals[0];
      html += '<div class="table-wrap"><table><thead><tr><th>排名</th><th>队伍</th><th>总积分</th></tr></thead><tbody>';
      totals.forEach((r, i) => {
        html += '<tr><td>' + rankHtml(i+1) + '</td><td>' + teamSwatch(r.clubId, true) + '</td><td><b>' + r.total + '</b></td></tr>';
      });
      html += '</tbody></table></div>';
      html += '<p class="muted" style="margin-top:8px">当前领跑：' + teamSwatch(leader.clubId, true) + ' · ' + leader.total + ' 分</p>';
    }
    html += '</div>';
  }

  // 最近赛事（同一张可排序表格，最多 6 条；完整列表见「赛事」页）
  const recent = state.tournaments.slice().sort((a,b) => (b.createdAt||0) - (a.createdAt||0)).slice(0, 6);
  html += '<div class="section"><h2>最近赛事</h2>';
  if(recent.length === 0){
    html += '<div class="empty">暂无赛事。</div>';
  } else {
    html += tournamentTableHtml(sortTournamentList(recent));
  }
  html += '<p class="muted" style="margin-top:8px"><a class="clickable" onclick="go(\'tournaments\')">查看全部赛事 →</a></p>';
  html += '</div>';
  $('view-dashboard').innerHTML = html;
}
function stat(n, label){ return '<div class="stat"><div class="num">' + n + '</div><div class="lbl">' + label + '</div></div>'; }
function rankHtml(r){
  const cls = r === 1 ? 'rank-1' : r === 2 ? 'rank-2' : r === 3 ? 'rank-3' : '';
  return '<span class="rank-medal ' + cls + '">' + r + '</span>';
}
function tournamentCard(t, opts){
  const stags = t.stages || [];
  const tags = [typeBadge(t.type)];
  if(t.subtype) tags.push('<span class="badge badge-format">' + esc(subtypeLabel(t.subtype)) + '</span>');
  tags.push('<span class="badge badge-format">' + (stags.length ? stags.map(s => FORMAT_LABELS[s.format] || s.format).join(' + ') : '未设赛制') + '</span>');
  let order = '';
  if(opts && opts.total > 1){
    order = '<span class="card-order">' +
      '<span class="fmt-arrow' + (opts.idx === 0 ? ' dis' : '') + '" onclick="event.stopPropagation();moveTournamentInSeason(\'' + t.id + '\',-1)">▲</span>' +
      '<span class="fmt-arrow' + (opts.idx === opts.total - 1 ? ' dis' : '') + '" onclick="event.stopPropagation();moveTournamentInSeason(\'' + t.id + '\',1)">▼</span>' +
      '</span>';
  }
  return '<div class="card" onclick="openTournament(\'' + t.id + '\')">' +
    '<div class="card-head"><h3>' + esc(t.name) + '</h3>' + order + '</div>' +
    '<div class="meta">' + (t.seasonId ? esc((getSeason(t.seasonId)||{}).name || '') : '未归属赛年') + (t.date ? ' · ' + esc(t.date) : '') + '</div>' +
    '<div class="tags">' + tags.join('') + '</div></div>';
}

/* ============================================================
   俱乐部
   ============================================================ */
function renderClubs(){
  const cats = [['all','全部'], ['hupl','HUPL席位'], ['secondary','次级'], ['external','外赛区']];
  $('club-filters').innerHTML = cats.map(c =>
    '<span class="filter-chip' + (filters.clubCategory === c[0] ? ' active' : '') + '" onclick="setClubFilter(\'' + c[0] + '\')">' + c[1] + '</span>'
  ).join('');

  let list = state.clubs.slice();
  if(filters.clubCategory !== 'all') list = list.filter(c => c.category === filters.clubCategory);
  // 排序：类别 → 名称
  const catOrder = { hupl: 0, secondary: 1, external: 2 };
  list.sort((a,b) => (catOrder[a.category] - catOrder[b.category]) || a.name.localeCompare(b.name, 'zh'));

  const el = $('club-list');
  if(list.length === 0){
    el.innerHTML = '<div class="empty">暂无俱乐部。点击右上角「新建俱乐部」开始。</div>';
    return;
  }
  let html = '<div class="table-wrap"><table><thead><tr>' +
    '<th>队伍</th><th>简称</th><th>类别</th><th>席位 / 赛区</th><th>备注</th><th style="width:70px">操作</th></tr></thead><tbody>';
  list.forEach(c => {
    const extra = c.category === 'hupl'
      ? (c.seat === 'temporary' ? '临时席位' : '固定席位')
      : c.category === 'external' ? (REGIONS[c.region] || c.region || '—') : '—';
    html += '<tr>' +
      '<td>' + teamSwatch(c.id, true) + '</td>' +
      '<td><input class="cell-input txt" value="' + esc(c.shortName) + '" onchange="updateClubField(\'' + c.id + '\',\'shortName\',this.value)"></td>' +
      '<td>' + categoryBadge(c.category) + '</td>' +
      '<td>' + esc(extra) + '</td>' +
      '<td><input class="cell-input txt" value="' + esc(c.note) + '" placeholder="—" onchange="updateClubField(\'' + c.id + '\',\'note\',this.value)"></td>' +
      '<td class="nowrap"><button class="btn btn-sm" onclick="openTeam(\'' + c.id + '\')">档案</button> ' +
      '<button class="btn btn-sm btn-danger-text" onclick="deleteClub(\'' + c.id + '\')">删</button></td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  el.innerHTML = html;
}
function setClubFilter(v){ filters.clubCategory = v; renderClubs(); }
function updateClubField(id, field, value){
  const c = getClub(id); if(!c) return;
  c[field] = value; saveState();
  renderClubs();
}

function openClubModal(id){
  editingClubId = id || null;
  const c = id ? getClub(id) : null;
  $('club-modal-title').textContent = c ? '编辑俱乐部' : '新建俱乐部';
  $('club-name').value = c ? c.name : '';
  $('club-short').value = c ? (c.shortName || '') : '';
  $('club-category').value = c ? c.category : 'hupl';
  $('club-seat').value = (c && c.seat) ? c.seat : 'fixed';
  $('club-region').innerHTML = Object.entries(REGIONS).map(([k,v]) => '<option value="' + k + '"' + (c && c.region === k ? ' selected' : '') + '>' + esc(v) + '</option>').join('');
  $('club-region').value = (c && c.region) ? c.region : 'HO';
  $('club-note').value = c ? (c.note || '') : '';
  onClubCategoryChange();
  $('club-color').value = (c && c.color) ? c.color : autoColor(c ? c.category : 'hupl', c && c.region);
  openModal('modal-club');
}
function onClubCategoryChange(){
  const cat = $('club-category').value;
  $('club-seat-wrap').style.display = cat === 'hupl' ? '' : 'none';
  $('club-region-wrap').style.display = cat === 'external' ? '' : 'none';
  $('club-color').value = autoColor(cat, cat === 'external' ? $('club-region').value : null);
}
function onClubRegionChange(){
  $('club-color').value = autoColor('external', $('club-region').value);
}
function saveClub(){
  const name = $('club-name').value.trim();
  if(!name){ toast('请填写队伍名称', 'err'); return; }
  const data = {
    name: name,
    shortName: $('club-short').value.trim(),
    category: $('club-category').value,
    seat: $('club-category').value === 'hupl' ? $('club-seat').value : null,
    region: $('club-category').value === 'external' ? $('club-region').value : null,
    color: $('club-color').value,
    note: $('club-note').value.trim()
  };
  if(editingClubId){
    Object.assign(getClub(editingClubId), data);
    toast('已更新俱乐部');
  } else {
    state.clubs.push(Object.assign({ id: uid('c'), createdAt: Date.now(), relatedIds: [] }, data));
    toast('已创建俱乐部');
  }
  saveState(); closeModal('modal-club');
  render();
}
function deleteClub(id){
  const c = getClub(id); if(!c) return;
  confirmDialog('删除俱乐部', '确定删除「' + c.name + '」吗？\n相关比赛中的对阵与名次将保留原名称显示为「已删除队伍」。', () => {
    rememberSeedId(id);
    state.clubs = state.clubs.filter(x => x.id !== id);
    state.clubs.forEach(x => { if(x.relatedIds) x.relatedIds = x.relatedIds.filter(r => r !== id); });
    if(currentClubId === id) currentClubId = null;
    saveState();
    toast('已删除');
    go(view === 'team' ? 'clubs' : view);
  });
}
function deleteCurrentClub(){ if(currentClubId) deleteClub(currentClubId); }
function quickImportTeams(){
  const existing = new Set(state.clubs.map(c => (c.shortName || c.name).toLowerCase()));
  let added = 0, skipped = 0;
  QUICK_IMPORT.forEach(L => L.teams.forEach(abbr => {
    if(existing.has(abbr.toLowerCase())){ skipped++; return; }
    const cat = L.category || 'external';
    const region = cat === 'external' ? (L.region || null) : null;
    const seat = cat === 'hupl' ? 'fixed' : null;
    state.clubs.push({ id: uid('c'), createdAt: Date.now(), name: abbr, shortName: abbr, category: cat, seat: seat, region: region, color: autoColor(cat, region), note: '', relatedIds: [] });
    existing.add(abbr.toLowerCase()); added++;
  }));
  saveState(); renderClubs();
  toast('已导入 ' + added + ' 支队伍' + (skipped ? '（跳过 ' + skipped + ' 支已存在）' : ''), added ? 'ok' : 'err');
}

/* ============================================================
   赛年
   ============================================================ */
function renderSeasons(){
  const list = state.seasons.slice().sort((a,b) => (b.year||0) - (a.year||0));
  const el = $('season-list');
  if(list.length === 0){
    el.innerHTML = '<div class="empty">暂无赛年。点击「新建赛年」开始。</div>';
    return;
  }
  el.innerHTML = '<div class="cards">' + list.map(s => {
    const n = state.tournaments.filter(t => t.seasonId === s.id).length;
    const totals = computePointsTotals(s.points);
    return '<div class="card" onclick="openSeason(\'' + s.id + '\')">' +
      '<h3>' + esc(s.name) + '</h3>' +
      '<div class="meta">' + n + ' 项赛事' + (s.note ? ' · ' + esc(s.note) : '') + '</div>' +
      (totals.length ? '<div class="meta" style="margin-top:4px">HUPL 领跑：' + teamSwatch(totals[0].clubId, true) + '（' + totals[0].total + ' 分）</div>' : '') +
      '</div>';
  }).join('') + '</div>';
}
function openSeason(id){ currentSeasonId = id; go('season-detail'); }

function openSeasonModal(id){
  editingSeasonId = id || null;
  seasonCopyFrom = null;
  const s = id ? getSeason(id) : null;
  $('season-modal-title').textContent = s ? '编辑赛年' : '新建赛年';
  $('season-name').value = s ? s.name : '';
  $('season-year').value = s ? (s.year || '') : new Date().getFullYear();
  $('season-note').value = s ? (s.note || '') : '';
  $('season-copy-wrap').style.display = s ? 'none' : '';
  $('season-copy').innerHTML = '<option value="">（不复制）</option>' +
    state.seasons.filter(x => x.id !== id).slice().sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map(x => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('');
  $('season-copy').value = '';
  openModal('modal-season');
}
function saveSeason(){
  const name = $('season-name').value.trim();
  if(!name){ toast('请填写赛年名称', 'err'); return; }
  const data = {
    name: name,
    year: parseInt($('season-year').value) || new Date().getFullYear(),
    note: $('season-note').value.trim()
  };
  if(editingSeasonId){
    Object.assign(getSeason(editingSeasonId), data);
    toast('已更新赛年');
  } else {
    let points = { stations: [], clubIds: [], data: {} };
    if(seasonCopyFrom){ const src = getSeason(seasonCopyFrom); if(src) points = clone(src.points || points); }
    state.seasons.push(Object.assign({ id: uid('s'), createdAt: Date.now(), points: points }, data));
    toast('已创建赛年');
  }
  saveState(); closeModal('modal-season'); render();
}
function onSeasonCopyChange(){
  const id = $('season-copy').value;
  seasonCopyFrom = id || null;
  if(!id) return;
  const s = getSeason(id);
  if(!s) return;
  $('season-name').value = s.name + '（副本）';
  $('season-year').value = s.year || new Date().getFullYear();
  $('season-note').value = s.note || '';
}
function deleteSeason(id){
  const s = getSeason(id); if(!s) return;
  confirmDialog('删除赛年', '确定删除「' + s.name + '」吗？\n该赛年下的赛事不会被删除，但将失去赛年归属。', () => {
    rememberSeedId(id);
    state.seasons = state.seasons.filter(x => x.id !== id);
    state.tournaments.forEach(t => { if(t.seasonId === id) t.seasonId = null; });
    if(currentSeasonId === id) currentSeasonId = null;
    saveState(); toast('已删除'); go(view === 'season-detail' ? 'seasons' : view);
  });
}

/* ---------------- 赛年详情 ---------------- */
function renderSeasonDetail(){
  const s = getSeason(currentSeasonId); if(!s){ go('seasons'); return; }
  $('season-title').textContent = s.name;
  let meta = '<div class="table-wrap"><table class="plain"><tbody>';
  meta += '<tr><th style="width:120px">名称</th><td><input class="cell-input txt" value="' + esc(s.name) + '" onchange="updateSeasonField(\'name\',this.value)"></td></tr>';
  meta += '<tr><th>年份</th><td><input class="cell-input txt" type="number" value="' + esc(s.year) + '" onchange="updateSeasonField(\'year\',this.value)"></td></tr>';
  meta += '<tr><th>备注</th><td><input class="cell-input txt" value="' + esc(s.note) + '" onchange="updateSeasonField(\'note\',this.value)"></td></tr>';
  meta += '<tr><th>操作</th><td><button class="btn btn-sm" onclick="openSeasonModal(currentSeasonId)">编辑</button> <button class="btn btn-sm btn-danger-text" onclick="deleteSeason(currentSeasonId)">删除赛年</button></td></tr>';
  meta += '</tbody></table></div>';
  $('season-meta').innerHTML = meta;

  renderSeasonPoints();

  const ts = state.tournaments.filter(t => t.seasonId === s.id);
  const el = $('season-tournaments');
  if(ts.length === 0){
    el.innerHTML = '<div class="empty">本赛年暂无赛事。点击「新建赛事」。</div>';
  } else {
    el.innerHTML = '<div class="cards">' + ts.map((t, i) => tournamentCard(t, { idx: i, total: ts.length })).join('') + '</div>';
  }
}
function updateSeasonField(field, value){
  const s = getSeason(currentSeasonId); if(!s) return;
  s[field] = (field === 'year') ? (parseInt(value) || 0) : value;
  saveState(); renderSeasonDetail();
}
function moveTournamentInSeason(id, dir){
  const s = getSeason(currentSeasonId); if(!s) return;
  const t = getTournament(id); if(!t || t.seasonId !== s.id) return;
  const siblings = state.tournaments.filter(x => x.seasonId === s.id); // 保持数组顺序
  const i = siblings.findIndex(x => x.id === id);
  const j = i + dir;
  if(i < 0 || j < 0 || j >= siblings.length) return;
  const gi = state.tournaments.indexOf(siblings[i]);
  const gj = state.tournaments.indexOf(siblings[j]);
  const tmp = state.tournaments[gi]; state.tournaments[gi] = state.tournaments[gj]; state.tournaments[gj] = tmp;
  saveState(); renderSeasonDetail();
}

/* ---------------- 积分表（通用） ---------------- */
function computePointsTotals(p){
  if(!p) return [];
  return p.clubIds.map(cid => {
    let total = 0;
    p.stations.forEach(st => { total += num(p.data && p.data[cid] && p.data[cid][st.id]); });
    return { clubId: cid, total: total };
  }).sort((a,b) => (b.total - a.total) || (a.clubId < b.clubId ? -1 : 1));
}
function pointsTableHtml(ctx, ownerId, p, title){
  const owner = ctx === 'season' ? getSeason(ownerId) : getTournament(ownerId);
  let html = '<h2>' + esc(title) + '</h2>';
  if(!p){ // 尚未启用积分表
    html += '<div class="empty">尚未启用积分表。<button class="btn btn-sm btn-primary" onclick="enablePoints(\'' + ctx + '\',\'' + ownerId + '\')">启用积分表</button></div>';
    return html;
  }
  const totals = computePointsTotals(p);
  const totalMap = {}; totals.forEach(r => totalMap[r.clubId] = r.total);
  const skey = ctx + ':' + ownerId;
  const keys = pointsSort[skey] || [];
  const sortMark = k => { const i = keys.indexOf(k); return i < 0 ? '' : '<span class="sort-mark">' + (i + 1) + '</span>'; };
  const rows = p.clubIds.slice();
  rows.sort((a,b) => {
    for(const k of keys){
      let r;
      if(k === 'team') r = clubName(a).localeCompare(clubName(b), 'zh');
      else r = pointsSortValue(p, b, k, totalMap) - pointsSortValue(p, a, k, totalMap);
      if(r) return r;
    }
    return (totalMap[b] || 0) - (totalMap[a] || 0) || clubName(a).localeCompare(clubName(b), 'zh');
  });
  html += '<div class="table-wrap"><table><thead><tr><th>排名</th>' +
    '<th class="sort-th" title="点击排序" onclick="togglePointsSort(\'' + ctx + '\',\'' + ownerId + '\',\'team\')">队伍' + sortMark('team') + '</th>';
  p.stations.forEach(st => {
    html += '<th class="sort-th" title="点击按该分站积分排序" onclick="togglePointsSort(\'' + ctx + '\',\'' + ownerId + '\',\'st:' + st.id + '\')">' + esc(st.name) + sortMark('st:' + st.id) +
      ' <span class="clickable" title="删除该分站" onclick="event.stopPropagation();removeStation(\'' + ctx + '\',\'' + ownerId + '\',\'' + st.id + '\')">×</span></th>';
  });
  html += '<th class="sort-th" title="点击按总分排序" onclick="togglePointsSort(\'' + ctx + '\',\'' + ownerId + '\',\'total\')">总分' + sortMark('total') + '</th>' +
    '<th style="width:40px"></th></tr></thead><tbody>';
  rows.forEach(cid => {
    const total = totalMap[cid] || 0;
    html += '<tr><td>' + rankHtml(totals.findIndex(r => r.clubId === cid) + 1) + '</td><td>' + teamSwatch(cid, true) + '</td>';
    p.stations.forEach(st => {
      const v = (p.data && p.data[cid] && p.data[cid][st.id] != null) ? p.data[cid][st.id] : '';
      html += '<td><input class="cell-input num" type="number" value="' + esc(v) + '" onchange="updatePointsCell(\'' + ctx + '\',\'' + ownerId + '\',\'' + cid + '\',\'' + st.id + '\',this.value)"></td>';
    });
    html += '<td><b>' + total + '</b></td>';
    html += '<td><span class="clickable muted" title="移除队伍" onclick="removePointsTeam(\'' + ctx + '\',\'' + ownerId + '\',\'' + cid + '\')">×</span></td></tr>';
  });
  html += '</tbody></table></div>';

  // 添加分站 / 添加队伍
  html += '<div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">' +
    '<input id="station-input-' + ctx + '-' + ownerId + '" class="cell-input txt" style="width:180px;border:1px solid var(--border);border-radius:6px;padding:6px 10px" placeholder="新分站名称，如 National">' +
    '<button class="btn btn-sm" onclick="addStation(\'' + ctx + '\',\'' + ownerId + '\')">+ 添加分站</button>' +
    '<span style="width:1px;height:22px;background:var(--border)"></span>' +
    '<button class="btn btn-sm" onclick="openTeamPicker(\'' + ctx + '-points:' + ownerId + '\')">+ 添加队伍</button>' +
    '</div>';
  return html;
}
function pointsSortValue(p, clubId, key, totalMap){
  if(key === 'total') return totalMap[clubId] || 0;
  if(key.indexOf('st:') === 0){
    const sid = key.slice(3);
    return num(p.data && p.data[clubId] && p.data[clubId][sid]);
  }
  return 0;
}
function togglePointsSort(ctx, ownerId, key){
  const skey = ctx + ':' + ownerId;
  const arr = (pointsSort[skey] || []).slice();
  const i = arr.indexOf(key);
  if(i >= 0) arr.splice(i, 1); else arr.unshift(key);
  pointsSort[skey] = arr;
  renderPointsFor(ctx, ownerId);
}
function getPointsObj(ctx, ownerId){ return ctx === 'season' ? getSeason(ownerId).points : getTournament(ownerId).points; }
function renderPointsFor(ctx, ownerId){
  const p = getPointsObj(ctx, ownerId);
  const container = ctx === 'season' ? $('season-points') : $('tournament-points');
  if(!container) return;
  container.innerHTML = '<div class="section">' + pointsTableHtml(ctx, ownerId, p, (ctx === 'season' ? 'HUPL 赛年积分表' : '积分表（分站积分）')) + '</div>';
}
function enablePoints(ctx, ownerId){
  const owner = ctx === 'season' ? getSeason(ownerId) : getTournament(ownerId);
  owner.points = { stations: [], clubIds: [], data: {} };
  saveState(); renderPointsFor(ctx, ownerId); toast('已启用积分表');
}
function addStation(ctx, ownerId){
  const input = $('station-input-' + ctx + '-' + ownerId);
  const name = input.value.trim();
  if(!name){ toast('请输入分站名称', 'err'); return; }
  const p = getPointsObj(ctx, ownerId);
  p.stations.push({ id: uid('st'), name: name });
  input.value = ''; saveState(); renderPointsFor(ctx, ownerId); toast('已添加分站');
}
function removeStation(ctx, ownerId, stationId){
  const p = getPointsObj(ctx, ownerId);
  confirmDialog('删除分站', '确定删除该分站列及其积分数据吗？', () => {
    p.stations = p.stations.filter(st => st.id !== stationId);
    Object.keys(p.data).forEach(k => { delete p.data[k][stationId]; });
    saveState(); renderPointsFor(ctx, ownerId);
  });
}
function removePointsTeam(ctx, ownerId, clubId){
  const p = getPointsObj(ctx, ownerId);
  p.clubIds = p.clubIds.filter(id => id !== clubId);
  delete p.data[clubId];
  saveState(); renderPointsFor(ctx, ownerId);
}
function updatePointsCell(ctx, ownerId, clubId, stationId, value){
  const p = getPointsObj(ctx, ownerId);
  if(!p.data) p.data = {};
  if(!p.data[clubId]) p.data[clubId] = {};
  const n = parseFloat(value);
  if(value === '' || isNaN(n)) delete p.data[clubId][stationId];
  else p.data[clubId][stationId] = n;
  saveState(); renderPointsFor(ctx, ownerId);
}
function renderSeasonPoints(){ renderPointsFor('season', currentSeasonId); }

/* ============================================================
   赛事
   ============================================================ */
function renderTournaments(){
  const types = [['all','全部'], ['secondary','次级赛事'], ['hupl','HUPL'], ['international','国际赛事']];
  $('tournament-filters').innerHTML = types.map(c =>
    '<span class="filter-chip' + (filters.tournamentType === c[0] ? ' active' : '') + '" onclick="setTournamentFilter(\'' + c[0] + '\')">' + c[1] + '</span>'
  ).join('');
  const si = $('tournament-search');
  if(si) si.value = filters.tournamentQuery || '';
  renderTournamentList();
}
function tournamentSearch(q){ filters.tournamentQuery = q; renderTournamentList(); }
function renderTournamentList(){
  let list = state.tournaments.slice();
  if(filters.tournamentType !== 'all') list = list.filter(t => t.type === filters.tournamentType);
  const q = (filters.tournamentQuery || '').trim().toLowerCase();
  if(q){
    list = list.filter(t => {
      const hay = ((t.name || '') + ' ' + (TYPE_LABELS[t.type] || '') + ' ' + subtypeLabel(t.subtype) + ' ' +
        (t.seasonId ? ((getSeason(t.seasonId) || {}).name || '') : '') + ' ' + (t.date || '')).toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  list.sort((a,b) => (TOURNAMENT_TYPE_ORDER[a.type] - TOURNAMENT_TYPE_ORDER[b.type]) || a.name.localeCompare(b.name, 'zh'));
  list = sortTournamentList(list);

  const el = $('tournament-list');
  if(list.length === 0){
    el.innerHTML = '<div class="empty">暂无赛事。点击「新建赛事」开始。</div>';
    return;
  }
  el.innerHTML = tournamentTableHtml(list);
}

/* ---- 赛事表格排序（首页「最近赛事」与赛事页共用） ---- */
const TOURNAMENT_TYPE_ORDER = { secondary: 0, hupl: 1, international: 2 };
const TOURNAMENT_SORT_KEYS = ['name', 'type', 'subtype', 'season', 'date', 'teams'];
function tournamentTopFourHtml(t){
  const top = (t.finalStandings || [])
    .filter(r => r && r.clubId)
    .slice().sort((a,b) => (num(a.rank) || 999) - (num(b.rank) || 999))
    .slice(0, 4);
  if(top.length === 0) return '<span class="muted">—</span>';
  return '<div class="top4">' + top.map(r => {
    const c = getClub(r.clubId);
    const label = c ? (c.shortName || c.name) : '（已删除队伍）';
    return '<div class="top4-row"><span class="top4-rank top4-rank-' + (num(r.rank) || 'x') + '">' + (num(r.rank) || '–') + '</span>' +
      '<span class="team-swatch"><span class="dot" style="background:' + clubColor(r.clubId) + '"></span>' + esc(label) + '</span></div>';
  }).join('') + '</div>';
}
function tournamentSortVal(t, key){
  if(key === 'name') return (t.name || '').toLowerCase();
  if(key === 'type'){ const i = TOURNAMENT_TYPE_ORDER[t.type]; return i == null ? 9 : i; }
  if(key === 'subtype') return subtypeLabel(t.subtype).toLowerCase();
  if(key === 'season'){
    const s = t.seasonId ? (getSeason(t.seasonId) || {}) : {};
    return String(s.year || 9999) + '|' + (s.name || '').toLowerCase();
  }
  if(key === 'date') return String(t.date || '9999');
  if(key === 'teams') return (t.teamIds || []).length;
  return '';
}
function sortTournamentList(list){
  // 丢弃已下线列（如「赛制」）残留的排序键
  tournamentSort = tournamentSort.filter(k => TOURNAMENT_SORT_KEYS.indexOf(k) >= 0);
  if(tournamentSort.length === 0) return list;
  return list.slice().sort((a,b) => {
    for(const key of tournamentSort){
      const va = tournamentSortVal(a, key), vb = tournamentSortVal(b, key);
      const r = (typeof va === 'number' && typeof vb === 'number') ? (va - vb) : String(va).localeCompare(String(vb), 'zh');
      if(r) return r;
    }
    return 0;
  });
}
function tournamentSortTh(label, key){
  const i = tournamentSort.indexOf(key);
  return '<th class="sort-th" title="点击排序（可多选，后选为主）" onclick="toggleTournamentSort(\'' + key + '\')">' + label +
    (i >= 0 ? '<span class="sort-mark">' + (i + 1) + '</span>' : '') + '</th>';
}
function toggleTournamentSort(key){
  const i = tournamentSort.indexOf(key);
  if(i >= 0) tournamentSort.splice(i, 1); else tournamentSort.unshift(key);
  if(view === 'dashboard') renderDashboard(); else renderTournamentList();
}
function tournamentTableHtml(list){
  let html = '<div class="table-wrap"><table><thead><tr>' +
    tournamentSortTh('赛事','name') + tournamentSortTh('分类','type') + tournamentSortTh('子类型','subtype') +
    tournamentSortTh('赛年','season') + tournamentSortTh('日期','date') +
    '<th>四强队伍</th>' + tournamentSortTh('队伍数','teams') +
    '<th style="width:70px">操作</th></tr></thead><tbody>';
  list.forEach(t => {
    html += '<tr>' +
      '<td><a class="clickable" onclick="openTournament(\'' + t.id + '\')">' + esc(t.name) + '</a></td>' +
      '<td>' + typeBadge(t.type) + '</td>' +
      '<td>' + esc(subtypeLabel(t.subtype)) + '</td>' +
      '<td>' + (t.seasonId ? '<a class="clickable" onclick="openSeason(\'' + t.seasonId + '\')">' + esc((getSeason(t.seasonId)||{}).name || '') + '</a>' : '—') + '</td>' +
      '<td>' + esc(t.date || '—') + '</td>' +
      '<td>' + tournamentTopFourHtml(t) + '</td>' +
      '<td>' + (t.teamIds || []).length + '</td>' +
      '<td><button class="btn btn-sm" onclick="openTournament(\'' + t.id + '\')">打开</button></td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  return html;
}
function setTournamentFilter(v){ filters.tournamentType = v; renderTournaments(); }
function openTournament(id){ currentTournamentId = id; go('tournament-detail'); }

function openTournamentModal(){
  tForm = { formats: [], teams: new Set(), teamQuery: '' };
  tournamentCopyFrom = null;
  // 默认选中当前赛年
  $('t-season').innerHTML = '<option value="">（不归属赛年）</option>' +
    state.seasons.map(s => '<option value="' + s.id + '"' + (s.id === currentSeasonId ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('');
  $('t-name').value = '';
  $('t-type').value = 'secondary';
  $('t-date').value = '';
  $('t-team-search').value = '';
  tForm.teamQuery = '';
  $('t-copy').innerHTML = '<option value="">（不复制）</option>' +
    state.tournaments.slice().sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map(x => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('');
  $('t-copy').value = '';
  $('t-copy-search').value = '';
  onTournamentTypeChange();
  renderTournamentFormatChips();
  renderTournamentFormatOrder();
  renderTournamentTeamChips();
  openModal('modal-tournament');
}
function tCopySearch(q){
  const sel = $('t-copy');
  const cur = sel.value || '';
  const qq = (q || '').trim().toLowerCase();
  const list = state.tournaments.slice().sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0))
    .filter(t => {
      if(!qq) return true;
      const seasonName = t.seasonId ? ((getSeason(t.seasonId) || {}).name || '') : '';
      return ((t.name || '') + ' ' + seasonName + ' ' + subtypeLabel(t.subtype)).toLowerCase().indexOf(qq) >= 0;
    });
  let opts = '<option value="">（不复制）</option>' +
    list.map(x => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('');
  // 已选中的赛事即使被搜索过滤掉也保留，避免保存时复制的来源与界面不一致
  if(cur && !list.some(t => t.id === cur)){
    const ct = getTournament(cur);
    if(ct) opts += '<option value="' + ct.id + '">' + esc(ct.name) + '</option>';
  }
  sel.innerHTML = opts;
  if(cur && getTournament(cur)) sel.value = cur;
}
function onTournamentCopyChange(){
  const id = $('t-copy').value;
  tournamentCopyFrom = id || null;
  if(!id) return;
  const t = getTournament(id);
  if(!t) return;
  $('t-name').value = t.name + '（副本）';
  $('t-type').value = t.type || 'secondary';
  onTournamentTypeChange();
  $('t-secondary').value = t.subtype || $('t-secondary').value;
  $('t-season').value = t.seasonId || '';
  $('t-date').value = t.date || '';
  tForm.formats = (t.stages || []).map(s => s.format).filter(Boolean);
  tForm.teams = new Set(t.teamIds || []);
  tForm.teamQuery = '';
  $('t-team-search').value = '';
  renderTournamentFormatChips();
  renderTournamentFormatOrder();
  renderTournamentTeamChips();
}
function onTournamentTypeChange(){
  const type = $('t-type').value;
  $('t-secondary-wrap').style.display = '';
  $('t-secondary').innerHTML = SUBTYPES[type].map(x => '<option value="' + x[0] + '">' + esc(x[1]) + '</option>').join('');
}
function renderTournamentFormatChips(){
  const formats = [['group','小组赛'], ['swiss','瑞士轮'], ['single','单败赛制'], ['double','双败赛制'], ['tiered-double','分级双败'], ['wc','WC赛制']];
  $('t-formats').innerHTML = formats.map(f =>
    '<span class="chip' + (tForm.formats.includes(f[0]) ? ' on' : '') + '" onclick="toggleFormatChip(\'' + f[0] + '\')">' + f[1] + '</span>'
  ).join('');
}
function renderTournamentFormatOrder(){
  const el = $('t-formats-order');
  if(!tForm.formats.length){ el.innerHTML = '<span class="muted">尚未选择赛制（选中后在此调整阶段顺序）</span>'; return; }
  el.innerHTML = tForm.formats.map((f, i) =>
    '<span class="chip on">' + (i + 1) + '. ' + FORMAT_LABELS[f] +
    ' <span class="fmt-arrow' + (i === 0 ? ' dis' : '') + '" onclick="moveFormat(' + i + ',-1)">▲</span>' +
    ' <span class="fmt-arrow' + (i === tForm.formats.length - 1 ? ' dis' : '') + '" onclick="moveFormat(' + i + ',1)">▼</span>' +
    '</span>'
  ).join('');
}
function toggleFormatChip(f){
  const i = tForm.formats.indexOf(f);
  if(i >= 0) tForm.formats.splice(i, 1); else tForm.formats.push(f);
  renderTournamentFormatChips();
  renderTournamentFormatOrder();
}
function moveFormat(i, dir){
  const j = i + dir;
  if(j < 0 || j >= tForm.formats.length) return;
  const t = tForm.formats[i]; tForm.formats[i] = tForm.formats[j]; tForm.formats[j] = t;
  renderTournamentFormatOrder();
}
function renderTournamentTeamChips(){
  const cats = { hupl: 0, secondary: 1, external: 2 };
  const q = (tForm.teamQuery || '').toLowerCase();
  const clubs = state.clubs.slice().sort((a,b) => (cats[a.category] - cats[b.category]) || a.name.localeCompare(b.name, 'zh'))
    .filter(c => !q || clubMatchesQuery(c, q));
  $('t-teams').innerHTML = clubs.length ? clubs.map(c =>
    '<span class="team-chip' + (tForm.teams.has(c.id) ? ' on' : '') + '" onclick="toggleTeamChip(\'' + c.id + '\')">' +
    '<span class="dot" style="background:' + clubColor(c.id) + '"></span>' + esc(c.name) +
    ' <span class="muted">' + esc(CATEGORY_LABELS[c.category]) + '</span></span>'
  ).join('') : '<span class="muted">没有匹配的队伍</span>';
}
function tTeamSearch(q){ tForm.teamQuery = q; renderTournamentTeamChips(); }
function tClearTeams(){
  if(!tForm) return;
  if(!tForm.teams.size){ toast('当前没有已选队伍'); return; }
  tForm.teams.clear();
  renderTournamentTeamChips();
  toast('已清空参赛队伍');
}
function toggleTeamChip(id){ if(tForm.teams.has(id)) tForm.teams.delete(id); else tForm.teams.add(id); renderTournamentTeamChips(); }

/* 复制赛事的阶段时重新分配 id，并把胜者组/败者组连线改到新 id 上 */
function reidCopiedStages(stages){
  (stages || []).forEach(st => {
    st.id = uid('stg');
    const map = new Map();
    (st.matches || []).forEach(m => { const nid = uid('m'); map.set(m.id, nid); m.id = nid; });
    (st.matches || []).forEach(m => {
      m.nextId = m.nextId ? (map.get(m.nextId) || null) : null;
      m.loserNextId = m.loserNextId ? (map.get(m.loserNextId) || null) : null;
    });
  });
  return stages;
}

function saveTournament(){
  const name = $('t-name').value.trim();
  if(!name){ toast('请填写赛事名称', 'err'); return; }
  const type = $('t-type').value;
  const subtype = $('t-secondary').value;
  const t = {
    id: uid('t'),
    seasonId: $('t-season').value || null,
    name: name,
    type: type,
    subtype: subtype,
    date: $('t-date').value.trim(),
    teamIds: Array.from(tForm.teams),
    stages: [],
    finalStandings: [],
    points: (type === 'secondary' && subtype === 'hudl') ? { stations: [], clubIds: [], data: {} } : null,
    note: '',
    createdAt: Date.now()
  };
  if(tournamentCopyFrom){
    const src = getTournament(tournamentCopyFrom);
    if(src){
      // 复制赛事必须换新 id：否则两份赛事的阶段/对局 id 相同，编辑会串到另一份去
      t.stages = reidCopiedStages(clone(src.stages || []));
      t.finalStandings = clone(src.finalStandings || []);
      t.points = clone(src.points || null);
      t.note = src.note || '';
    }
  } else {
    // 按选择顺序生成阶段
    tForm.formats.forEach(f => { t.stages.push(newStage(f, t.teamIds)); });
  }
  state.tournaments.push(t);
  saveState(); closeModal('modal-tournament');
  toast('已创建赛事');
  currentTournamentId = t.id;
  go('tournament-detail');
}
function newStage(format, teamIds){
  const s = { id: uid('stg'), name: FORMAT_LABELS[format], format: format, config: {}, matches: [], standings: [] };
  if(format === 'group') s.config = { groups: [{ id: uid('g'), name: 'A组', teamIds: [] }] };
  if(format === 'swiss') s.config = { rounds: 5 };
  if(format === 'single' || format === 'double' || format === 'tiered-double') s.config = {};
  if(format === 'wc') s.config = initWcConfig();
  return s;
}
function initWcConfig(){
  return {
    groups: ['A','B','C','D'].map(l => ({ id: uid('g'), name: l + '组', seeds: { '1':'', '2':'', '3':'', '4':'' } })),
    manualRank: {},
    sourceLabels: {}
  };
}

/* ---------------- 赛事详情 ---------------- */
function renderTournamentDetail(){
  const t = getTournament(currentTournamentId); if(!t){ go('tournaments'); return; }
  if(!t.type || !SUBTYPES[t.type]) t.type = 'secondary';
  $('tournament-title').textContent = t.name;

  let meta = '<div class="table-wrap"><table class="plain"><tbody>';
  meta += '<tr><th style="width:110px">名称</th><td><input class="cell-input txt" value="' + esc(t.name) + '" onchange="updateTournamentField(\'name\',this.value)"></td></tr>';
  meta += '<tr><th>分类</th><td>' + typeBadge(t.type) + ' <span class="badge badge-format">' + esc(subtypeLabel(t.subtype)) + '</span>' +
    ' <select class="cell-input" style="width:auto" onchange="updateTournamentField(\'subtype\',this.value)">' +
    SUBTYPES[t.type].map(x => '<option value="' + x[0] + '"' + (t.subtype === x[0] ? ' selected' : '') + '>' + esc(x[1]) + '</option>').join('') + '</select></td></tr>';
  meta += '<tr><th>所属赛年</th><td><select class="cell-input" style="width:auto" onchange="updateTournamentField(\'seasonId\',this.value)">' +
    '<option value="">（不归属赛年）</option>' + state.seasons.map(s => '<option value="' + s.id + '"' + (t.seasonId === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') + '</select></td></tr>';
  meta += '<tr><th>日期</th><td><input class="cell-input txt" value="' + esc(t.date) + '" onchange="updateTournamentField(\'date\',this.value)"></td></tr>';
  meta += '<tr><th>参赛队伍</th><td>' + (t.teamIds || []).length + ' 支</td></tr>';
  meta += '</tbody></table></div>';
  $('tournament-meta').innerHTML = meta;

  renderTournamentTeams(t);
  $('tournament-stages').innerHTML = (t.stages || []).map(s => stageCardHtml(t, s)).join('');
  (t.stages || []).forEach(s => { if(isBracketFormat(s.format)) drawBracketConnectors(s.id); });
  renderFinalStandings();
  renderPointsFor('tournament', t.id);
}
function updateTournamentField(field, value){
  const t = getTournament(currentTournamentId); if(!t) return;
  t[field] = value;
  saveState(); renderTournamentDetail();
}
function renderTournamentTeams(t){
  const el = $('tournament-teams');
  if(!t.teamIds || t.teamIds.length === 0){
    el.innerHTML = '<div class="section"><h2>参赛队伍</h2><div class="empty">暂无队伍。<a class="clickable" onclick="openTeamPicker(\'tournament\')">添加参赛队伍</a></div></div>';
    return;
  }
  el.innerHTML = '<div class="section"><h2>参赛队伍（' + t.teamIds.length + '）</h2><div class="team-pick" style="max-height:none">' +
    t.teamIds.map(id => '<span class="team-chip" onclick="removeTournamentTeam(\'' + id + '\')" title="点击移除">' +
      '<span class="dot" style="background:' + clubColor(id) + '"></span>' + esc(clubName(id)) + ' <span class="muted">×</span></span>').join('') +
    '</div></div>';
}
function removeTournamentTeam(clubId){
  const t = getTournament(currentTournamentId);
  t.teamIds = t.teamIds.filter(id => id !== clubId);
  // 同步移除各阶段分组中的该队伍
  (t.stages || []).forEach(st => { if(st.config && st.config.groups) st.config.groups.forEach(g => { g.teamIds = g.teamIds.filter(id => id !== clubId); }); });
  saveState(); renderTournamentDetail(); toast('已移除队伍');
}
function deleteCurrentTournament(){
  const t = getTournament(currentTournamentId); if(!t) return;
  confirmDialog('删除赛事', '确定删除「' + t.name + '」吗？此操作不可恢复。', () => {
    rememberSeedId(t.id);
    state.tournaments = state.tournaments.filter(x => x.id !== t.id);
    currentTournamentId = null; saveState(); toast('已删除'); go('tournaments');
  });
}

/* ---------------- 阶段 ---------------- */
function stageCardHtml(t, s){
  let html = '<div class="stage-card" id="stage-' + s.id + '">';
  html += '<div class="stage-head">' +
    '<input class="cell-input txt" style="width:180px;font-weight:700;color:var(--navy)" value="' + esc(s.name) + '" onchange="updateStageName(\'' + s.id + '\',this.value)">' +
    '<select class="cell-input" style="width:auto" onchange="changeStageFormat(\'' + s.id + '\',this.value)">' +
    Object.keys(FORMAT_LABELS).map(f => '<option value="' + f + '"' + (s.format === f ? ' selected' : '') + '>' + FORMAT_LABELS[f] + '</option>').join('') + '</select>' +
    '<span class="badge badge-format">' + (s.matches || []).length + ' 场</span>' +
    '<div class="stage-tools">' +
    '<button class="btn btn-sm' + (qfActive(s.id) ? ' btn-primary' : '') + '" id="qf-btn-' + s.id + '" onclick="toggleQuickFill(\'' + s.id + '\')">快捷填入</button>';
  if(s.format === 'wc'){
    html += '<button class="btn btn-sm" onclick="openBulkEntry(\'' + s.id + '\')">批量录入</button>' +
      '<button class="btn btn-sm btn-danger-text" onclick="clearStageTeams(\'' + s.id + '\')">清空队伍</button>' +
      '<button class="btn btn-sm btn-danger-text" onclick="deleteStage(\'' + s.id + '\')">删阶段</button>';
  } else {
    html += '<button class="btn btn-sm" onclick="openBulkEntry(\'' + s.id + '\')">批量录入</button>' +
      '<button class="btn btn-sm" onclick="generateMatches(\'' + s.id + '\')">生成对阵</button>' +
      '<button class="btn btn-sm" onclick="addMatch(\'' + s.id + '\')">+ 对局</button>' +
      '<button class="btn btn-sm btn-danger-text" onclick="clearStageTeams(\'' + s.id + '\')">清空队伍</button>' +
      '<button class="btn btn-sm btn-danger-text" onclick="deleteStage(\'' + s.id + '\')">删阶段</button>';
  }
  html += '</div></div>';
  if(s.format === 'tiered-double'){
    html += '<div class="muted" style="margin:0 0 8px">分级双败（最多 10 队）：种子 1-2 从胜者组第 2 轮开打，种子 3-6 从胜者组第 1 轮开打，种子 7-10 从败者组第 1 轮开打。</div>';
  }
  html += '<div id="qf-panel-' + s.id + '">' + quickFillPanelHtml(t, s) + '</div>';
  if(s.format === 'wc'){
    html += '<div id="stage-body-' + s.id + '">' + wcStageBodyHtml(t, s) + '</div>';
  } else if(isBracketFormat(s.format)){
    html += '<div id="stage-bracket-' + s.id + '">' + bracketHtml(t, s) + '</div>';
    html += '<div id="stage-standings-' + s.id + '">' + stageStandingsHtml(t, s) + '</div>';
  } else {
    html += stageConfigHtml(t, s);
    html += '<div id="stage-matches-' + s.id + '">' + matchesTableHtml(t, s) + '</div>';
    if(s.format === 'group'){
      html += '<div id="stage-group-standings-' + s.id + '">' + groupStandingsHtml(t, s) + '</div>';
    }
    html += '<div id="stage-standings-' + s.id + '">' + stageStandingsHtml(t, s) + '</div>';
  }
  html += '</div>';
  return html;
}
function updateStageName(id, value){ const s = findStage(id); s.name = value; saveState(); }
function findStage(id){ for(const t of state.tournaments){ const s = (t.stages||[]).find(x => x.id === id); if(s) return s; } return null; }
function findStageOwner(id){ for(const t of state.tournaments){ if((t.stages||[]).some(x => x.id === id)) return t; } return null; }

function stageConfigHtml(t, s){
  if(s.format === 'group'){
    let html = '<div class="group-grid">';
    (s.config.groups || []).forEach(g => {
      html += '<div class="group-box"><h4><input class="cell-input txt" style="width:80px" value="' + esc(g.name) + '" onchange="renameGroup(\'' + s.id + '\',\'' + g.id + '\',this.value)"> <span class="muted">' + (g.teamIds||[]).length + ' 队</span></h4>';
      html += '<div class="team-pick" style="max-height:none">' + (g.teamIds||[]).map(id =>
        '<span class="team-chip" onclick="removeGroupTeam(\'' + s.id + '\',\'' + g.id + '\',\'' + id + '\')" title="点击移出小组">' +
        '<span class="dot" style="background:' + clubColor(id) + '"></span>' + esc(clubName(id)) + ' <span class="muted">×</span></span>').join('') + '</div>';
      const remaining = (t.teamIds||[]).filter(id => !(g.teamIds||[]).includes(id));
      html += '<div style="margin-top:6px"><select id="grp-add-' + g.id + '" class="cell-input" style="width:auto">' +
        '<option value="">+ 加入队伍…</option>' + remaining.map(id => '<option value="' + id + '">' + esc(clubName(id)) + '</option>').join('') +
        '</select><button class="btn btn-sm" onclick="addTeamToGroup(\'' + s.id + '\',\'' + g.id + '\')">加入</button></div></div>';
    });
    html += '</div>';
    html += '<div style="display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap">' +
      '<button class="btn btn-sm" onclick="addGroup(\'' + s.id + '\')">+ 添加小组</button>' +
      '<span class="muted">自动分组：</span><input id="autogroup-n-' + s.id + '" type="number" min="1" value="2" style="width:54px;padding:4px 6px;border:1px solid var(--border);border-radius:4px">个小组' +
      '<button class="btn btn-sm" onclick="autoGroup(\'' + s.id + '\')">按参赛队伍自动分组</button></div>';
    return html;
  }
  if(s.format === 'swiss'){
    return '<div style="margin:4px 0"><span class="muted">瑞士轮轮数：</span>' +
      '<input id="swiss-rounds-' + s.id + '" type="number" min="1" value="' + (s.config.rounds || 5) + '" style="width:54px;padding:4px 6px;border:1px solid var(--border);border-radius:4px">' +
      '<button class="btn btn-sm" onclick="setStageRounds(\'' + s.id + '\')">设置</button>' +
      '<span class="muted" style="margin-left:10px">轮次可在对局表格中切换</span></div>';
  }
  return '';
}

function matchesTableHtml(t, s){
  const teams = t.teamIds || [];
  const rounds = (s.format === 'swiss') ? roundsList(s.config.rounds || 5) : null;
  const isGroup = s.format === 'group';
  const isDouble = s.format === 'double';
  let html = '<div class="table-wrap"><table><thead><tr>';
  if(isGroup) html += '<th>小组</th>';
  if(isDouble) html += '<th>组别</th>';
  html += '<th>轮次</th><th>队伍A</th><th>比分A</th><th>比分B</th><th>队伍B</th><th>胜者</th><th>备注</th><th style="width:36px"></th></tr></thead><tbody>';
  (s.matches || []).forEach(m => {
    const winner = matchWinner(m);
    html += '<tr>';
    if(isGroup){
      const groups = s.config.groups || [];
      html += '<td><select class="cell-input" style="width:auto" onchange="updateMatchField(\'' + s.id + '\',\'' + m.id + '\',\'groupId\',this.value)">' +
        groups.map(g => '<option value="' + g.id + '"' + (m.groupId === g.id ? ' selected' : '') + '>' + esc(g.name) + '</option>').join('') + '</select></td>';
    }
    if(isDouble){
      html += '<td><select class="cell-input" style="width:auto" onchange="updateMatchField(\'' + s.id + '\',\'' + m.id + '\',\'bracket\',this.value)">' +
        '<option value="winners"' + (m.bracket !== 'losers' ? ' selected' : '') + '>胜者组</option>' +
        '<option value="losers"' + (m.bracket === 'losers' ? ' selected' : '') + '>败者组</option></select></td>';
    }
    if(rounds){
      html += '<td><select class="cell-input" style="width:auto" onchange="updateMatchField(\'' + s.id + '\',\'' + m.id + '\',\'round\',this.value)">' +
        rounds.map(r => '<option value="' + r + '"' + (m.round === r ? ' selected' : '') + '>' + r + '</option>').join('') + '</select></td>';
    } else {
      html += '<td><input class="cell-input txt" style="width:70px" value="' + esc(m.round) + '" placeholder="轮次" onchange="updateMatchField(\'' + s.id + '\',\'' + m.id + '\',\'round\',this.value)"></td>';
    }
    html += '<td>' + teamSelect(t, m.teamAId, s.id, m.id, 'teamAId') + '</td>';
    html += '<td>' + scoreSelectHtml(s.id, m.id, 'scoreA', m.scoreA, 'cell-input num', 'width:56px') + '</td>';
    html += '<td>' + scoreSelectHtml(s.id, m.id, 'scoreB', m.scoreB, 'cell-input num', 'width:56px') + '</td>';
    html += '<td>' + teamSelect(t, m.teamBId, s.id, m.id, 'teamBId') + '</td>';
    html += '<td><select class="cell-input" style="width:auto" onchange="updateMatchField(\'' + s.id + '\',\'' + m.id + '\',\'winnerId\',this.value)">' +
      '<option value=""' + (!m.winnerId ? ' selected' : '') + '>自动</option>' +
      '<option value="A"' + (m.winnerId === 'A' ? ' selected' : '') + '>队伍A</option>' +
      '<option value="B"' + (m.winnerId === 'B' ? ' selected' : '') + '>队伍B</option>' +
      '<option value="draw"' + (m.winnerId === 'draw' ? ' selected' : '') + '>平局</option></select>' +
      (winner ? '<span class="muted"> → ' + esc(clubName(winner)) + '</span>' : '') + '</td>';
    html += '<td><input class="cell-input txt" style="width:80px" value="' + esc(m.note) + '" placeholder="—" onchange="updateMatchField(\'' + s.id + '\',\'' + m.id + '\',\'note\',this.value)"></td>';
    html += '<td><span class="clickable muted" onclick="deleteMatch(\'' + s.id + '\',\'' + m.id + '\')">×</span></td></tr>';
  });
  if(!(s.matches || []).length){
    const cols = (isGroup ? 1 : 0) + (isDouble ? 1 : 0) + 7 + 1;
    html += '<tr><td colspan="' + cols + '" class="muted" style="text-align:center;padding:14px">暂无对局，点击上方「生成对阵」或「+ 对局」</td></tr>';
  }
  html += '</tbody></table></div>';
  return html;
}
function teamSelect(t, selected, stageId, matchId, field){
  if(qfActive(stageId) && !selected) return qfSlotHtml(stageId, matchId, field);
  const teams = t.teamIds || [];
  let html = '<select class="cell-input" style="width:130px" onchange="updateMatchField(\'' + stageId + '\',\'' + matchId + '\',\'' + field + '\',this.value)"><option value="">— 选择队伍 —</option>';
  teams.forEach(id => { html += '<option value="' + id + '"' + (selected === id ? ' selected' : '') + '>' + esc(clubName(id)) + '</option>'; });
  if(selected && !teams.includes(selected)) html += '<option value="' + selected + '" selected>' + esc(clubName(selected)) + '</option>';
  html += '</select>';
  return html;
}
function roundsList(n){ const r = ['第1轮']; for(let i=2;i<=n;i++) r.push('第' + i + '轮'); r.push('决赛'); return r; }

function scoreSelectHtml(stageId, matchId, field, value, cls, style){
  const cur = (value === null || value === undefined) ? '' : String(value);
  const opts = ['', '0', '1', '2', '3', '4', '5'];
  return '<select class="' + (cls || 'cell-input num') + '"' + (style ? ' style="' + style + '"' : '') +
    ' onchange="updateMatchField(\'' + stageId + '\',\'' + matchId + '\',\'' + field + '\',this.value)">' +
    opts.map(v => '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + (v === '' ? '—' : v) + '</option>').join('') +
    '</select>';
}

/* ---------------- 快捷填入 ---------------- */
function qfActive(stageId){ return quickFill.stageId === stageId; }
function qfNextName(){ return quickFill.queue.length ? clubName(quickFill.queue[0]) : ''; }
function quickFillPanelHtml(t, s){
  if(!qfActive(s.id)) return '';
  const teams = t.teamIds || [];
  // 每次打开 / 刷新都以最新参赛队伍名单为准：已移出名单的队伍从队列剔除
  const roster = new Set(teams);
  if(quickFill.queue.some(id => !roster.has(id))) quickFill.queue = quickFill.queue.filter(id => roster.has(id));
  let html = '<div class="qf-panel">' +
    '<div class="qf-head"><b>快捷填入</b><span class="muted">按顺序点选队伍（再次点击取消），然后依次点击赛程中的「＋」空格</span></div>';
  html += '<div class="chips">' + teams.map(id => {
    const i = quickFill.queue.indexOf(id);
    return '<span class="chip qf-team' + (i >= 0 ? ' on' : '') + '" onclick="qfToggleTeam(\'' + s.id + '\',\'' + id + '\')">' +
      (i >= 0 ? '<span class="qf-no">' + (i + 1) + '</span>' : '') + esc(clubName(id)) + '</span>';
  }).join('') + '</div>';
  html += '<div class="qf-status">' +
    (quickFill.queue.length
      ? '待填 <b>' + quickFill.queue.length + '</b> 队 · 下一个：<b class="qf-next">' + esc(qfNextName()) + '</b>'
      : '<span class="muted">请先按顺序点选队伍</span>') +
    ' <button class="btn btn-sm" onclick="qfClear(\'' + s.id + '\')">清空队列</button></div>';
  html += '</div>';
  return html;
}
function renderQuickFillPanel(stageId){
  const t = findStageOwner(stageId), s = findStage(stageId);
  const el = $('qf-panel-' + stageId);
  if(el && t && s) el.innerHTML = quickFillPanelHtml(t, s);
  const btn = $('qf-btn-' + stageId);
  if(btn){ const on = qfActive(stageId); btn.classList.toggle('btn-primary', on); }
}
function toggleQuickFill(stageId){
  const s = findStage(stageId); if(!s) return;
  if(qfActive(stageId)) quickFill = { stageId: '', queue: [] };
  else quickFill = { stageId: stageId, queue: [] };
  renderQuickFillPanel(stageId);
  refreshStage(stageId);
  if(qfActive(stageId)) toast('快捷填入：先点选队伍，再点击空格');
}
function qfToggleTeam(stageId, teamId){
  if(!qfActive(stageId)) return;
  const i = quickFill.queue.indexOf(teamId);
  if(i >= 0) quickFill.queue.splice(i, 1); else quickFill.queue.push(teamId);
  renderQuickFillPanel(stageId);
}
function qfClear(stageId){ if(!qfActive(stageId)) return; quickFill.queue = []; renderQuickFillPanel(stageId); }
function qfSlotHtml(stageId, matchId, field){
  const has = quickFill.queue.length > 0;
  return '<span class="qf-slot' + (has ? '' : ' qf-slot-empty') + '" onclick="qfAssign(\'' + stageId + '\',\'' + matchId + '\',\'' + field + '\')" title="' +
    esc(has ? '填入：' + qfNextName() : '请先在快捷填入面板中选择队伍') + '">＋ 填入</span>';
}
function qfAssign(stageId, matchId, field){
  const s = findStage(stageId); if(!s) return;
  if(!qfActive(stageId)){ toast('请先点击「快捷填入」', 'err'); return; }
  if(!quickFill.queue.length){ toast('队伍队列已空，请重新点选队伍', 'err'); return; }
  const m = (s.matches || []).find(x => x.id === matchId); if(!m || m[field]) return;
  m[field] = quickFill.queue.shift();
  advanceFromMatch(s, m);
  saveState();
  renderQuickFillPanel(stageId);
  refreshStage(stageId);
}
function qfAssignSeed(stageId, groupId, seed){
  const s = findStage(stageId); if(!s) return;
  if(!qfActive(stageId)){ toast('请先点击「快捷填入」', 'err'); return; }
  if(!quickFill.queue.length){ toast('队伍队列已空，请重新点选队伍', 'err'); return; }
  const g = (s.config.groups || []).find(x => x.id === groupId); if(!g) return;
  if(g.seeds[seed]) return;
  g.seeds[seed] = quickFill.queue.shift();
  saveState(); refreshStage(stageId);
}

function matchWinner(m){
  if(m.winnerId === 'A') return m.teamAId;
  if(m.winnerId === 'B') return m.teamBId;
  if(m.winnerId === 'draw') return 'draw';
  const a = num(m.scoreA), b = num(m.scoreB);
  if((m.scoreA !== '' && m.scoreA != null) && (m.scoreB !== '' && m.scoreB != null) && a !== b) return a > b ? m.teamAId : m.teamBId;
  return null;
}
function updateMatchField(stageId, matchId, field, value){
  const s = findStage(stageId); if(!s) return;
  const m = (s.matches||[]).find(x => x.id === matchId); if(!m) return;
  m[field] = value;
  advanceFromMatch(s, m);
  saveState();
  refreshStage(stageId);
}
function deleteMatch(stageId, matchId){
  const s = findStage(stageId);
  rememberSeedId(matchId);
  s.matches = (s.matches||[]).filter(m => m.id !== matchId);
  saveState();
  refreshStage(stageId);
}
function addMatch(stageId){
  const s = findStage(stageId);
  const m = { id: uid('m'), round: '', groupId: null, bracket: 'winners', teamAId: '', teamBId: '', scoreA: '', scoreB: '', winnerId: '', note: '' };
  if(s.format === 'group' && s.config.groups && s.config.groups.length) m.groupId = s.config.groups[0].id;
  if(s.format === 'swiss') m.round = '第1轮';
  if(s.format === 'single') m.round = '第1轮';
  if(s.format === 'double'){ m.round = '第1轮'; m.bracket = 'winners'; }
  if(s.format === 'tiered-double'){ m.round = '胜者组第1轮'; m.bracket = 'winners'; }
  s.matches = s.matches || []; s.matches.push(m);
  saveState();
  refreshStage(stageId);
}
/* 重绘阶段内部（对局表 / 名次 / WC 主体），保留整体布局与滚动 */
function refreshStage(stageId){
  const t = findStageOwner(stageId);
  const s = findStage(stageId);
  if(!s) return;
  renderQuickFillPanel(stageId);
  if(s.format === 'wc'){
    const b = $('stage-body-' + stageId);
    if(b) b.innerHTML = wcStageBodyHtml(t, s);
  } else if(isBracketFormat(s.format)){
    const b = $('stage-bracket-' + stageId);
    if(b) b.innerHTML = bracketHtml(t, s);
    const st = $('stage-standings-' + stageId);
    if(st) st.innerHTML = stageStandingsHtml(t, s);
    drawBracketConnectors(stageId);
  } else {
    const m = $('stage-matches-' + stageId);
    if(m) m.innerHTML = matchesTableHtml(t, s);
    if(s.format === 'group'){
      const gs = $('stage-group-standings-' + stageId);
      if(gs) gs.innerHTML = groupStandingsHtml(t, s);
    }
    const st = $('stage-standings-' + stageId);
    if(st) st.innerHTML = stageStandingsHtml(t, s);
  }
}

/* 生成对阵 */
function generateMatches(stageId){
  const t = findStageOwner(stageId);
  const s = findStage(stageId);
  if(s.format === 'double'){
    const def = (t.teamIds || []).length || 16;
    promptDialog('生成双败对阵', '请输入参赛队伍数量（2–64）。将生成空白框图，队伍可在「快捷填入」中依次填入；非 2 的幂时按上一级 2 的幂生成（多余位置为轮空）：', def, value => {
      const n = parseInt(value, 10);
      if(!n || n < 2 || n > 64){ toast('请输入 2–64 之间的队伍数量', 'err'); return; }
      applyGeneratedMatches(stageId, buildDoubleBracket(new Array(n).fill('')));
    });
    return;
  }
  applyGeneratedMatches(stageId, buildGeneratedMatches(t, s));
}
function applyGeneratedMatches(stageId, gen){
  const s = findStage(stageId); if(!s) return;
  if(gen.length === 0){ toast('无可生成的对阵（请先选择参赛队伍或分组）', 'err'); return; }
  const doGen = () => {
    s.matches = gen;
    saveState();
    refreshStage(stageId);
    toast('已生成 ' + gen.length + ' 场对阵');
  };
  if((s.matches || []).length) confirmDialog('重新生成对阵', '将覆盖当前 ' + s.matches.length + ' 场对局，确定吗？', doGen);
  else doGen();
}
function buildGeneratedMatches(t, s){
  if(s.format === 'single') return buildSingleBracket(t.teamIds || []);
  if(s.format === 'double') return buildDoubleBracket(t.teamIds || []);
  if(s.format === 'tiered-double') return buildTieredDoubleBracket();
  const out = [];
  const mk = (a, b, round, groupId, bracket) => out.push({ id: uid('m'), round: round, groupId: groupId || null, bracket: bracket || 'winners', teamAId: a || '', teamBId: b || '', scoreA: '', scoreB: '', winnerId: '', note: '' });
  if(s.format === 'group'){
    (s.config.groups || []).forEach(g => {
      const rr = roundRobin(g.teamIds || []);
      rr.forEach(r => r.matches.forEach(p => mk(p.a, p.b, r.label, g.id, null)));
    });
  } else if(s.format === 'swiss'){
    const pairs = sequentialPairs(t.teamIds || []);
    pairs.forEach(p => mk(p.a, p.b, '第1轮', null, null));
  }
  return out;
}
function roundRobin(teamIds){
  let teams = teamIds.slice();
  const hasBye = teams.length % 2 === 1;
  if(hasBye) teams.push(null);
  const n = teams.length;
  if(n < 2) return [];
  const rounds = [];
  const arr = teams.slice();
  for(let r = 0; r < n - 1; r++){
    const matches = [];
    for(let i = 0; i < n / 2; i++){
      const a = arr[i], b = arr[n - 1 - i];
      if(a != null && b != null) matches.push({ a: a, b: b });
    }
    rounds.push({ label: '第' + (r + 1) + '轮', matches: matches });
    arr.splice(1, 0, arr.pop());
  }
  return rounds;
}
function sequentialPairs(teamIds){
  const res = [];
  for(let i = 0; i + 1 < teamIds.length; i += 2) res.push({ a: teamIds[i], b: teamIds[i + 1] });
  return res;
}

/* ---------------- 淘汰赛 Bracket（HLTV / Liquidpedia 风格） ---------------- */
function mkBracketMatch(round, bracket, a, b){
  return { id: uid('m'), round: round, groupId: null, bracket: bracket, teamAId: a || '', teamBId: b || '', scoreA: '', scoreB: '', winnerId: '', note: '', nextId: null, nextSlot: null, loserNextId: null, loserNextSlot: null };
}
function nextPow2(n){ let p = 1; while(p < n) p *= 2; return p; }
function roundLabel(ri, W){
  const names = ['决赛', '半决赛', '四分之一决赛', '16强', '32强', '64强'];
  const fromEnd = W - 1 - ri;
  return fromEnd < names.length ? names[fromEnd] : '第' + (ri + 1) + '轮';
}
function fillRoundOne(round, ids, slots){
  const matchCount = round.length;
  const pairCount = ids.length - matchCount;
  let idx = 0;
  for(let j = 0; j < matchCount; j++){
    const m = round[j];
    if(j < pairCount){
      m.teamAId = ids[idx++] || '';
      m.teamBId = ids[idx++] || '';
    } else {
      m.teamAId = ids[idx++] || '';
      m.teamBId = '';
    }
  }
}
function propagateByes(round, all){
  round.forEach(m => {
    if(m.teamAId && !m.teamBId){ m.winnerId = 'A'; advanceFromMatch({ matches: all }, m); }
    else if(!m.teamAId && m.teamBId){ m.winnerId = 'B'; advanceFromMatch({ matches: all }, m); }
  });
}
function buildSingleBracket(teamIds){
  const ids = (teamIds || []).slice();
  if(ids.length < 2) return [];
  const slots = nextPow2(ids.length);
  let W = 0; for(let x = slots; x > 1; x >>= 1) W++;
  const rounds = [];
  for(let ri = 0; ri < W; ri++){
    const sz = slots / Math.pow(2, ri + 1);
    const ms = [];
    for(let j = 0; j < sz; j++) ms.push(mkBracketMatch(roundLabel(ri, W), '', '', ''));
    rounds.push(ms);
  }
  for(let ri = 0; ri < W - 1; ri++){
    rounds[ri].forEach((m, j) => {
      const nx = rounds[ri + 1][Math.floor(j / 2)];
      m.nextId = nx.id; m.nextSlot = (j % 2 === 0) ? 'A' : 'B';
    });
  }
  fillRoundOne(rounds[0], ids, slots);
  const all = rounds.flat();
  propagateByes(rounds[0], all);
  return all;
}
function buildDoubleBracket(teamIds){
  const ids = (teamIds || []).slice();
  if(ids.length < 2) return [];
  const slots = nextPow2(ids.length);
  let W = 0; for(let x = slots; x > 1; x >>= 1) W++;
  const wr = [];
  for(let ri = 0; ri < W; ri++){
    const sz = slots / Math.pow(2, ri + 1);
    const label = ri === W - 1 ? '胜者组决赛' : (ri === W - 2 ? '胜者组半决赛' : '胜者组第' + (ri + 1) + '轮');
    const ms = [];
    for(let j = 0; j < sz; j++) ms.push(mkBracketMatch(label, 'winners', '', ''));
    wr.push(ms);
  }
  for(let ri = 0; ri < W - 1; ri++){
    wr[ri].forEach((m, j) => { const nx = wr[ri + 1][Math.floor(j / 2)]; m.nextId = nx.id; m.nextSlot = (j % 2 === 0) ? 'A' : 'B'; });
  }
  fillRoundOne(wr[0], ids, slots);
  let all = wr.flat();
  if(W < 2){ all[0].round = '总决赛'; propagateByes(wr[0], all); return all; }

  const lb1 = slots / 4;
  const lbCounts = [lb1, lb1];
  for(let k = 1; k <= W - 2; k++) lbCounts.push(lb1 / Math.pow(2, k), lb1 / Math.pow(2, k));
  const lb = lbCounts.map((sz, ri) => {
    const ms = [];
    for(let j = 0; j < sz; j++) ms.push(mkBracketMatch('败者组第' + (ri + 1) + '轮', 'losers', '', ''));
    return ms;
  });
  const LB = lb.length;

  // WB1 败者 → 败者组第1轮（两两配对）
  wr[0].forEach((m, j) => { m.loserNextId = lb[0][Math.floor(j / 2)].id; m.loserNextSlot = (j % 2 === 0) ? 'A' : 'B'; });
  // WB_r (r≥2) 败者 → 败者组第 (2r-2) 轮的上位（A 位）；
  // 败者组上一轮晋级者固定进入下位（B 位），即「胜者组掉下来的在上，败者组晋级者在下」
  for(let r = 2; r <= W; r++){
    const lbIdx = 2 * r - 3;
    const src = wr[r - 1], dst = lb[lbIdx];
    if(!dst) continue;
    src.forEach((m, j) => { if(dst[j]){ m.loserNextId = dst[j].id; m.loserNextSlot = 'A'; } });
  }
  // 败者组胜者晋级：0/2/4…（偶轮）→ 下一轮 merge 1:1 进 B 位；其余两两配对
  for(let r = 0; r < LB - 1; r++){
    const nextIsMerge = (r % 2 === 0);
    lb[r].forEach((m, j) => {
      let nx, slot;
      if(nextIsMerge){ nx = lb[r + 1][j]; slot = 'B'; }
      else { nx = lb[r + 1][Math.floor(j / 2)]; slot = (j % 2 === 0) ? 'A' : 'B'; }
      m.nextId = nx.id; m.nextSlot = slot;
    });
  }
  const gf = mkBracketMatch('总决赛', 'final', '', '');
  wr[W - 1][0].nextId = gf.id; wr[W - 1][0].nextSlot = 'A';
  lb[LB - 1][0].nextId = gf.id; lb[LB - 1][0].nextSlot = 'B';
  all = all.concat(lb.flat(), [gf]);
  propagateByes(wr[0], all);
  return all;
}
function isBracketFormat(f){ return f === 'single' || f === 'double' || f === 'tiered-double'; }

/* 分级双败（最多 10 队）：
   种子 1-2 → 胜者组第2轮；种子 3-6 → 胜者组第1轮；种子 7-10 → 败者组第1轮 */
function buildTieredDoubleBracket(){
  const all = [];
  const mk = (round, bracket) => { const m = mkBracketMatch(round, bracket, '', ''); all.push(m); return m; };
  // 胜者组
  const wb1 = [mk('胜者组第1轮', 'winners'), mk('胜者组第1轮', 'winners')];
  const wb2 = [mk('胜者组第2轮', 'winners'), mk('胜者组第2轮', 'winners')];
  const wbf = mk('胜者组决赛', 'winners');
  // 胜者组第1轮胜者进入第2轮下位（B）；种子 1-2 直接坐镇上位（A）
  wb1[0].nextId = wb2[0].id; wb1[0].nextSlot = 'B';
  wb1[1].nextId = wb2[1].id; wb1[1].nextSlot = 'B';
  wb2[0].nextId = wbf.id; wb2[0].nextSlot = 'A';
  wb2[1].nextId = wbf.id; wb2[1].nextSlot = 'B';
  // 败者组
  const lb1 = [mk('败者组第1轮', 'losers'), mk('败者组第1轮', 'losers')];
  const lb2 = [mk('败者组第2轮', 'losers'), mk('败者组第2轮', 'losers')];
  const lb3 = [mk('败者组第3轮', 'losers'), mk('败者组第3轮', 'losers')];
  const lb4 = mk('败者组第4轮', 'losers');
  const lb5 = mk('败者组决赛', 'losers');
  lb1[0].nextId = lb2[0].id; lb1[0].nextSlot = 'B';
  lb1[1].nextId = lb2[1].id; lb1[1].nextSlot = 'B';
  wb1[0].loserNextId = lb2[0].id; wb1[0].loserNextSlot = 'A';
  wb1[1].loserNextId = lb2[1].id; wb1[1].loserNextSlot = 'A';
  lb2[0].nextId = lb3[0].id; lb2[0].nextSlot = 'B';
  lb2[1].nextId = lb3[1].id; lb2[1].nextSlot = 'B';
  wb2[0].loserNextId = lb3[0].id; wb2[0].loserNextSlot = 'A';
  wb2[1].loserNextId = lb3[1].id; wb2[1].loserNextSlot = 'A';
  lb3[0].nextId = lb4.id; lb3[0].nextSlot = 'A';
  lb3[1].nextId = lb4.id; lb3[1].nextSlot = 'B';
  lb4.nextId = lb5.id; lb4.nextSlot = 'B';
  wbf.loserNextId = lb5.id; wbf.loserNextSlot = 'A';
  // 总决赛
  const gf = mk('总决赛', 'final');
  wbf.nextId = gf.id; wbf.nextSlot = 'A';
  lb5.nextId = gf.id; lb5.nextSlot = 'B';
  return all;
}
function advanceFromMatch(s, m){
  const w = matchWinner(m);
  const loser = (w && w !== 'draw') ? (w === m.teamAId ? m.teamBId : m.teamAId) : '';
  if(m.nextId){
    const nm = (s.matches || []).find(x => x.id === m.nextId);
    if(nm){
      const val = (w === 'draw' || !w) ? '' : w;
      if(m.nextSlot === 'A') nm.teamAId = val; else nm.teamBId = val;
    }
  }
  if(m.loserNextId){
    const nm = (s.matches || []).find(x => x.id === m.loserNextId);
    if(nm){ if(m.loserNextSlot === 'A') nm.teamAId = loser; else nm.teamBId = loser; }
  }
}
function bracketHtml(t, s){
  const ms = s.matches || [];
  if(s.format === 'double' || s.format === 'tiered-double'){
    const win = ms.filter(m => m.bracket === 'winners');
    const los = ms.filter(m => m.bracket === 'losers');
    const fin = ms.filter(m => m.bracket === 'final');
    return '<div class="bracket-wrap" data-wrap="' + s.id + '">' +
      '<div class="bracket-double">' +
        '<div class="bracket-double-left">' +
          '<div class="bracket-zone"><h3>胜者组</h3>' + bracketColumnsHtml(t, s, win) + '</div>' +
          '<div class="bracket-zone"><h3>败者组</h3>' + bracketColumnsHtml(t, s, los, true) + '</div>' +
        '</div>' +
        (fin.length ? '<div class="bracket-zone bracket-double-final"><h3>总决赛</h3>' + bracketColumnsHtml(t, s, fin) + '</div>' : '') +
      '</div>' +
    '</div>';
  }
  return '<div class="bracket-wrap" data-wrap="' + s.id + '"><div class="bracket-zone">' + bracketColumnsHtml(t, s, ms) + '</div></div>';
}
function bracketColumnsHtml(t, s, ms, withGap){
  if(!ms.length) return '<div class="empty" style="padding:18px">暂无对局，点击「生成对阵」创建 Bracket。</div>';
  const cols = [], idx = {};
  ms.forEach(m => {
    const r = m.round || '未定轮次';
    if(idx[r] == null){ idx[r] = cols.length; cols.push({ label: r, matches: [] }); }
    cols[idx[r]].matches.push(m);
  });
  let html = '<div class="bracket">';
  // 败者组整体右移一列：胜者组掉下来的队伍连线向右下行进，不会与败者组内部连线交叉
  if(withGap) html += '<div class="bracket-col bracket-col-gap"></div>';
  cols.forEach(col => {
    html += '<div class="bracket-col"><div class="bracket-col-label">' + esc(col.label) + '</div>' +
      col.matches.map(m => bracketMatchHtml(t, s, m)).join('') + '</div>';
  });
  html += '</div>';
  return html;
}
function bracketMatchHtml(t, s, m){
  const w = matchWinner(m);
  const teams = t.teamIds || [];
  const row = (teamId, teamField, scoreField) => {
    const cls = (w && w !== 'draw' && teamId && teamId === w) ? ' winner' : '';
    let teamCell;
    if(qfActive(s.id) && !teamId){
      teamCell = qfSlotHtml(s.id, m.id, teamField);
    } else {
      let opt = '<option value="">—</option>';
      teams.forEach(id => { opt += '<option value="' + id + '"' + (teamId === id ? ' selected' : '') + '>' + esc(clubName(id)) + '</option>'; });
      if(teamId && !teams.includes(teamId)) opt += '<option value="' + teamId + '" selected>' + esc(clubName(teamId)) + '</option>';
      teamCell = '<select onchange="updateMatchField(\'' + s.id + '\',\'' + m.id + '\',\'' + teamField + '\',this.value)">' + opt + '</select>';
    }
    return '<div class="bracket-team' + cls + '"><span class="dot" style="background:' + (teamId ? clubColor(teamId) : '#c9d3df') + '"></span>' +
      teamCell + scoreSelectHtml(s.id, m.id, scoreField, m[scoreField], 'bracket-score') + '</div>';
  };
  return '<div class="bracket-match" data-id="' + m.id + '"' +
    (m.nextId ? ' data-next="' + m.nextId + '"' : '') +
    (m.loserNextId ? ' data-lnext="' + m.loserNextId + '"' : '') + '>' +
    row(m.teamAId, 'teamAId', 'scoreA') + row(m.teamBId, 'teamBId', 'scoreB') + '</div>';
}
function drawBracketConnectors(stageId){
  const wrap = document.querySelector('[data-wrap="' + stageId + '"]');
  if(!wrap) return;
  const old = wrap.querySelector('svg.br-links');
  if(old) old.remove();
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('class', 'br-links');
  svg.style.position = 'absolute';
  svg.style.left = '0'; svg.style.top = '0';
  svg.style.width = wrap.scrollWidth + 'px';
  svg.style.height = wrap.scrollHeight + 'px';
  svg.style.pointerEvents = 'none';
  svg.style.overflow = 'visible';
  const byId = {};
  wrap.querySelectorAll('.bracket-match').forEach(el => { byId[el.dataset.id] = el; });
  const link = (el, child) => {
    if(!child) return;
    const x1 = el.offsetLeft + el.offsetWidth;
    const y1 = el.offsetTop + el.offsetHeight / 2;
    const x2 = child.offsetLeft;
    const y2 = child.offsetTop + child.offsetHeight / 2;
    const midX = x1 + (x2 - x1) / 2;
    const d = 'M ' + x1.toFixed(1) + ' ' + y1.toFixed(1) + ' H ' + midX.toFixed(1) + ' V ' + y2.toFixed(1) + ' H ' + x2.toFixed(1);
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', d);
    p.setAttribute('stroke', '#a9b7c6');
    p.setAttribute('stroke-width', '1.5');
    p.setAttribute('fill', 'none');
    svg.appendChild(p);
  };
  wrap.querySelectorAll('.bracket-match[data-next]').forEach(el => link(el, byId[el.dataset.next]));
  wrap.querySelectorAll('.bracket-match[data-lnext]').forEach(el => link(el, byId[el.dataset.lnext]));
  wrap.appendChild(svg);
}

/* 阶段配置操作 */
function addStage(){
  const t = getTournament(currentTournamentId); if(!t) return;
  t.stages.push(newStage('single', t.teamIds));
  saveState(); renderTournamentDetail(); toast('已添加阶段');
}
function deleteStage(stageId){
  const t = findStageOwner(stageId);
  confirmDialog('删除阶段', '确定删除该赛制阶段及其对局吗？', () => {
    rememberSeedId(stageId);
    t.stages = (t.stages||[]).filter(s => s.id !== stageId);
    saveState(); renderTournamentDetail();
  });
}
/* 一键清空本阶段赛程中的队伍与比分（保留轮次 / 对局结构 / 分组种子 / 阶段名次表） */
function clearStageTeams(stageId){
  const s = findStage(stageId); if(!s) return;
  const ms = s.matches || [];
  const filled = ms.filter(m => m.teamAId || m.teamBId || m.winnerId ||
    (m.scoreA !== '' && m.scoreA != null) || (m.scoreB !== '' && m.scoreB != null));
  if(filled.length === 0){ toast('本阶段赛程里没有可清空的队伍或比分'); return; }
  confirmDialog('清空队伍与比分',
    '将清空本阶段 ' + filled.length + ' 场对局中的队伍、比分和胜者（共 ' + ms.length + ' 场对局，保留轮次与对阵结构）。此操作不可恢复，确定吗？',
    () => {
      ms.forEach(m => { m.teamAId = ''; m.teamBId = ''; m.scoreA = ''; m.scoreB = ''; m.winnerId = ''; });
      saveState();
      refreshStage(stageId);
      toast('已清空 ' + filled.length + ' 场对局的队伍与比分');
    });
}
function changeStageFormat(stageId, format){
  const s = findStage(stageId);
  s.format = format;
  if(format === 'group'){ if(!s.config.groups) s.config.groups = [{ id: uid('g'), name: 'A组', teamIds: [] }]; }
  if(format === 'swiss'){ if(!s.config.rounds) s.config.rounds = 5; }
  if(format === 'wc'){ if(!s.config.groups || !s.config.groups[0] || !s.config.groups[0].seeds) s.config = initWcConfig(); }
  saveState(); renderTournamentDetail();
}
function renameGroup(stageId, groupId, value){
  const s = findStage(stageId);
  const g = s.config.groups.find(x => x.id === groupId); if(g) g.name = value;
  saveState();
}
function groupLetter(n){
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  return (n <= letters.length ? letters[n - 1] : String(n)) + '组';
}
function addGroup(stageId){
  const s = findStage(stageId);
  const n = s.config.groups.length + 1;
  s.config.groups.push({ id: uid('g'), name: groupLetter(n), teamIds: [] });
  saveState(); renderTournamentDetail();
}
function removeGroupTeam(stageId, groupId, clubId){
  const s = findStage(stageId);
  const g = s.config.groups.find(x => x.id === groupId);
  g.teamIds = g.teamIds.filter(id => id !== clubId);
  saveState(); renderTournamentDetail();
}
function addTeamToGroup(stageId, groupId){
  const s = findStage(stageId);
  const g = s.config.groups.find(x => x.id === groupId);
  const sel = $('grp-add-' + groupId).value;
  if(!sel) return;
  g.teamIds.push(sel);
  saveState(); renderTournamentDetail();
}
function autoGroup(stageId){
  const t = findStageOwner(stageId);
  const s = findStage(stageId);
  const count = parseInt($('autogroup-n-' + stageId).value) || 1;
  const teams = (t.teamIds || []).slice();
  if(teams.length === 0){ toast('请先添加参赛队伍', 'err'); return; }
  const groups = [];
  for(let i = 0; i < count; i++) groups.push({ id: uid('g'), name: groupLetter(i + 1), teamIds: [] });
  teams.forEach((id, i) => { groups[i % count].teamIds.push(id); });
  s.config.groups = groups;
  saveState(); renderTournamentDetail(); toast('已自动分组为 ' + count + ' 组');
}
function setStageRounds(stageId){
  const s = findStage(stageId);
  const n = parseInt($('swiss-rounds-' + stageId).value) || 5;
  s.config.rounds = Math.max(1, n);
  saveState(); renderTournamentDetail();
}

/* ============================================================
   WC 赛制（世界冠军赛）
   16队 · ABCD四组 · 每组种子1-4
   P1 跨组 head-to-head / P2 小组单循环 / P3 分级赛 / P4 十强双败
   积分规则：3-0→6分 · 3-1→5 · 3-2→4 · 2-3→2 · 1-3→1 · 0-3→0
   ============================================================ */
function setScorePoints(scoreA, scoreB){
  const a = parseInt(scoreA), b = parseInt(scoreB);
  if(isNaN(a) || isNaN(b)) return null;
  if(a === 3 && b >= 0 && b <= 2) return { a: {0:6,1:5,2:4}[b], b: {0:0,1:1,2:2}[b] };
  if(b === 3 && a >= 0 && a <= 2) return { a: {0:0,1:1,2:2}[a], b: {0:6,1:5,2:4}[a] };
  return null;
}
function wcGroupRows(s, group){
  const teams = [1,2,3,4].map(i => ({ seed: i, teamId: group.seeds[i] })).filter(x => x.teamId);
  const pts = {}; teams.forEach(x => pts[x.teamId] = 0);
  (s.matches || []).forEach(m => {
    if(m.period !== 1 && m.period !== 2) return;
    const sp = setScorePoints(m.scoreA, m.scoreB); if(!sp) return;
    if(pts[m.teamAId] != null) pts[m.teamAId] += sp.a;
    if(pts[m.teamBId] != null) pts[m.teamBId] += sp.b;
  });
  const rows = teams.map(x => ({ seed: x.seed, teamId: x.teamId, points: pts[x.teamId], manual: (s.config.manualRank || {})[x.teamId] || null }));
  rows.sort((a,b) => (b.points - a.points) || (a.seed - b.seed));
  rows.forEach((r,i) => { r.autoRank = i + 1; r.finalRank = r.manual || r.autoRank; });
  rows.sort((a,b) => a.finalRank - b.finalRank);
  return rows;
}
function wcFinalRanking(s){
  const result = {};
  (s.config.groups || []).forEach(g => {
    const m = {};
    wcGroupRows(s, g).forEach(r => { m[r.finalRank] = r.teamId; });
    result[g.id] = m;
  });
  return result;
}
function wcStageBodyHtml(t, s){
  let html = '';
  html += '<div class="section" style="margin-top:4px">' + wcSeedHtml(t, s) + '</div>';
  html += '<div style="display:flex;gap:8px;margin:14px 0 6px;flex-wrap:wrap">' +
    '<button class="btn btn-sm btn-primary" onclick="wcGenerateP12(\'' + s.id + '\')">生成 P1+P2 对阵</button>' +
    '<button class="btn btn-sm" onclick="wcGenerateP3(\'' + s.id + '\')">生成 P3 分级赛</button>' +
    '<button class="btn btn-sm" onclick="wcGenerateP4(\'' + s.id + '\')">生成 P4 十强双败</button>' +
    '<span class="muted">P3 依据小组最终排名；P4 依据 P3 胜负</span></div>';
  html += wcStandingsHtml(t, s);
  html += wcMatchesTableHtml(t, s, 1, 'Period 1 · 跨组 Head-to-Head');
  html += wcMatchesTableHtml(t, s, 2, 'Period 2 · 小组单循环');
  html += wcMatchesTableHtml(t, s, 3, 'Period 3 · 分级赛');
  html += wcMatchesTableHtml(t, s, 4, 'Period 4 · 十强双败淘汰');
  return html;
}
function wcSeedHtml(t, s){
  const teams = t.teamIds || [];
  const teamOpts = (sel) => '<option value="">— 未分配 —</option>' + teams.map(id => '<option value="' + id + '"' + (sel === id ? ' selected' : '') + '>' + esc(clubName(id)) + '</option>').join('');
  let html = '<h3>分组与种子（16队 · ABCD四组 · 种子1-4）</h3>';
  html += '<div class="group-grid">';
  (s.config.groups || []).forEach(g => {
    html += '<div class="group-box"><h4>' + esc(g.name) + '</h4>';
    for(let i = 1; i <= 4; i++){
      const tid = g.seeds[i] || '';
      const src = (s.config.sourceLabels || {})[tid] || '';
      const seedCell = (qfActive(s.id) && !tid)
        ? '<span class="qf-slot qf-slot-seed" onclick="qfAssignSeed(\'' + s.id + '\',\'' + g.id + '\',' + i + ')">＋ 填入</span>'
        : '<select class="cell-input" style="width:132px" onchange="wcSetSeed(\'' + s.id + '\',\'' + g.id + '\',' + i + ',this.value)">' + teamOpts(tid) + '</select>';
      html += '<div style="display:flex;align-items:center;gap:5px;margin:4px 0">' +
        '<span class="badge badge-format" style="width:24px;text-align:center">' + i + '</span>' +
        seedCell +
        '<select class="cell-input" style="width:118px" onchange="wcSetSource(\'' + s.id + '\',\'' + tid + '\',this.value)" title="参赛来源"><option value="">来源—</option>' +
        WC_SOURCES.map(x => '<option value="' + x + '"' + (src === x ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>' +
        '</div>';
    }
    html += '</div>';
  });
  html += '</div>';
  html += '<div style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
    '<button class="btn btn-sm" onclick="wcAutoSeed(\'' + s.id + '\')">自动按顺序分配种子</button>' +
    '<span class="muted">16队依次 A1..A4 → B1..B4 → C1..C4 → D1..D4，右侧下拉标注参赛来源</span></div>';
  return html;
}
function wcStandingsHtml(t, s){
  let html = '<h3>小组积分榜（Period 1 + 2）</h3>';
  html += '<div class="muted" style="margin-bottom:6px">积分规则：3-0→6分 · 3-1→5分 · 3-2→4分 · 2-3→2分 · 1-3→1分 · 0-3→0分（按局分自动累计）</div>';
  html += '<div class="group-grid">';
  (s.config.groups || []).forEach(g => {
    const rows = wcGroupRows(s, g);
    html += '<div class="group-box"><h4>' + esc(g.name) + '</h4>' +
      '<table style="font-size:12.5px"><thead><tr><th style="width:36px">排名</th><th>队伍</th><th style="width:42px">积分</th><th style="width:56px">手动</th></tr></thead><tbody>';
    rows.forEach(r => {
      html += '<tr><td>' + rankHtml(r.finalRank) + '</td><td>' + teamSwatch(r.teamId, true) + '</td><td><b>' + r.points + '</b></td>' +
        '<td><input class="cell-input num" type="number" min="1" max="4" value="' + esc(r.manual || '') + '" placeholder="自动" title="打破平局：填写后覆盖自动排名" onchange="wcSetManualRank(\'' + s.id + '\',\'' + r.teamId + '\',this.value)"></td></tr>';
    });
    html += '</tbody></table></div>';
  });
  html += '</div>';
  html += '<div class="muted">「手动」列用于打破平局：填写 1-4 覆盖该队自动排名（P3 分级赛据此排位）。</div>';
  return html;
}
function wcMatchesTableHtml(t, s, period, title){
  const ms = (s.matches || []).filter(m => m.period === period);
  let html = '<h3>' + esc(title) + ' <span class="badge badge-format">' + ms.length + ' 场</span></h3>';
  html += '<div class="table-wrap"><table><thead><tr><th style="width:150px">轮次/对阵</th><th>队伍A</th><th>比分A</th><th>比分B</th><th>队伍B</th><th>胜者</th><th>备注</th><th style="width:36px"></th></tr></thead><tbody>';
  ms.forEach(m => { html += wcMatchRowHtml(t, s, m); });
  if(ms.length === 0) html += '<tr><td colspan="8" class="muted" style="text-align:center;padding:12px">暂无对局</td></tr>';
  html += '</tbody></table></div>';
  html += '<button class="btn btn-sm" style="margin-top:8px" onclick="wcAddMatch(\'' + s.id + '\',' + period + ')">+ 对局</button>';
  return html;
}
function wcMatchRowHtml(t, s, m){
  const winner = matchWinner(m);
  let html = '<tr>' +
    '<td><input class="cell-input txt" style="width:140px" value="' + esc(m.round) + '" onchange="updateMatchField(\'' + s.id + '\',\'' + m.id + '\',\'round\',this.value)"></td>' +
    '<td>' + teamSelect(t, m.teamAId, s.id, m.id, 'teamAId') + '</td>' +
    '<td>' + scoreSelectHtml(s.id, m.id, 'scoreA', m.scoreA, 'cell-input num', 'width:56px') + '</td>' +
    '<td>' + scoreSelectHtml(s.id, m.id, 'scoreB', m.scoreB, 'cell-input num', 'width:56px') + '</td>' +
    '<td>' + teamSelect(t, m.teamBId, s.id, m.id, 'teamBId') + '</td>' +
    '<td><select class="cell-input" style="width:auto" onchange="updateMatchField(\'' + s.id + '\',\'' + m.id + '\',\'winnerId\',this.value)">' +
    '<option value=""' + (!m.winnerId ? ' selected' : '') + '>自动</option>' +
    '<option value="A"' + (m.winnerId === 'A' ? ' selected' : '') + '>队伍A</option>' +
    '<option value="B"' + (m.winnerId === 'B' ? ' selected' : '') + '>队伍B</option>' +
    '<option value="draw"' + (m.winnerId === 'draw' ? ' selected' : '') + '>平局</option></select>' +
    (winner ? '<span class="muted"> → ' + esc(clubName(winner)) + '</span>' : '') + '</td>' +
    '<td><input class="cell-input txt" style="width:70px" value="' + esc(m.note) + '" placeholder="—" onchange="updateMatchField(\'' + s.id + '\',\'' + m.id + '\',\'note\',this.value)"></td>' +
    '<td><span class="clickable muted" onclick="deleteMatch(\'' + s.id + '\',\'' + m.id + '\')">×</span></td></tr>';
  return html;
}
function wcSetSeed(stageId, groupId, seed, value){
  const s = findStage(stageId);
  const g = (s.config.groups || []).find(x => x.id === groupId);
  if(!g) return;
  g.seeds[seed] = value || '';
  saveState(); refreshStage(stageId);
}
function wcSetSource(stageId, teamId, value){
  if(!teamId) return;
  const s = findStage(stageId);
  if(!s.config.sourceLabels) s.config.sourceLabels = {};
  s.config.sourceLabels[teamId] = value;
  saveState(); refreshStage(stageId);
}
function wcSetManualRank(stageId, teamId, value){
  const s = findStage(stageId);
  if(!s.config.manualRank) s.config.manualRank = {};
  const n = parseInt(value);
  if(value === '' || isNaN(n)) delete s.config.manualRank[teamId];
  else s.config.manualRank[teamId] = n;
  saveState(); refreshStage(stageId);
}
function wcAutoSeed(stageId){
  const t = findStageOwner(stageId), s = findStage(stageId);
  const teams = (t.teamIds || []).slice(0, 16);
  (s.config.groups || []).forEach((g, gi) => {
    for(let i = 1; i <= 4; i++){ g.seeds[i] = teams[gi * 4 + (i - 1)] || ''; }
  });
  if(teams.length < 16) toast('参赛队伍不足 16 支（当前 ' + teams.length + '），已分配 ' + teams.length + ' 席', 'err');
  saveState(); refreshStage(stageId);
}
function wcAddMatch(stageId, period){
  const s = findStage(stageId);
  s.matches = s.matches || [];
  s.matches.push({ id: uid('m'), period: period, round: '', groupId: null, bracket: '', teamAId: '', teamBId: '', scoreA: '', scoreB: '', winnerId: '', note: '' });
  saveState(); refreshStage(stageId);
}
function mkWcMatch(period, round, a, b, klass){
  return { id: uid('m'), period: period, round: round, groupId: null, bracket: '', teamAId: a || '', teamBId: b || '', scoreA: '', scoreB: '', winnerId: '', note: '', klass: klass || null };
}
function buildWcP12(s){
  const gen = [];
  const g = s.config.groups || [];
  const pairs = [[g[0], g[3]], [g[1], g[2]]]; // A-D, B-C
  pairs.forEach(([x, y]) => {
    if(!x || !y) return;
    for(let i = 1; i <= 4; i++) gen.push(mkWcMatch(1, x.name + i + ' vs ' + y.name + (5 - i), x.seeds[i], y.seeds[5 - i]));
  });
  g.forEach(gr => {
    const teams = [1,2,3,4].map(i => gr.seeds[i]).filter(Boolean);
    roundRobin(teams).forEach(r => r.matches.forEach(p => gen.push(mkWcMatch(2, gr.name + ' ' + r.label, p.a, p.b))));
  });
  return gen;
}
function buildWcP3(s){
  const rank = wcFinalRanking(s);
  const g = s.config.groups || [];
  const gen = [];
  const pairs = [[g[0], g[1]], [g[2], g[3]]]; // A-B, C-D
  pairs.forEach(([x, y]) => {
    if(!x || !y) return;
    [1,2,3].forEach(r => {
      const a = (rank[x.id] || {})[r], b = (rank[y.id] || {})[r];
      gen.push(mkWcMatch(3, '分级赛 ' + x.name + r + ' vs ' + y.name + r, a, b, r));
    });
  });
  return gen;
}
function buildWcP4(s){
  const p3 = (s.matches || []).filter(m => m.period === 3);
  const bye = [], wr1 = [], lr1 = [];
  p3.forEach(m => {
    const w = matchWinner(m);
    const loser = (w && w !== 'draw') ? (w === m.teamAId ? m.teamBId : m.teamAId) : '';
    if(m.klass === 1){ bye.push(w || ''); wr1.push(loser); }
    else if(m.klass === 2){ wr1.push(w || ''); lr1.push(loser); }
    else if(m.klass === 3){ lr1.push(w || ''); }
  });
  const gen = [];
  const wr1t = wr1.concat(['','','','']).slice(0, 4);
  gen.push(mkWcMatch(4, '胜者组第1轮', wr1t[0], wr1t[1]));
  gen.push(mkWcMatch(4, '胜者组第1轮', wr1t[2], wr1t[3]));
  gen.push(mkWcMatch(4, '胜者组第2轮', bye[0] || '', ''));
  gen.push(mkWcMatch(4, '胜者组第2轮', bye[1] || '', ''));
  gen.push(mkWcMatch(4, '胜者组决赛', '', ''));
  const lr1t = lr1.concat(['','','','']).slice(0, 4);
  gen.push(mkWcMatch(4, '败者组第1轮', lr1t[0], lr1t[1]));
  gen.push(mkWcMatch(4, '败者组第1轮', lr1t[2], lr1t[3]));
  gen.push(mkWcMatch(4, '败者组第2轮', '', ''));
  gen.push(mkWcMatch(4, '败者组第2轮', '', ''));
  gen.push(mkWcMatch(4, '败者组第3轮', '', ''));
  gen.push(mkWcMatch(4, '败者组决赛', '', ''));
  gen.push(mkWcMatch(4, '总决赛', '', ''));
  return gen;
}
function wcGen(stageId, periods, builder, label){
  const s = findStage(stageId);
  const existing = (s.matches || []).filter(m => periods.includes(m.period));
  const doIt = () => {
    const keep = (s.matches || []).filter(m => !periods.includes(m.period));
    s.matches = keep.concat(builder());
    saveState(); refreshStage(stageId); toast('已生成 ' + label);
  };
  if(existing.length) confirmDialog('重新生成', '将覆盖该阶段现有 ' + existing.length + ' 场对局，确定吗？', doIt);
  else doIt();
}
function wcGenerateP12(stageId){ wcGen(stageId, [1,2], () => buildWcP12(findStage(stageId)), 'P1+P2 对阵'); }
function wcGenerateP3(stageId){
  const s = findStage(stageId);
  const teams = (s.config.groups || []).flatMap(g => [1,2,3,4].map(i => g.seeds[i])).filter(Boolean);
  if(teams.length === 0){ toast('请先分配种子', 'err'); return; }
  wcGen(stageId, [3], () => buildWcP3(s), 'P3 分级赛');
}
function wcGenerateP4(stageId){
  const s = findStage(stageId);
  if(!(s.matches || []).some(m => m.period === 3)){ toast('请先生成并填写 P3 分级赛', 'err'); return; }
  wcGen(stageId, [4], () => buildWcP4(s), 'P4 十强双败');
}

/* ---------------- 阶段名次表 ---------------- */
function computeGroupStandings(t, s){
  return (s.config.groups || []).map(g => {
    const stats = {};
    (g.teamIds || []).forEach(id => { stats[id] = { id: id, w: 0, l: 0, pts: 0, mapW: 0, mapL: 0 }; });
    (s.matches || []).forEach(m => {
      if(m.groupId !== g.id) return;
      const a = m.teamAId, b = m.teamBId;
      if(!a || !b) return;
      if(m.scoreA === '' || m.scoreA == null || m.scoreB === '' || m.scoreB == null) return;
      if(!stats[a]) stats[a] = { id: a, w: 0, l: 0, pts: 0, mapW: 0, mapL: 0 };
      if(!stats[b]) stats[b] = { id: b, w: 0, l: 0, pts: 0, mapW: 0, mapL: 0 };
      const sa = num(m.scoreA), sb = num(m.scoreB);
      if(sa === sb) return;
      const aWin = sa > sb;
      const winId = aWin ? a : b, loseId = aWin ? b : a;
      const wScore = aWin ? sa : sb, lScore = aWin ? sb : sa;
      stats[winId].w++; stats[loseId].l++;
      stats[a].mapW += sa; stats[a].mapL += sb;
      stats[b].mapW += sb; stats[b].mapL += sa;
      stats[winId].pts += (wScore === 3 && lScore <= 1) ? 3 : 2;
      stats[loseId].pts += (lScore === 2) ? 1 : 0;
    });
    const rows = Object.values(stats).sort((x, y) => {
      if(y.pts !== x.pts) return y.pts - x.pts;
      const dx = (y.mapW - y.mapL) - (x.mapW - x.mapL);
      if(dx !== 0) return dx;
      return y.mapW - x.mapW;
    });
    return { group: g, rows: rows };
  });
}
function groupStandingsHtml(t, s){
  const groups = computeGroupStandings(t, s);
  if(!groups.length) return '';
  let html = '<div class="section" style="margin-top:16px"><h2>小组积分</h2>' +
    '<div class="muted" style="margin:-4px 0 10px;font-size:12px">BO5 计分：3:0 / 3:1 胜得 3 分；3:2 胜得 2 分、负方得 1 分。</div>' +
    '<div class="group-grid">';
  groups.forEach(({ group, rows }) => {
    html += '<div class="group-box"><h4>' + esc(group.name) + ' <span class="muted">' + rows.length + ' 队</span></h4>';
    if(!rows.length){
      html += '<div class="muted">暂无队伍</div></div>';
      return;
    }
    html += '<div class="table-wrap"><table class="plain"><thead><tr>' +
      '<th style="width:44px">排名</th><th>队伍</th><th style="width:46px">胜</th><th style="width:46px">负</th>' +
      '<th style="width:62px">地图</th><th style="width:56px">积分</th></tr></thead><tbody>';
    rows.forEach((r, i) => {
      html += '<tr><td>' + (i + 1) + '</td>' +
        '<td><span class="team-swatch"><span class="dot" style="background:' + clubColor(r.id) + '"></span>' + esc(clubName(r.id)) + '</span></td>' +
        '<td>' + r.w + '</td><td>' + r.l + '</td>' +
        '<td>' + r.mapW + '-' + r.mapL + '</td>' +
        '<td><b>' + r.pts + '</b></td></tr>';
    });
    html += '</tbody></table></div></div>';
  });
  html += '</div></div>';
  return html;
}
function stageStandingsHtml(t, s){
  let html = '<div class="table-wrap" style="margin-top:12px"><table><thead><tr><th style="width:60px">排名</th><th>队伍</th><th style="width:70px">胜</th><th style="width:70px">负</th><th>备注</th><th style="width:36px"></th></tr></thead><tbody>';
  (s.standings || []).forEach((row, i) => {
    html += '<tr><td><input class="cell-input num" type="number" value="' + esc(row.rank) + '" onchange="updateStageStanding(\'' + s.id + '\',' + i + ',\'rank\',this.value)"></td>' +
      '<td>' + standingTeamSelect(t, row.clubId, s.id, i) + '</td>' +
      '<td><input class="cell-input num" type="number" value="' + esc(row.w) + '" onchange="updateStageStanding(\'' + s.id + '\',' + i + ',\'w\',this.value)"></td>' +
      '<td><input class="cell-input num" type="number" value="' + esc(row.l) + '" onchange="updateStageStanding(\'' + s.id + '\',' + i + ',\'l\',this.value)"></td>' +
      '<td><input class="cell-input txt" value="' + esc(row.note) + '" onchange="updateStageStanding(\'' + s.id + '\',' + i + ',\'note\',this.value)"></td>' +
      '<td><span class="clickable muted" onclick="deleteStageStanding(\'' + s.id + '\',' + i + ')">×</span></td></tr>';
  });
  if(!(s.standings || []).length){
    html += '<tr><td colspan="6" class="muted" style="text-align:center;padding:12px">阶段名次（可选）</td></tr>';
  }
  html += '</tbody></table></div>';
  html += '<button class="btn btn-sm" style="margin-top:8px" onclick="addStageStanding(\'' + s.id + '\')">+ 添加名次行</button>';
  return html;
}
function standingTeamSelect(t, selected, stageId, idx){
  let html = '<select class="cell-input" style="width:130px" onchange="updateStageStanding(\'' + stageId + '\',' + idx + ',\'clubId\',this.value)"><option value="">— 选择队伍 —</option>';
  (t.teamIds || []).forEach(id => { html += '<option value="' + id + '"' + (selected === id ? ' selected' : '') + '>' + esc(clubName(id)) + '</option>'; });
  if(selected && !(t.teamIds || []).includes(selected)) html += '<option value="' + selected + '" selected>' + esc(clubName(selected)) + '</option>';
  html += '</select>';
  return html;
}
function updateStageStanding(stageId, idx, field, value){
  const s = findStage(stageId);
  const row = s.standings[idx]; if(!row) return;
  row[field] = (field === 'rank' || field === 'w' || field === 'l') ? (parseInt(value) || 0) : value;
  saveState();
  const el = $('stage-standings-' + stageId);
  if(el) el.innerHTML = stageStandingsHtml(findStageOwner(stageId), s);
}
function addStageStanding(stageId){
  const s = findStage(stageId);
  s.standings = s.standings || [];
  s.standings.push({ rank: s.standings.length + 1, clubId: '', w: 0, l: 0, note: '' });
  saveState();
  const el = $('stage-standings-' + stageId);
  if(el) el.innerHTML = stageStandingsHtml(findStageOwner(stageId), s);
}
function deleteStageStanding(stageId, idx){
  const s = findStage(stageId);
  s.standings.splice(idx, 1);
  saveState();
  const el = $('stage-standings-' + stageId);
  if(el) el.innerHTML = stageStandingsHtml(findStageOwner(stageId), s);
}

/* ---------------- 最终名次 ---------------- */
function sortFinalStandings(t){ t.finalStandings = t.finalStandings || []; t.finalStandings.sort((a,b) => (num(a.rank) - num(b.rank))); }
function renderFinalStandings(){
  const t = getTournament(currentTournamentId); if(!t) return;
  sortFinalStandings(t);
  const el = $('tournament-final-standings');
  let html = '<div class="table-wrap"><table><thead><tr><th style="width:60px">名次</th><th>队伍</th><th>备注</th><th style="width:36px"></th></tr></thead><tbody>';
  t.finalStandings.forEach((row, i) => {
    html += '<tr><td><input class="cell-input num" type="number" value="' + esc(row.rank) + '" onchange="updateFinalStanding(' + i + ',\'rank\',this.value)"></td>' +
      '<td>' + finalTeamSelect(t, row.clubId, i) + '</td>' +
      '<td><input class="cell-input txt" value="' + esc(row.note) + '" onchange="updateFinalStanding(' + i + ',\'note\',this.value)"></td>' +
      '<td><span class="clickable muted" onclick="deleteFinalStanding(' + i + ')">×</span></td></tr>';
  });
  if(t.finalStandings.length === 0){
    html += '<tr><td colspan="4" class="muted" style="text-align:center;padding:14px">暂无名次，点击下方「+ 添加名次」</td></tr>';
  }
  html += '</tbody></table></div>';
  html += '<button class="btn btn-sm" style="margin-top:8px" onclick="addFinalStanding()">+ 添加名次</button>';
  el.innerHTML = html;
}
function finalTeamSelect(t, selected, idx){
  let html = '<select class="cell-input" style="width:150px" onchange="updateFinalStanding(' + idx + ',\'clubId\',this.value)"><option value="">— 选择队伍 —</option>';
  (t.teamIds || []).forEach(id => { html += '<option value="' + id + '"' + (selected === id ? ' selected' : '') + '>' + esc(clubName(id)) + '</option>'; });
  if(selected && !(t.teamIds || []).includes(selected)) html += '<option value="' + selected + '" selected>' + esc(clubName(selected)) + '</option>';
  html += '</select>';
  return html;
}
function updateFinalStanding(idx, field, value){
  const t = getTournament(currentTournamentId); if(!t) return;
  const row = t.finalStandings[idx]; if(!row) return;
  row[field] = (field === 'rank') ? (parseInt(value) || 0) : value;
  sortFinalStandings(t);
  saveState(); renderFinalStandings();
}
function addFinalStanding(){
  const t = getTournament(currentTournamentId);
  t.finalStandings = t.finalStandings || [];
  t.finalStandings.push({ rank: t.finalStandings.length + 1, clubId: '', note: '' });
  saveState(); renderFinalStandings();
}
function deleteFinalStanding(idx){
  const t = getTournament(currentTournamentId);
  t.finalStandings.splice(idx, 1);
  saveState(); renderFinalStandings();
}

/* ============================================================
   队伍档案
   ============================================================ */
function openTeam(id){ currentClubId = id; teamSeasonFilter = ''; go('team'); }
function renderTeam(){
  const c = getClub(currentClubId); if(!c){ go('clubs'); return; }
  $('team-title').textContent = c.name;
  let meta = '<div class="table-wrap"><table class="plain"><tbody>';
  meta += '<tr><th style="width:110px">队伍</th><td>' + teamSwatch(c.id, true) + '</td></tr>';
  meta += '<tr><th>类别</th><td>' + categoryBadge(c.category) +
    (c.category === 'hupl' ? ' · ' + (c.seat === 'temporary' ? '临时席位' : '固定席位') : '') +
    (c.category === 'external' ? ' · ' + (REGIONS[c.region] || c.region || '') : '') + '</td></tr>';
  meta += '<tr><th>备注</th><td>' + esc(c.note || '—') + '</td></tr>';
  meta += '</tbody></table></div>';
  $('team-meta').innerHTML = meta;

  renderTeamRelated(c);
  renderTeamRankTrend(c);
  renderTeamSeasonFilter(c);
  renderTeamHistory(c);
  renderTeamH2h(c);
}

function relatedIdsOf(c){
  const seen = new Set([c.id]);
  const stack = [c.id];
  while(stack.length){
    const id = stack.pop();
    const cur = getClub(id);
    if(!cur) continue;
    (cur.relatedIds || []).forEach(r => { if(!seen.has(r)){ seen.add(r); stack.push(r); } });
  }
  return Array.from(seen);
}
function renderTeamRelated(c){
  const el = $('team-related');
  if(!el) return;
  const rel = (c.relatedIds || []).map(getClub).filter(Boolean);
  let html = '';
  if(rel.length === 0){
    html += '<div class="muted" style="margin-bottom:8px">暂无关联。适用于「次级转席位」「队伍改名」等同一沿革——关联后，下面的历届成绩与对阵成绩会把关联队伍的历史一并统计。</div>';
  } else {
    html += '<div class="team-pick" style="max-height:none">' + rel.map(r =>
      '<span class="team-chip">' +
      '<span class="dot" style="background:' + clubColor(r.id) + '"></span>' + esc(r.name) +
      ' <span class="muted">' + esc(CATEGORY_LABELS[r.category] || '') + '</span>' +
      ' <span class="muted" style="cursor:pointer" onclick="unlinkTeam(\'' + r.id + '\')" title="解除关联">×</span></span>'
    ).join('') + '</div>';
  }
  html += '<button class="btn btn-sm" style="margin-top:8px" onclick="openLinkTeamPicker()">+ 关联队伍</button>';
  el.innerHTML = html;
}
function openLinkTeamPicker(){ openTeamPicker('link:' + currentClubId); }

/* HUPL 年度排名走势：横轴赛年，纵轴排名（1 在上），相邻年份有成绩则连线 */
function renderTeamRankTrend(c){
  const el = $('team-rank-trend');
  if(!el) return;
  const seasons = state.seasons.slice().sort((a,b) => (a.year || 0) - (b.year || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
  if(seasons.length === 0){
    el.innerHTML = '<div class="empty">暂无赛年数据。创建赛年并填写 HUPL 赛年积分表后，这里会显示该队伍的年度排名走势。</div>';
    return;
  }
  const data = seasons.map(s => {
    const p = s.points;
    if(!p || !(p.clubIds || []).length) return null;
    const totals = computePointsTotals(p);
    const idx = totals.findIndex(r => r.clubId === c.id);
    if(idx < 0) return null;
    return { rank: idx + 1, points: totals[idx].total };
  });
  const ranks = data.filter(Boolean).map(d => d.rank);
  const maxRank = Math.max(13, ranks.length ? Math.max.apply(null, ranks) : 1);
  const W = Math.max(620, 120 + seasons.length * 104), H = 360;
  const padL = 60, padR = 36, padT = 32, padB = 62;
  const iw = W - padL - padR, ih = H - padT - padB;
  const X = i => seasons.length === 1 ? padL + iw / 2 : padL + iw * i / (seasons.length - 1);
  const Y = r => padT + ih * (r - 1) / Math.max(1, maxRank - 1);
  let svg = '<svg class="trend-chart" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:' + W + 'px;height:auto;display:block">';
  // 横向网格与排名刻度
  for(let r = 1; r <= maxRank; r++){
    const y = Y(r);
    svg += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#e3eaf3" stroke-width="1"/>';
    svg += '<text x="' + (padL - 12) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="12" fill="#5b6b7c">' + r + '</text>';
  }
  svg += '<line x1="' + padL + '" y1="' + (padT + ih) + '" x2="' + (W - padR) + '" y2="' + (padT + ih) + '" stroke="#c7d2e0" stroke-width="1"/>';
  const yMid = padT + ih / 2;
  svg += '<text x="14" y="' + yMid + '" text-anchor="middle" font-size="12" fill="#5b6b7c" transform="rotate(-90 14 ' + yMid + ')">排名</text>';
  // 横轴赛年
  seasons.forEach((s, i) => {
    svg += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 34) + '" text-anchor="middle" font-size="12" fill="#5b6b7c">' + esc(s.name) + '</text>';
  });
  // 折线：相邻两个年份都有成绩才连线
  for(let i = 0; i < data.length - 1; i++){
    const a = data[i], b = data[i + 1];
    if(!a || !b) continue;
    svg += '<line x1="' + X(i).toFixed(1) + '" y1="' + Y(a.rank).toFixed(1) + '" x2="' + X(i + 1).toFixed(1) + '" y2="' + Y(b.rank).toFixed(1) +
      '" stroke="#1e3a5f" stroke-width="2"/>';
  }
  // 成绩点与标注
  data.forEach((d, i) => {
    if(!d) return;
    const x = X(i), y = Y(d.rank);
    svg += '<circle cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="5" fill="#c9a227" stroke="#1e3a5f" stroke-width="1.5">' +
      '<title>' + esc(seasons[i].name + '：第' + d.rank + '名 · ' + d.points + '分') + '</title></circle>';
    const label = '第' + d.rank + '名 · ' + d.points + '分';
    const ly = (d.rank > 1) ? y - 12 : y + 22;
    svg += '<text x="' + x.toFixed(1) + '" y="' + ly.toFixed(1) + '" text-anchor="middle" font-size="11.5" font-weight="700" fill="#1e3a5f">' + esc(label) + '</text>';
  });
  svg += '</svg>';
  el.innerHTML = svg + '<div class="muted" style="margin-top:6px">纵轴为 HUPL 赛年积分榜排名（1 在上，13 在下）；标注为当年排名与积分。未进入当年积分榜的赛年保留横轴刻度、不画点。</div>';
}
function unlinkTeam(id){
  const c = getClub(currentClubId); if(!c) return;
  c.relatedIds = (c.relatedIds || []).filter(x => x !== id);
  const o = getClub(id); if(o && o.relatedIds) o.relatedIds = o.relatedIds.filter(x => x !== c.id);
  saveState(); renderTeam();
}
let teamSeasonFilter = '';
function renderTeamSeasonFilter(c){
  const el = $('team-season-filter');
  if(!el) return;
  el.innerHTML = '<div class="filters" style="margin-bottom:2px">' +
    '<span class="muted" style="align-self:center;font-weight:600">赛年筛选：</span>' +
    '<select class="cell-input" style="width:auto;padding:6px 10px;border:1px solid var(--border);border-radius:6px;font-size:13px" onchange="onTeamSeasonChange(this.value)">' +
    '<option value="">全部赛年</option>' +
    (state.seasons || []).map(s => '<option value="' + s.id + '"' + (teamSeasonFilter === s.id ? ' selected' : '') + '>' + esc(s.name) + '</option>').join('') +
    '</select></div>';
}
function onTeamSeasonChange(v){
  teamSeasonFilter = v;
  const c = getClub(currentClubId); if(!c) return;
  renderTeamHistory(c);
  renderTeamH2h(c);
}
function renderTeamHistory(c){
  const group = relatedIdsOf(c);
  const hasRel = group.length > 1;
  const hist = [];
  state.tournaments.forEach(t => {
    const members = (t.teamIds || []).filter(id => group.includes(id));
    if(members.length === 0) return;
    if(teamSeasonFilter && t.seasonId !== teamSeasonFilter) return;
    const rankRow = (t.finalStandings || []).find(r => group.includes(r.clubId));
    hist.push({ t: t, members: members, rank: rankRow ? rankRow.rank : null });
  });
  const typeOrder = { secondary: 0, hupl: 1, international: 2 };
  const sYear = t => t.seasonId ? ((getSeason(t.seasonId) || {}).year || 0) : 0;
  const sName = t => t.seasonId ? ((getSeason(t.seasonId) || {}).name || '') : '';
  const cmpFns = {
    name: (a,b) => (a.t.name || '').localeCompare(b.t.name || '', 'zh'),
    cat: (a,b) => ((typeOrder[a.t.type] != null ? typeOrder[a.t.type] : 9) - (typeOrder[b.t.type] != null ? typeOrder[b.t.type] : 9)) ||
      subtypeLabel(a.t.subtype).localeCompare(subtypeLabel(b.t.subtype), 'zh'),
    season: (a,b) => (sYear(a.t) - sYear(b.t)) || sName(a.t).localeCompare(sName(b.t), 'zh'),
    date: (a,b) => String(a.t.date || '9999').localeCompare(String(b.t.date || '9999')),
    rank: (a,b) => ((a.rank == null ? 1e9 : a.rank) - (b.rank == null ? 1e9 : b.rank))
  };
  hist.sort((a,b) => {
    for(const k of teamHistorySort){ const r = cmpFns[k](a,b); if(r) return r; }
    return (b.t.createdAt || 0) - (a.t.createdAt || 0);
  });
  const hEl = $('team-history');
  if(hist.length === 0){
    hEl.innerHTML = '<div class="empty">该赛年暂无参赛记录。</div>';
  } else {
    let html = '<div class="table-wrap"><table><thead><tr>' +
      teamHistoryTh('赛事','name') + teamHistoryTh('分类','cat') + teamHistoryTh('赛年','season') +
      teamHistoryTh('日期','date') + (hasRel ? '<th>队名</th>' : '') + teamHistoryTh('最终名次','rank') +
      '</tr></thead><tbody>';
    hist.forEach(h => {
      html += '<tr><td><a class="clickable" onclick="openTournament(\'' + h.t.id + '\')">' + esc(h.t.name) + '</a></td>' +
        '<td>' + typeBadge(h.t.type) + ' ' + esc(subtypeLabel(h.t.subtype)) + '</td>' +
        '<td>' + (h.t.seasonId ? esc((getSeason(h.t.seasonId)||{}).name || '') : '—') + '</td>' +
        '<td>' + esc(h.t.date || '—') + '</td>' +
        (hasRel ? '<td>' + h.members.map(m => teamSwatch(m, true)).join('、') + '</td>' : '') +
        '<td>' + (h.rank ? rankHtml(h.rank) : '—') + '</td></tr>';
    });
    html += '</tbody></table></div>';
    hEl.innerHTML = html;
  }
}
function teamHistoryTh(label, key){
  const i = teamHistorySort.indexOf(key);
  return '<th class="sort-th" title="点击排序（可多选，后选为主）" onclick="toggleTeamHistorySort(\'' + key + '\')">' + label +
    (i >= 0 ? '<span class="sort-mark">' + (i + 1) + '</span>' : '') + '</th>';
}
function toggleTeamHistorySort(key){
  const i = teamHistorySort.indexOf(key);
  if(i >= 0) teamHistorySort.splice(i, 1); else teamHistorySort.unshift(key);
  renderTeamHistory(getClub(currentClubId));
}
function renderTeamH2h(c){
  const gset = new Set(relatedIdsOf(c));
  const h2h = {};
  state.tournaments.forEach(t => {
    if(teamSeasonFilter && t.seasonId !== teamSeasonFilter) return;
    (t.stages || []).forEach(s => (s.matches || []).forEach(m => {
      const aIn = gset.has(m.teamAId), bIn = gset.has(m.teamBId);
      if(!aIn && !bIn) return;
      if(aIn && bIn) return; // 关联队伍内部对局（同一沿革），不计入
      const me = aIn ? m.teamAId : m.teamBId;
      const opp = aIn ? m.teamBId : m.teamAId;
      if(!opp) return;
      if(!h2h[opp]) h2h[opp] = { w: 0, l: 0 };
      const w = matchWinner(m);
      if(w === me) h2h[opp].w++;
      else if(w && w !== 'draw') h2h[opp].l++;
    }));
  });
  const opps = Object.keys(h2h).map(id => ({ id: id, w: h2h[id].w, l: h2h[id].l, total: h2h[id].w + h2h[id].l })).sort((a,b) => b.total - a.total);
  const hhEl = $('team-h2h');
  if(opps.length === 0){
    hhEl.innerHTML = '<div class="empty">该赛年暂无对阵记录。</div>';
  } else {
    let html = '<div class="table-wrap"><table><thead><tr><th>对手</th><th>胜</th><th>负</th><th>总场次</th></tr></thead><tbody>';
    opps.forEach(o => {
      html += '<tr><td>' + teamSwatch(o.id, true) + '</td><td><b>' + o.w + '</b></td><td>' + o.l + '</td><td>' + o.total + '</td></tr>';
    });
    html += '</tbody></table></div>';
    hhEl.innerHTML = html;
  }
}

/* ============================================================
   搜索
   ============================================================ */
function onSearchInput(){
  const q = $('search-input').value.trim();
  if(!q){ if(view === 'search') go('dashboard'); else render(); return; }
  view = 'search';
  document.querySelectorAll('.view').forEach(el => el.classList.remove('on'));
  $('view-search').classList.add('on');
  document.querySelectorAll('.nav-link').forEach(a => a.classList.remove('active'));
  renderBreadcrumb();
  renderSearch();
}
function renderSearch(){
  const q = $('search-input').value.trim().toLowerCase();
  const el = $('search-results');
  if(!q){ el.innerHTML = ''; return; }
  const clubs = state.clubs.filter(c => (c.name || '').toLowerCase().includes(q) || (c.shortName || '').toLowerCase().includes(q) || (c.note || '').toLowerCase().includes(q));
  const tours = state.tournaments.filter(t => (t.name || '').toLowerCase().includes(q) || (subtypeLabel(t.subtype) || '').toLowerCase().includes(q));
  let html = '<div class="section"><h2>队伍（' + clubs.length + '）</h2>';
  if(clubs.length === 0) html += '<div class="empty">无匹配队伍</div>';
  else {
    html += '<div class="table-wrap"><table><thead><tr><th>队伍</th><th>类别</th><th>赛区/席位</th></tr></thead><tbody>';
    clubs.forEach(c => {
      const extra = c.category === 'external' ? (REGIONS[c.region] || '') : c.category === 'hupl' ? (c.seat === 'temporary' ? '临时席位' : '固定席位') : '—';
      html += '<tr><td><a class="clickable" onclick="openTeam(\'' + c.id + '\')">' + teamSwatch(c.id, true) + '</a></td><td>' + categoryBadge(c.category) + '</td><td>' + esc(extra) + '</td></tr>';
    });
    html += '</tbody></table></div>';
  }
  html += '</div>';
  html += '<div class="section"><h2>赛事（' + tours.length + '）</h2>';
  if(tours.length === 0) html += '<div class="empty">无匹配赛事</div>';
  else html += '<div class="cards">' + tours.map(tournamentCard).join('') + '</div>';
  html += '</div>';
  el.innerHTML = html;
}

/* ============================================================
   队伍选择弹窗
   ============================================================ */
function openTeamPicker(target){
  teamPicker = { target: target, selected: new Set(), query: '' };
  // 预选
  if(target === 'tournament'){
    const t = getTournament(currentTournamentId);
    (t.teamIds || []).forEach(id => teamPicker.selected.add(id));
  } else if(target.startsWith('season-points:')){
    const p = getSeason(target.split(':')[1]).points;
    (p.clubIds || []).forEach(id => teamPicker.selected.add(id));
  } else if(target.startsWith('tournament-points:')){
    const p = getTournament(target.split(':')[1]).points;
    (p.clubIds || []).forEach(id => teamPicker.selected.add(id));
  } else if(target.startsWith('link:')){
    const c = getClub(target.split(':')[1]);
    (c.relatedIds || []).forEach(id => teamPicker.selected.add(id));
  }
  $('team-picker-title').textContent = target === 'tournament' ? '选择参赛队伍' : (target.startsWith('link:') ? '选择要关联的队伍' : '选择积分表队伍');
  $('team-picker-search').value = '';
  $('team-picker-bulk').value = '';
  $('team-picker-bulk-create').checked = false;
  $('team-picker-bulk-status').textContent = '';
  renderTeamPickerList();
  openModal('modal-team-picker');
}
/* 批量粘贴队名：在俱乐部池里识别（含近似纠正），一次性勾选 */
function pickerBulkAdd(){
  if(!teamPicker) return;
  const raw = $('team-picker-bulk').value;
  const tokens = String(raw || '').split(/[\s,，;；|、/]+/).map(s => s.trim()).filter(Boolean);
  if(!tokens.length){ toast('请先粘贴队伍名（空格 / 逗号 / 换行分隔）', 'err'); return; }
  const create = $('team-picker-bulk-create').checked;
  const idx = clubLookupIndex();
  let added = 0; const corrected = [], unknown = [], created = [];
  tokens.forEach(tok => {
    const key = tok.toLowerCase();
    const list = idx.get(key);
    let club = list && list.length ? list[0] : null;
    if(club){
      if(!teamPicker.selected.has(club.id)){ teamPicker.selected.add(club.id); added++; }
      return;
    }
    const hit = fuzzyMatchClub(tok, state.clubs);
    if(hit){
      if(!teamPicker.selected.has(hit.id)){ teamPicker.selected.add(hit.id); added++; }
      corrected.push(tok + ' → ' + (hit.shortName || hit.name));
      return;
    }
    if(create){
      const c = {
        id: uid('c'), createdAt: Date.now(), name: tok, shortName: tok,
        category: 'external', seat: null, region: null, color: '#8899aa',
        note: '批量添加自动创建', relatedIds: []
      };
      state.clubs.push(c);
      teamPicker.selected.add(c.id);
      created.push(tok);
      idx.set(key, [c]);
      return;
    }
    unknown.push(tok);
  });
  if(created.length) saveState();
  renderTeamPickerList();
  const parts = ['已勾选 ' + added + ' 支'];
  if(corrected.length) parts.push('自动纠正 ' + corrected.length + ' 支（' + corrected.slice(0, 4).join('、') + (corrected.length > 4 ? '…' : '') + '）');
  if(created.length) parts.push('新建 ' + created.length + ' 支（' + created.slice(0, 4).join('、') + '）');
  if(unknown.length) parts.push('未识别 ' + unknown.length + ' 支：' + unknown.slice(0, 6).join('、'));
  $('team-picker-bulk-status').textContent = parts.join('；');
  if(unknown.length && !create) toast('有 ' + unknown.length + ' 支队伍在俱乐部池里找不到', 'err');
}
function renderTeamPickerList(){
  const cats = { hupl: 0, secondary: 1, external: 2 };
  const q = (teamPicker.query || '').toLowerCase();
  const clubs = state.clubs.slice().sort((a,b) => (cats[a.category] - cats[b.category]) || a.name.localeCompare(b.name, 'zh'))
    .filter(c => !q || clubMatchesQuery(c, q));
  $('team-picker-list').innerHTML = clubs.length ? clubs.map(c =>
    '<span class="team-chip' + (teamPicker.selected.has(c.id) ? ' on' : '') + '" onclick="togglePickerTeam(\'' + c.id + '\')">' +
    '<span class="dot" style="background:' + clubColor(c.id) + '"></span>' + esc(c.name) +
    ' <span class="muted">' + esc(CATEGORY_LABELS[c.category]) + '</span></span>'
  ).join('') : '<span class="muted">没有匹配的队伍</span>';
}
function pickerSearch(q){ teamPicker.query = q; renderTeamPickerList(); }
function togglePickerTeam(id){ if(teamPicker.selected.has(id)) teamPicker.selected.delete(id); else teamPicker.selected.add(id); renderTeamPickerList(); }
function confirmTeamPicker(){
  if(!teamPicker) return;
  const ids = Array.from(teamPicker.selected);
  const target = teamPicker.target;
  let msg = '已更新队伍';
  if(target === 'tournament'){
    const t = getTournament(currentTournamentId);
    t.teamIds = ids;
  } else if(target.startsWith('season-points:')){
    getSeason(target.split(':')[1]).points.clubIds = ids;
  } else if(target.startsWith('tournament-points:')){
    getTournament(target.split(':')[1]).points.clubIds = ids;
  } else if(target.startsWith('link:')){
    const c = getClub(target.split(':')[1]);
    const next = ids.filter(id => id !== c.id && getClub(id));
    const prev = c.relatedIds || [];
    c.relatedIds = next;
    next.forEach(id => { const o = getClub(id); o.relatedIds = o.relatedIds || []; if(!o.relatedIds.includes(c.id)) o.relatedIds.push(c.id); });
    prev.forEach(id => { if(!next.includes(id)){ const o = getClub(id); if(o && o.relatedIds) o.relatedIds = o.relatedIds.filter(x => x !== c.id); } });
    msg = '已更新关联队伍';
  }
  saveState(); closeModal('modal-team-picker');
  render(); toast(msg);
}

/* ============================================================
   弹窗 / 确认
   ============================================================ */
function openModal(id){ $(id).classList.add('open'); }
function closeModal(id){ $(id).classList.remove('open'); }
let promptCallback = null;
function promptDialog(title, message, defaultValue, cb){
  $('prompt-title').textContent = title;
  $('prompt-message').textContent = message;
  $('prompt-input').value = (defaultValue == null) ? '' : String(defaultValue);
  promptCallback = cb;
  $('prompt-ok').onclick = () => {
    const v = $('prompt-input').value;
    const fn = promptCallback;
    promptCallback = null;
    closeModal('modal-prompt');
    if(fn) fn(v);
  };
  openModal('modal-prompt');
  setTimeout(() => { const i = $('prompt-input'); if(i){ i.focus(); i.select(); } }, 30);
}
function confirmDialog(title, message, cb){
  $('confirm-title').textContent = title;
  $('confirm-message').textContent = message;
  confirmCallback = cb;
  openModal('modal-confirm');
}

/* ============================================================
   数据管理：导出 / 导入 / 清空 / 示例
   ============================================================ */
function exportData(){
  downloadJson(state, 'esports-data.json');
  toast('已导出 esports-data.json');
}
function triggerImport(){ $('import-file').click(); }
function onImportFile(e){
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try{ data = JSON.parse(reader.result); }
    catch(err){ toast('文件解析失败：不是有效的 JSON', 'err'); return; }
    confirmDialog('导入数据', '导入将「覆盖」当前全部数据，确定继续吗？\n（文件：' + file.name + '）\n\n当前数据会先自动保存一份快照，可在「存储与备份」里回滚。', async () => {
      await takeSnapshot('导入前');
      state = normalizeState(data);
      saveState();
      currentSeasonId = null; currentTournamentId = null; currentClubId = null;
      go('dashboard');
      toast('导入成功');
    });
  };
  reader.readAsText(file);
}
function confirmClear(){
  confirmDialog('清空数据', '确定清空所有本地数据吗？\n清空前会自动保存一份快照，之后可在「存储与备份」里恢复。\n\n注意：网站内置的数据集默认会在下次打开时自动补齐；本次清空后会自动关闭该补齐（可在「存储与备份」里重新开启）。', async () => {
    await takeSnapshot('清空前');
    state = defaultState();
    state.meta.seedAutoMerge = false;
    saveState();
    currentSeasonId = null; currentTournamentId = null; currentClubId = null;
    go('dashboard');
    toast('已清空全部数据');
  });
}

/* ---------------- 示例数据 ---------------- */
function loadSample(){
  confirmDialog('载入示例数据', '将用一套示例数据「覆盖」当前数据，确定吗？\n覆盖前会自动保存一份快照。内置数据集的自动补齐会暂时关闭。', async () => {
    await takeSnapshot('载入示例前');
    state = buildSampleData();
    state.meta.seedAutoMerge = false;
    saveState();
    currentSeasonId = null; currentTournamentId = null; currentClubId = null;
    go('dashboard');
    toast('已载入示例数据');
  });
}
function buildSampleData(){
  const now = Date.now();
  const clubs = [];
  const addClub = (name, short, category, seat, region, color) => {
    clubs.push({ id: uid('c'), name: name, shortName: short, category: category, seat: seat, region: region, color: color, note: '', createdAt: now++ });
  };
  const hupl = [['黄狗电竞','HG'], ['狂犬战队','KQ'], ['汪星人','WXR'], ['犬皇','QH'], ['吠声','FS'],
    ['狼狗','LG'], ['雪橇犬','XQQ'], ['牧羊犬','MYQ'], ['斗牛犬','DNQ'], ['猎犬','LQ']];
  hupl.forEach(x => addClub(x[0], x[1], 'hupl', 'fixed', null, '#1e3a5f'));
  addClub('幼犬升班马', 'YQ', 'hupl', 'temporary', null, '#3b6ea5');
  addClub('流浪犬', 'LLQ', 'hupl', 'temporary', null, '#4a7fb5');
  const sec = [['犬舍青训','QS'], ['骨头发烧友','GT'], ['尾巴战队','WB'], ['警犬学院','JQ']];
  sec.forEach((x,i) => addClub(x[0], x[1], 'secondary', null, null, ['#2e7d4f','#5b8a3a','#8a6d3b','#3f6d8a'][i]));
  addClub('红狗帝国', 'HO', 'external', null, 'HO', '#b3382c');
  addClub('橙狗联队', 'CH', 'external', null, 'CH', '#d98a2b');
  addClub('绿狗军团', 'LV', 'external', null, 'LV', '#2e7d4f');

  const seasonId = uid('s');
  const huplIds = clubs.filter(c => c.category === 'hupl').map(c => c.id);
  const season = {
    id: seasonId, name: '2026 赛年', year: 2026, note: '黄狗职业一级联赛', createdAt: now++,
    points: { stations: [{ id: uid('st'), name: 'National' }, { id: uid('st'), name: 'the Cup' }, { id: uid('st'), name: 'League Cup' }], clubIds: huplIds, data: {} }
  };
  huplIds.forEach((id, i) => { season.points.data[id] = { [season.points.stations[0].id]: Math.max(0, 60 - i * 7), [season.points.stations[1].id]: Math.max(0, 55 - i * 6), [season.points.stations[2].id]: Math.max(0, 50 - i * 5) }; });

  const tournaments = [];

  // A-League 示例：瑞士轮 + 双败
  const aleagueTeams = clubs.filter(c => c.category === 'secondary').map(c => c.id).concat(huplIds.slice(-2));
  const aleague = {
    id: uid('t'), seasonId: seasonId, name: 'A-League 2026 春季赛', type: 'secondary', subtype: 'aleague',
    date: '2026-03', teamIds: aleagueTeams, note: '', createdAt: now++,
    stages: [], finalStandings: [], points: null
  };
  const swissStage = newStage('swiss', aleagueTeams); swissStage.name = '瑞士轮'; swissStage.config.rounds = 3;
  sequentialPairs(aleagueTeams).forEach(p => swissStage.matches.push({ id: uid('m'), round: '第1轮', groupId: null, bracket: 'winners', teamAId: p.a, teamBId: p.b, scoreA: 2, scoreB: 1, winnerId: '', note: '' }));
  const deStage = newStage('double', aleagueTeams); deStage.name = '双败淘汰';
  aleague.stages = [swissStage, deStage];
  aleague.finalStandings = aleagueTeams.slice(0, 4).map((id, i) => ({ rank: i + 1, clubId: id, note: '' }));
  tournaments.push(aleague);

  // HUPL 分站赛示例
  const national = {
    id: uid('t'), seasonId: seasonId, name: 'HUPL 2026 National', type: 'hupl', subtype: 'national',
    date: '2026-02', teamIds: huplIds, note: '第一阶段', createdAt: now++,
    stages: [], finalStandings: [], points: null
  };
  const natGroup = newStage('group', huplIds); natGroup.name = '小组赛';
  natGroup.config.groups = [{ id: uid('g'), name: 'A组', teamIds: huplIds.slice(0, 6) }, { id: uid('g'), name: 'B组', teamIds: huplIds.slice(6, 12) }];
  natGroup.config.groups.forEach(g => { roundRobin(g.teamIds).forEach(r => r.matches.forEach(p => natGroup.matches.push({ id: uid('m'), round: r.label, groupId: g.id, bracket: 'winners', teamAId: p.a, teamBId: p.b, scoreA: 2, scoreB: 0, winnerId: '', note: '' }))); });
  const natKo = newStage('single', huplIds); natKo.name = '单败淘汰';
  national.stages = [natGroup, natKo];
  national.finalStandings = huplIds.slice(0, 8).map((id, i) => ({ rank: i + 1, clubId: id, note: '' }));
  tournaments.push(national);

  // 国际赛事示例
  const extIds = clubs.filter(c => c.category === 'external').map(c => c.id);
  const wc = {
    id: uid('t'), seasonId: seasonId, name: 'World Championship 2026', type: 'international', subtype: 'worldchampionship',
    date: '2026-11', teamIds: huplIds.slice(0, 4).concat(extIds), note: '', createdAt: now++,
    stages: [newStage('double', [])], finalStandings: [], points: null
  };
  wc.stages[0].name = '双败淘汰';
  tournaments.push(wc);

  // HUDL 示例（带积分表）
  const hudl = {
    id: uid('t'), seasonId: seasonId, name: 'HUDL 2026 分站积分', type: 'secondary', subtype: 'hudl',
    date: '2026', teamIds: clubs.filter(c => c.category === 'secondary').map(c => c.id), note: '次级联赛积分', createdAt: now++,
    stages: [], finalStandings: [],
    points: { stations: [{ id: uid('st'), name: '分站1' }, { id: uid('st'), name: '分站2' }, { id: uid('st'), name: '分站3' }], clubIds: clubs.filter(c => c.category === 'secondary').map(c => c.id), data: {} }
  };
  hudl.points.clubIds.forEach((id, i) => { hudl.points.data[id] = { [hudl.points.stations[0].id]: 30 - i * 5, [hudl.points.stations[1].id]: 25 - i * 3, [hudl.points.stations[2].id]: 20 - i * 4 }; });
  tournaments.push(hudl);

  return { version: 1, meta: { tournamentName: 'The Game', countryName: '黄狗国' }, clubs: clubs, seasons: [season], tournaments: tournaments };
}

/* ============================================================
   批量录入：纯文本 → 对局；可选截图识别（走用户自己的 AI 接口）
   ============================================================ */
const THEGAME_AI_KEY = 'thegame-ai-config-v1';
let bulkState = { stageId: null, parsed: null, rows: null };

function guessBracket(round){
  const r = String(round || '');
  if(/败者组|败者|losers/i.test(r)) return 'losers';
  if(/总决赛|grand\s*final|^final$/i.test(r)) return 'final';
  return 'winners';
}
function cnNum(s){
  const map = { '一':1,'二':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9,'十':10 };
  return String(s == null ? '' : s).replace(/[一二三四五六七八九十]+/g, t => {
    if(t.length === 1) return String(map[t] || t);
    if(t === '十') return '10';
    if(t[0] === '十') return String(10 + (map[t[1]] || 0));
    if(t[1] === '十') return String((map[t[0]] || 0) * 10 + (map[t[2]] || 0));
    return t;
  });
}
function normRound(r){
  let s = cnNum(r).toLowerCase();
  s = s.replace(/\s+/g, '').replace(/第/g, '').replace(/轮/g, '').replace(/round/g, '');
  s = s.replace(/^(双败|单败|淘汰赛|小组赛|循环赛|瑞士轮)/, '');
  return s;
}
/* 从行首拆出「轮次」前缀，例如：双败胜者组第一轮 / 胜者组第2轮 / A组第1轮 / 总决赛 */
function splitRoundPrefix(line){
  const re = /^((?:小组赛|循环赛|瑞士轮|淘汰赛|双败|单败)?(?:[A-Za-z0-9]组)?(?:胜者组|败者组)?(?:第\s*[0-9一二三四五六七八九十百]+\s*轮|总决赛|决赛|半决赛|四分之一决赛|1\/4决赛|[0-9一二三四五六七八九十]+强))[\s:：\-—，,]*/;
  const m = line.match(re);
  if(!m) return null;
  const rest = line.slice(m[0].length).trim();
  return { round: m[1].replace(/\s+/g, ''), rest: rest };
}
/* 解析纯文本，返回 { matches:[{round,a,scoreA,b,scoreB,line}], errors:[] } */
function cleanTeamName(s){
  return String(s == null ? '' : s).replace(/^[（(【\[]+/, '').replace(/[）)】\]。，,.;；]+$/, '');
}
function parseBulkText(text){
  const matches = [], errors = [];
  let round = '';
  const lines = String(text == null ? '' : text).split(/\r?\n/);
  lines.forEach((raw, i) => {
    let line = raw.trim();
    if(!line) return;
    line = line.replace(/^[-*•·]\s*/, '').replace(/^\d+\s*[.、)]\s*/, '');
    // 【轮次】/ [轮次]
    const bracket = line.match(/^[【\[]([^】\]]{1,20})[】\]]\s*(.*)$/);
    if(bracket){
      round = bracket[1].trim();
      line = bracket[2].trim();
    }
    if(!line) return;
    const p = splitRoundPrefix(line);
    if(p){ round = p.round; line = p.rest; }
    if(!line) return;

    let found = false, m;
    const chunks = line.split(/[;；|]/).map(x => x.trim()).filter(Boolean);
    chunks.forEach(chunk => {
      let hit = false;
      const scoreRe = /(\S+)\s+(\d{1,2})\s*[:：比\-–—]\s*(\d{1,2})\s+(\S+)/g;
      while((m = scoreRe.exec(chunk))){
        matches.push({ round: round || '第1轮', a: cleanTeamName(m[1]), scoreA: m[2], scoreB: m[3], b: cleanTeamName(m[4]), line: i + 1 });
        hit = true;
      }
      if(hit) return;
      const vsRe = /(\S+)\s+(?:vs|VS|Vs|v|对)\s+(\S+)/g;
      while((m = vsRe.exec(chunk))){
        matches.push({ round: round || '第1轮', a: cleanTeamName(m[1]), scoreA: '', scoreB: '', b: cleanTeamName(m[2]), line: i + 1 });
        hit = true;
      }
      if(hit) found = true;
      else if(chunk) errors.push('第 ' + (i + 1) + ' 行无法识别：' + chunk);
    });
    if(found) return;

    // 纯轮次行
    if(line.length <= 24 && !/\s/.test(line)) { round = line; errors.pop(); return; }
  });
  return { matches: matches, errors: errors };
}

function clubLookupIndex(){
  const idx = new Map();
  state.clubs.forEach(c => {
    [c.shortName, c.name, c.id].forEach(k => {
      const key = String(k == null ? '' : k).trim().toLowerCase();
      if(!key) return;
      if(!idx.has(key)) idx.set(key, []);
      const arr = idx.get(key);
      if(arr.indexOf(c) < 0) arr.push(c);
    });
  });
  return idx;
}
/* 同一简称可能对应多支队伍：优先选本阶段对阵里出现的，其次选本赛事参赛队伍 */
function pickBulkClub(list, stageIds, eventIds){
  if(!list || !list.length) return null;
  if(stageIds && stageIds.size){
    const hit = list.find(c => stageIds.has(c.id));
    if(hit) return hit;
  }
  if(eventIds && eventIds.size){
    const hit = list.find(c => eventIds.has(c.id));
    if(hit) return hit;
  }
  return list[0];
}

/* ---------------- 队名纠错（OCR / 手打都走这里） ---------------- */
function levenshtein(a, b){
  a = String(a == null ? '' : a);
  b = String(b == null ? '' : b);
  if(a === b) return 0;
  const m = a.length, n = b.length;
  if(!m) return n;
  if(!n) return m;
  let prev = new Array(n + 1), cur = new Array(n + 1);
  for(let j = 0; j <= n; j++) prev[j] = j;
  for(let i = 1; i <= m; i++){
    cur[0] = i;
    for(let j = 1; j <= n; j++){
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const t = prev; prev = cur; cur = t;
  }
  return prev[n];
}
/* OCR 常见混淆字符归一：0/O、1/I/l、5/S、8/B、2/Z */
function ocrNormalize(s){
  return String(s == null ? '' : s).toLowerCase()
    .replace(/0/g, 'o').replace(/1/g, 'i').replace(/l/g, 'i')
    .replace(/5/g, 's').replace(/8/g, 'b').replace(/2/g, 'z');
}
function fuzzyThreshold(len){
  if(len <= 3) return 0;
  if(len <= 5) return 1;
  return 2;
}
/* 在候选队伍里找最接近的名字，找不到返回 null */
function fuzzyMatchClub(token, candidates){
  const raw = String(token == null ? '' : token).trim();
  if(!raw || raw.length < 4) return null;
  const t = ocrNormalize(raw);
  let best = null, bestD = 99;
  (candidates || []).forEach(c => {
    [c.shortName, c.name].forEach(n => {
      const s = ocrNormalize(n);
      if(!s) return;
      if(t[0] !== s[0]) return;                    // 首字符必须一致，避免乱配
      const d = levenshtein(t, s);
      const limit = fuzzyThreshold(Math.min(t.length, s.length));
      if(d <= limit && d < bestD){ best = c; bestD = d; }
    });
  });
  return best;
}
function currentRosterClubs(){
  const t = getTournament(currentTournamentId);
  if(!t) return [];
  return (t.teamIds || []).map(id => getClub(id)).filter(Boolean);
}
/* 解析一个队名：先精确匹配俱乐部池，再按名单优先做近似纠正 */
function resolveClubToken(token, idx, stageIds, eventIds, roster){
  const key = String(token == null ? '' : token).trim().toLowerCase();
  const list = key ? idx.get(key) : null;
  if(list && list.length) return { club: pickBulkClub(list, stageIds, eventIds), corrected: false };
  const pool = (roster && roster.length) ? roster : state.clubs;
  const hit = fuzzyMatchClub(token, pool) || ((roster && roster.length) ? fuzzyMatchClub(token, state.clubs) : null);
  if(hit) return { club: hit, corrected: true };
  return { club: null, corrected: false };
}
function findBulkTarget(s, r){
  if(!r.aId || !r.bId) return null;
  const ms = s.matches || [];
  const same = m => (m.teamAId === r.aId && m.teamBId === r.bId) || (m.teamAId === r.bId && m.teamBId === r.aId);
  const empty = m => (m.scoreA === '' || m.scoreA == null) && (m.scoreB === '' || m.scoreB == null);
  return ms.find(m => same(m) && empty(m) && normRound(m.round) === normRound(r.round)) ||
         ms.find(m => same(m) && empty(m)) ||
         ms.find(m => same(m)) || null;
}

function openBulkEntry(stageId){
  const t = getTournament(currentTournamentId);
  if(!t) return;
  const stages = t.stages || [];
  if(!stages.length){ toast('当前赛事还没有阶段，请先添加赛制阶段', 'err'); return; }
  bulkState = { stageId: stageId || stages[0].id, parsed: null, rows: null };
  $('bulk-stage').innerHTML = stages.map(s =>
    '<option value="' + s.id + '"' + (s.id === bulkState.stageId ? ' selected' : '') + '>' +
    esc(s.name) + ' · ' + esc(FORMAT_LABELS[s.format] || s.format) + ' · ' + (s.matches || []).length + ' 场</option>').join('');
  $('bulk-text').value = '';
  const firstStage = findStage(bulkState.stageId);
  $('bulk-add').checked = !isBracketFormat(firstStage.format) || !(firstStage.matches || []).length;
  $('bulk-overwrite').checked = false;
  $('bulk-create').checked = false;
  $('bulk-preview').innerHTML = '<div class="muted">粘贴或识别出文本后，点「解析预览」查看匹配结果。</div>';
  $('bulk-status').textContent = '';
  const cfg = readAiConfig();
  $('bulk-api-base').value = cfg.base || 'https://api.openai.com/v1';
  $('bulk-api-model').value = cfg.model || 'gpt-4o-mini';
  $('bulk-api-key').value = cfg.key || '';
  $('bulk-image').value = '';
  $('bulk-ocr-status').textContent = '';
  openModal('modal-bulk');
  setTimeout(() => { const el = $('bulk-text'); if(el) el.focus(); }, 40);
}
function bulkStageChanged(){
  const s = findStage($('bulk-stage').value);
  bulkState.stageId = $('bulk-stage').value;
  if(s){ $('bulk-add').checked = !isBracketFormat(s.format); }
  bulkState.parsed = null; bulkState.rows = null;
  $('bulk-preview').innerHTML = '<div class="muted">阶段已切换，请重新解析。</div>';
}
function bulkClear(){
  $('bulk-text').value = '';
  $('bulk-preview').innerHTML = '<div class="muted">已清空。</div>';
  bulkState.parsed = null; bulkState.rows = null;
}

function bulkPreview(){
  const stageId = $('bulk-stage').value;
  const s = findStage(stageId);
  if(!s){ toast('阶段不存在', 'err'); return; }
  const parsed = parseBulkText($('bulk-text').value);
  if(!parsed.matches.length){
    $('bulk-preview').innerHTML = '<div class="store-errs">没有解析出任何对局。格式示例：<code>双败胜者组第1轮 DRE 3:1 DGE</code></div>';
    bulkState.parsed = parsed; bulkState.rows = null;
    return;
  }
  const idx = clubLookupIndex();
  const tour = getTournament(currentTournamentId) || {};
  const eventIds = new Set(tour.teamIds || []);
  const roster = currentRosterClubs();
  const stageIds = new Set();
  (s.matches || []).forEach(m => { if(m.teamAId) stageIds.add(m.teamAId); if(m.teamBId) stageIds.add(m.teamBId); });
  let ambiguous = 0, correctedCount = 0;
  const rows = parsed.matches.map(p => {
    const aRes = resolveClubToken(p.a, idx, stageIds, eventIds, roster);
    const bRes = resolveClubToken(p.b, idx, stageIds, eventIds, roster);
    const a = aRes.club, b = bRes.club;
    const aList = idx.get(String(p.a).toLowerCase()), bList = idx.get(String(p.b).toLowerCase());
    if((aList && aList.length > 1) || (bList && bList.length > 1)) ambiguous++;
    const corrected = !!(aRes.corrected || bRes.corrected);
    if(corrected) correctedCount++;
    return Object.assign({}, p, {
      aId: a && a.id, bId: b && b.id,
      aName: a ? (a.shortName || a.name) : p.a,
      bName: b ? (b.shortName || b.name) : p.b,
      correctedFromA: aRes.corrected && a ? p.a : '',
      correctedFromB: bRes.corrected && b ? p.b : '',
      target: null, state: ''
    });
  });
  rows.forEach(r => {
    r.target = findBulkTarget(s, r);
    if(!r.aId || !r.bId) r.state = '队伍不存在';
    else if(r.target && r.target.scoreA !== '' && r.target.scoreB !== '') r.state = '已有比分';
    else if(r.target) r.state = '填入空位';
    else r.state = $('bulk-add').checked ? '新增对局' : '无对应对局';
  });
  bulkState = { stageId: stageId, parsed: parsed, rows: rows };

  const noTarget = rows.filter(r => !r.target).length;
  let html = '<div class="bulk-summary">共 <b>' + rows.length + '</b> 场 · ' +
    rows.filter(r => r.state === '填入空位').length + ' 场填入空位 · ' +
    rows.filter(r => r.state === '新增对局').length + ' 场新增 · ' +
    rows.filter(r => r.state === '已有比分').length + ' 场已有比分 · ' +
    rows.filter(r => r.state === '队伍不存在').length + ' 场队伍不存在' +
    (correctedCount ? ' · <span class="ok-text">' + correctedCount + ' 场队伍名已自动纠正</span>' : '') +
    (ambiguous ? ' · <span class="warn-text">' + ambiguous + ' 场有同简称队伍，已按本阶段/本赛事优先匹配</span>' : '') + '</div>';
  if(noTarget && !$('bulk-add').checked){
    html += '<div class="bulk-hint">有 ' + noTarget + ' 场暂时没有匹配到空位：如果按轮次顺序录入，上一轮胜者会在写入时自动推进，系统会再次匹配；' +
      '如果这阶段本来就还没对阵，可先点阶段上的「生成对阵」，或勾选「允许新增对局」。</div>';
  }
  html += '<div class="table-wrap" style="max-height:320px;overflow:auto"><table class="plain"><thead><tr>' +
    '<th>轮次</th><th>队伍A</th><th>比分</th><th>队伍B</th><th>处理</th></tr></thead><tbody>';
  rows.forEach(r => {
    const bad = r.state === '队伍不存在';
    html += '<tr' + (bad ? ' class="bulk-bad"' : '') + '>' +
      '<td class="nowrap">' + esc(r.round) + '</td>' +
      '<td>' + esc(r.aName || r.a) + (r.correctedFromA ? ' <span class="muted">（原 ' + esc(r.correctedFromA) + '）</span>' : '') + '</td>' +
      '<td class="nowrap"><b>' + esc(r.scoreA === '' ? '—' : r.scoreA) + ' : ' + esc(r.scoreB === '' ? '—' : r.scoreB) + '</b></td>' +
      '<td>' + esc(r.bName || r.b) + (r.correctedFromB ? ' <span class="muted">（原 ' + esc(r.correctedFromB) + '）</span>' : '') + '</td>' +
      '<td class="nowrap">' + esc(r.state) + '</td></tr>';
  });
  html += '</tbody></table></div>';
  if(parsed.errors.length){
    html += '<div class="store-errs" style="margin-top:8px">' + parsed.errors.map(e => esc(e)).join('<br>') + '</div>';
  }
  $('bulk-preview').innerHTML = html;
  $('bulk-status').textContent = '';
}

async function bulkImport(){
  if(!bulkState.rows || !bulkState.rows.length){ toast('请先点「解析预览」', 'err'); return; }
  const s = findStage(bulkState.stageId);
  if(!s){ toast('阶段不存在', 'err'); return; }
  const opts = {
    create: $('bulk-create').checked,
    add: $('bulk-add').checked,
    overwrite: $('bulk-overwrite').checked
  };
  let unknown = [];
  bulkState.rows.forEach(r => { if(!r.aId) unknown.push(r.a); if(!r.bId) unknown.push(r.b); });
  unknown = uniq(unknown);
  if(unknown.length && !opts.create){
    toast('有 ' + unknown.length + ' 支队伍不存在：' + unknown.slice(0, 6).join('、') + '（可勾选自动创建）', 'err');
    return;
  }
  if(unknown.length && opts.create){
    unknown.forEach(name => {
      state.clubs.push({
        id: uid('c'), createdAt: Date.now(), name: name, shortName: name,
        category: 'external', seat: null, region: null, color: '#8899aa',
        note: '批量录入自动创建', relatedIds: []
      });
    });
    const idx = clubLookupIndex();
    const stageIds = new Set();
    (s.matches || []).forEach(m => { if(m.teamAId) stageIds.add(m.teamAId); if(m.teamBId) stageIds.add(m.teamBId); });
    const eventIds = new Set((getTournament(currentTournamentId) || {}).teamIds || []);
    bulkState.rows.forEach(r => {
      if(!r.aId){ const c = pickBulkClub(idx.get(r.a.toLowerCase()), stageIds, eventIds); r.aId = c && c.id; }
      if(!r.bId){ const c = pickBulkClub(idx.get(r.b.toLowerCase()), stageIds, eventIds); r.bId = c && c.id; }
    });
  }
  let filled = 0, added = 0, skipped = 0;
  bulkState.rows.forEach(r => {
    if(!r.aId || !r.bId){ skipped++; return; }
    // 重新按当前状态找目标：上一行填完比分后，胜者可能已经推进到下一轮
    let m = findBulkTarget(s, r);
    if(m && !opts.overwrite && m.scoreA !== '' && m.scoreB !== ''){ skipped++; return; }
    if(!m){
      if(!opts.add){ skipped++; return; }
      m = {
        id: uid('m'), round: r.round, groupId: null, bracket: guessBracket(r.round),
        teamAId: r.aId, teamBId: r.bId, scoreA: '', scoreB: '', winnerId: '', note: ''
      };
      if(s.format === 'group' && s.config && s.config.groups && s.config.groups[0]) m.groupId = s.config.groups[0].id;
      s.matches.push(m);
      added++;
    }
    const swap = (m.teamAId === r.bId && m.teamBId === r.aId);
    if(!m.teamAId) m.teamAId = r.aId;
    if(!m.teamBId) m.teamBId = r.bId;
    m.scoreA = swap ? r.scoreB : r.scoreA;
    m.scoreB = swap ? r.scoreA : r.scoreB;
    m.winnerId = '';
    filled++;
    if(isBracketFormat(s.format)) advanceFromMatch(s, m);
  });
  saveState();
  refreshStage(s.id);
  closeModal('modal-bulk');
  if(!filled){
    toast('没有写入任何对局：' + skipped + ' 场被跳过' + (opts.add ? '' : '（可勾选「允许新增对局」）'), 'err');
    return;
  }
  toast('已写入 ' + filled + ' 场（新增 ' + added + '，跳过 ' + skipped + '）' +
    (unknown.length ? '，新建队伍 ' + unknown.length + ' 支' : ''), 'ok');
}

/* ---------- 截图识别（可选，调用用户自己的 OpenAI 兼容接口） ---------- */
function readAiConfig(){
  try{ return JSON.parse(localStorage.getItem(THEGAME_AI_KEY) || '{}') || {}; }catch(e){ return {}; }
}
function writeAiConfig(cfg){
  try{ localStorage.setItem(THEGAME_AI_KEY, JSON.stringify(cfg)); }catch(e){ /* 忽略 */ }
}
function fileToDataUrl(file){
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(fr.error || new Error('读取图片失败'));
    fr.readAsDataURL(file);
  });
}
function extractJson(text){
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  const start = s.indexOf('{'), end = s.lastIndexOf('}');
  if(start < 0 || end <= start) throw new Error('返回内容不是 JSON');
  return JSON.parse(s.slice(start, end + 1));
}
function ocrJsonToText(obj){
  const lines = [];
  (obj.rounds || []).forEach(r => {
    lines.push(r.name || '第1轮');
    (r.matches || []).forEach(m => {
      const a = m.a || m.teamA || m.winner || '';
      const b = m.b || m.teamB || m.loser || '';
      if(!a || !b) return;
      const sa = m.scoreA == null ? '' : String(m.scoreA);
      const sb = m.scoreB == null ? '' : String(m.scoreB);
      lines.push(sa === '' || sb === '' ? a + ' vs ' + b : a + ' ' + sa + ':' + sb + ' ' + b);
    });
  });
  return lines.join('\n');
}
/* 把本赛事参赛名单写进提示词，让模型自己往名单上靠 */
function buildOcrPrompt(roster){
  const list = (roster || []).map(c => {
    const s = String(c.shortName || c.name || '').trim();
    const n = String(c.name || '').trim();
    return s && n && s !== n ? s + '（' + n + '）' : (s || n);
  }).filter(Boolean).join('、');
  return '你是电竞赛事数据录入助手。图片是赛制框图或对阵表。' +
    (list
      ? '本赛事的参赛队伍只有：' + list + '。识别出的队名必须来自这份名单；' +
        '如果图上的名字看起来是拼写错误或 OCR 误识别（例如 BOTU、B0TV），' +
        '请对照名单纠正成最接近的队名（例如 BOTU → BOTV），不要输出名单之外的队伍。'
      : '') +
    '请只输出 JSON，不要任何解释，格式为：' +
    '{"rounds":[{"name":"胜者组第1轮","matches":[{"a":"DRE","scoreA":3,"b":"DGE","scoreB":1}]}]}。' +
    '轮次名用图中的分区名（如 胜者组第1轮、败者组第2轮、总决赛）；队伍用名单里的简称；' +
    '比分未知或没填写时 scoreA/scoreB 用空字符串。不要编造队伍或比分。';
}
/* 模型输出后再按名单纠正一次，返回纠正记录 */
function findRosterTeam(name, roster){
  const key = String(name == null ? '' : name).trim().toLowerCase();
  if(!key) return null;
  const exact = (roster || []).find(c =>
    String(c.shortName || '').toLowerCase() === key || String(c.name || '').toLowerCase() === key);
  return exact || fuzzyMatchClub(name, roster);
}
function correctOcrTeams(obj, roster){
  const fixes = [];
  (obj.rounds || []).forEach(r => (r.matches || []).forEach(m => {
    ['a', 'b'].forEach(k => {
      const v = m[k];
      if(!v) return;
      const hit = findRosterTeam(v, roster);
      if(!hit) return;
      const canonical = String(hit.shortName || hit.name || '').trim();
      if(canonical && canonical !== String(v).trim()){
        fixes.push(String(v).trim() + ' → ' + canonical);
        m[k] = canonical;
      }
    });
  }));
  return fixes;
}

async function bulkOcrRecognize(){
  const status = $('bulk-ocr-status');
  const file = ($('bulk-image').files || [])[0];
  if(!file){ status.textContent = '请先选择一张赛制框图/对阵表截图'; return; }
  const cfg = {
    base: $('bulk-api-base').value.trim(),
    model: $('bulk-api-model').value.trim(),
    key: $('bulk-api-key').value.trim()
  };
  if(!cfg.base || !cfg.model || !cfg.key){ status.textContent = '请填写接口地址、模型名和 API Key'; return; }
  writeAiConfig(cfg);
  status.textContent = '正在识别…';
  try{
    const dataUrl = await fileToDataUrl(file);
    const roster = currentRosterClubs();
    const prompt = buildOcrPrompt(roster);
    const res = await fetch(cfg.base.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.key },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0,
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: [
            { type: 'text', text: '请识别这张框图里的所有对局。' },
            { type: 'image_url', image_url: { url: dataUrl } }
          ] }
        ]
      })
    });
    if(!res.ok){
      const body = await res.text();
      throw new Error('接口返回 ' + res.status + '：' + body.slice(0, 200));
    }
    const data = await res.json();
    const content = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    const obj = extractJson(content);
    const fixes = correctOcrTeams(obj, roster);
    const text = ocrJsonToText(obj);
    if(!text.trim()) throw new Error('没有识别出对局');
    $('bulk-text').value = text;
    bulkPreview();
    status.textContent = '识别完成，已填入上方文本框，请核对后点「写入」。' +
      (roster.length ? '（已按本赛事 ' + roster.length + ' 支参赛队伍校对）' : '') +
      (fixes.length ? ' 自动纠正：' + fixes.slice(0, 6).join('、') : '');
  }catch(e){
    status.textContent = '识别失败：' + ((e && e.message) || e);
  }
}

/* ============================================================
   初始化
   ============================================================ */
async function init(){
  // 先兜底一个空状态，保证任何情况下页面都能渲染出来
  state = defaultState();
  // 导航
  document.querySelectorAll('.nav-link').forEach(a => {
    a.addEventListener('click', () => go(a.dataset.view));
  });
  // 搜索
  $('search-input').addEventListener('input', onSearchInput);
  // 确认弹窗按钮
  $('confirm-ok').addEventListener('click', () => { closeModal('modal-confirm'); if(confirmCallback){ const cb = confirmCallback; confirmCallback = null; cb(); } });
  // 导入
  $('import-file').addEventListener('change', onImportFile);
  // 点击遮罩关闭弹窗
  document.querySelectorAll('.modal-overlay').forEach(ov => {
    ov.addEventListener('click', (e) => { if(e.target === ov) ov.classList.remove('open'); });
  });
  // 键盘：Esc 关闭弹窗
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape') document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  });

  // 读取数据：localStorage 先上屏，IndexedDB 在后台补齐（不阻塞渲染）
  try{
    storageInit();
  }catch(e){
    state = defaultState();
    storage.lsOk = false;
    storage.notice = { type: 'err', html: '读取本地数据失败：' + esc((e && e.message) || e) + '。页面已按空数据打开，请先导出/导入备份。' };
  }

  // 内置静态数据集：本地缺什么就补什么（本地有改动的地方不会被覆盖）
  try{ applySeedOnBoot(); }catch(e){ console.warn('内置数据补齐失败', e); }

  go('dashboard');
  showStorageNotice();
  initMultiTabGuard();
}
document.addEventListener('DOMContentLoaded', init);
