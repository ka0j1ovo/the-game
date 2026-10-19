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
const FORMAT_LABELS = { group: '小组赛', swiss: '瑞士轮', single: '单败赛制', double: '双败赛制', wc: 'WC赛制' };
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
let filters = { clubCategory: 'all', tournamentType: 'all' };
let teamPicker = null;       // { target, selected:Set }
let tForm = null;            // 新建赛事临时表单 { formats:[], teams:Set }
let quickFill = { stageId: '', queue: [] };  // 快捷填入：当前阶段与待填队伍队列
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

/* ---------------- 存储 ---------------- */
function defaultState(){
  return {
    version: 1,
    meta: { tournamentName: 'The Game', countryName: '黄狗国' },
    clubs: [], seasons: [], tournaments: []
  };
}
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultState();
    const s = JSON.parse(raw);
    return Object.assign(defaultState(), s);
  }catch(e){ return defaultState(); }
}
function saveState(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch(e){ toast('保存失败：' + e.message, 'err'); }
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

  // 最近赛事
  const recent = state.tournaments.slice().sort((a,b) => (b.createdAt||0) - (a.createdAt||0)).slice(0, 6);
  html += '<div class="section"><h2>最近赛事</h2>';
  if(recent.length === 0){
    html += '<div class="empty">暂无赛事。</div>';
  } else {
    html += '<div class="cards">' + recent.map(tournamentCard).join('') + '</div>';
  }
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
  html += '<div class="table-wrap"><table><thead><tr><th>排名</th><th>队伍</th>';
  p.stations.forEach(st => {
    html += '<th><div style="display:flex;align-items:center;gap:4px">' + esc(st.name) +
      '<span class="clickable" title="删除该分站" onclick="removeStation(\'' + ctx + '\',\'' + ownerId + '\',\'' + st.id + '\')">×</span></div></th>';
  });
  html += '<th>总分</th><th style="width:40px"></th></tr></thead><tbody>';
  p.clubIds.forEach(cid => {
    const rowIdx = p.clubIds.indexOf(cid);
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

  let list = state.tournaments.slice();
  if(filters.tournamentType !== 'all') list = list.filter(t => t.type === filters.tournamentType);
  const typeOrder = { secondary: 0, hupl: 1, international: 2 };
  list.sort((a,b) => (typeOrder[a.type] - typeOrder[b.type]) || a.name.localeCompare(b.name, 'zh'));

  const el = $('tournament-list');
  if(list.length === 0){
    el.innerHTML = '<div class="empty">暂无赛事。点击「新建赛事」开始。</div>';
    return;
  }
  let html = '<div class="table-wrap"><table><thead><tr>' +
    '<th>赛事</th><th>分类</th><th>子类型</th><th>赛年</th><th>日期</th><th>赛制</th><th>队伍数</th><th style="width:70px">操作</th></tr></thead><tbody>';
  list.forEach(t => {
    const fmts = (t.stages || []).map(s => FORMAT_LABELS[s.format] || s.format).join(' + ') || '—';
    html += '<tr>' +
      '<td><a class="clickable" onclick="openTournament(\'' + t.id + '\')">' + esc(t.name) + '</a></td>' +
      '<td>' + typeBadge(t.type) + '</td>' +
      '<td>' + esc(subtypeLabel(t.subtype)) + '</td>' +
      '<td>' + (t.seasonId ? '<a class="clickable" onclick="openSeason(\'' + t.seasonId + '\')">' + esc((getSeason(t.seasonId)||{}).name || '') + '</a>' : '—') + '</td>' +
      '<td>' + esc(t.date || '—') + '</td>' +
      '<td>' + esc(fmts) + '</td>' +
      '<td>' + (t.teamIds || []).length + '</td>' +
      '<td><button class="btn btn-sm" onclick="openTournament(\'' + t.id + '\')">打开</button></td>' +
      '</tr>';
  });
  html += '</tbody></table></div>';
  el.innerHTML = html;
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
  $('t-copy').innerHTML = '<option value="">（不复制）</option>' +
    state.tournaments.slice().sort((a,b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map(x => '<option value="' + x.id + '">' + esc(x.name) + '</option>').join('');
  $('t-copy').value = '';
  onTournamentTypeChange();
  renderTournamentFormatChips();
  renderTournamentFormatOrder();
  renderTournamentTeamChips();
  openModal('modal-tournament');
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
  const formats = [['group','小组赛'], ['swiss','瑞士轮'], ['single','单败赛制'], ['double','双败赛制'], ['wc','WC赛制']];
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
function toggleTeamChip(id){ if(tForm.teams.has(id)) tForm.teams.delete(id); else tForm.teams.add(id); renderTournamentTeamChips(); }

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
      t.stages = clone(src.stages || []);
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
  if(format === 'single' || format === 'double') s.config = {};
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
  (t.stages || []).forEach(s => { if(s.format === 'single' || s.format === 'double') drawBracketConnectors(s.id); });
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
    html += '<button class="btn btn-sm btn-danger-text" onclick="clearStageTeams(\'' + s.id + '\')">清空队伍</button>' +
      '<button class="btn btn-sm btn-danger-text" onclick="deleteStage(\'' + s.id + '\')">删阶段</button>';
  } else {
    html += '<button class="btn btn-sm" onclick="generateMatches(\'' + s.id + '\')">生成对阵</button>' +
      '<button class="btn btn-sm" onclick="addMatch(\'' + s.id + '\')">+ 对局</button>' +
      '<button class="btn btn-sm btn-danger-text" onclick="clearStageTeams(\'' + s.id + '\')">清空队伍</button>' +
      '<button class="btn btn-sm btn-danger-text" onclick="deleteStage(\'' + s.id + '\')">删阶段</button>';
  }
  html += '</div></div>';
  html += '<div id="qf-panel-' + s.id + '">' + quickFillPanelHtml(t, s) + '</div>';
  if(s.format === 'wc'){
    html += '<div id="stage-body-' + s.id + '">' + wcStageBodyHtml(t, s) + '</div>';
  } else if(s.format === 'single' || s.format === 'double'){
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
  } else if(s.format === 'single' || s.format === 'double'){
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
  const gen = buildGeneratedMatches(t, s);
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
  // WB_r (r≥2) 败者 → 败者组第 (2r-2) 轮（A 位）
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
  if(s.format === 'double'){
    const win = ms.filter(m => m.bracket === 'winners');
    const los = ms.filter(m => m.bracket === 'losers');
    const fin = ms.filter(m => m.bracket === 'final');
    return '<div class="bracket-wrap" data-wrap="' + s.id + '">' +
      '<div class="bracket-double">' +
        '<div class="bracket-double-left">' +
          '<div class="bracket-zone"><h3>胜者组</h3>' + bracketColumnsHtml(t, s, win) + '</div>' +
          '<div class="bracket-zone"><h3>败者组</h3>' + bracketColumnsHtml(t, s, los) + '</div>' +
        '</div>' +
        (fin.length ? '<div class="bracket-zone bracket-double-final"><h3>总决赛</h3>' + bracketColumnsHtml(t, s, fin) + '</div>' : '') +
      '</div>' +
    '</div>';
  }
  return '<div class="bracket-wrap" data-wrap="' + s.id + '"><div class="bracket-zone">' + bracketColumnsHtml(t, s, ms) + '</div></div>';
}
function bracketColumnsHtml(t, s, ms){
  if(!ms.length) return '<div class="empty" style="padding:18px">暂无对局，点击「生成对阵」创建 Bracket。</div>';
  const cols = [], idx = {};
  ms.forEach(m => {
    const r = m.round || '未定轮次';
    if(idx[r] == null){ idx[r] = cols.length; cols.push({ label: r, matches: [] }); }
    cols[idx[r]].matches.push(m);
  });
  let html = '<div class="bracket">';
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
  hist.sort((a,b) => (b.t.createdAt || 0) - (a.t.createdAt || 0));
  const hEl = $('team-history');
  if(hist.length === 0){
    hEl.innerHTML = '<div class="empty">该赛年暂无参赛记录。</div>';
  } else {
    let html = '<div class="table-wrap"><table><thead><tr><th>赛事</th><th>分类</th><th>赛年</th><th>日期</th>' + (hasRel ? '<th>队名</th>' : '') + '<th>最终名次</th></tr></thead><tbody>';
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
  renderTeamPickerList();
  openModal('modal-team-picker');
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
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'esports-data.json';
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(a.href);
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
    confirmDialog('导入数据', '导入将「覆盖」当前全部数据，确定继续吗？\n（文件：' + file.name + '）', () => {
      state = Object.assign(defaultState(), data);
      if(!Array.isArray(state.clubs)) state.clubs = [];
      if(!Array.isArray(state.seasons)) state.seasons = [];
      if(!Array.isArray(state.tournaments)) state.tournaments = [];
      saveState();
      currentSeasonId = null; currentTournamentId = null; currentClubId = null;
      go('dashboard');
      toast('导入成功');
    });
  };
  reader.readAsText(file);
}
function confirmClear(){
  confirmDialog('清空数据', '确定清空所有本地数据吗？\n此操作不可恢复，建议先「导出」备份。', () => {
    state = defaultState();
    saveState();
    currentSeasonId = null; currentTournamentId = null; currentClubId = null;
    go('dashboard');
    toast('已清空全部数据');
  });
}

/* ---------------- 示例数据 ---------------- */
function loadSample(){
  confirmDialog('载入示例数据', '将用一套示例数据「覆盖」当前数据，确定吗？', () => {
    state = buildSampleData();
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
   初始化
   ============================================================ */
function init(){
  state = loadState();
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
  go('dashboard');
}
document.addEventListener('DOMContentLoaded', init);
