#!/usr/bin/env node
/**
 * 把导出的 esports-data JSON 固化成网站的内置静态数据集。
 *
 * 用法：
 *   node tools/build-seed.mjs                     # 默认读取项目根目录的 esports-data (5).json
 *   node tools/build-seed.mjs 某个导出文件.json    # 指定源文件
 *   node tools/build-seed.mjs --from data/esports-data.json
 *
 * 产物：
 *   data/esports-data.json   规范化后的数据集（人类可读，作为唯一数据源）
 *   data/seed-data.js        给浏览器 <script> 直接加载的版本（file:// 下 fetch 会被 CORS 拦截，所以用 JS 包装）
 *
 * 这个脚本只做「结构修复 + 校验 + 打包」，不会丢字段：
 * 对局里的 nextId / loserNextId / bracket / round / scores 等全部原样保留，
 * 保证任何赛制框图渲染器都能还原原有对阵结构。
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function die(msg) {
  console.error('✗ ' + msg);
  process.exit(1);
}

const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const flagFrom = process.argv.includes('--from') ? process.argv[process.argv.indexOf('--from') + 1] : null;
const defaultSrc = path.join(ROOT, 'esports-data (5).json');
let src = flagFrom || args[0] || (fs.existsSync(defaultSrc) ? defaultSrc : path.join(ROOT, 'data', 'esports-data.json'));
src = path.resolve(ROOT, src);
if (!fs.existsSync(src)) die('找不到源文件：' + src);

const raw = fs.readFileSync(src, 'utf8').replace(/^\uFEFF/, '');
let data;
try { data = JSON.parse(raw); } catch (e) { die('JSON 解析失败：' + e.message); }

/* ---------- 1. 结构修复：阶段 id 必须全局唯一 ---------- */
function repair(input) {
  const d = JSON.parse(JSON.stringify(input));
  const stageIds = new Set();
  let renamed = 0;
  for (const t of d.tournaments || []) {
    for (const st of t.stages || []) {
      if (!st.id) { st.id = 'stg_' + Math.random().toString(36).slice(2, 10); renamed++; }
      if (stageIds.has(st.id)) {
        let n = 2, candidate = st.id + '_' + n;
        while (stageIds.has(candidate)) { n++; candidate = st.id + '_' + n; }
        st.id = candidate;
        renamed++;
      }
      stageIds.add(st.id);
    }
  }
  return { data: d, renamed };
}

/* ---------- 2. 校验：结构、引用、框图连线 ---------- */
function validate(d) {
  const errors = [];
  const warnings = [];
  const stageIds = new Set();
  const clubIds = new Set((d.clubs || []).map(c => c.id));
  const seasonIds = new Set((d.seasons || []).map(s => s.id));

  for (const t of d.tournaments || []) {
    if (t.seasonId && !seasonIds.has(t.seasonId)) warnings.push(`赛事「${t.name}」的 seasonId 不存在：${t.seasonId}`);
    for (const id of t.teamIds || []) if (!clubIds.has(id)) warnings.push(`赛事「${t.name}」引用了不存在的队伍：${id}`);

    for (const st of t.stages || []) {
      if (stageIds.has(st.id)) errors.push(`阶段 id 重复：${st.id}（${t.name}/${st.name}）`);
      stageIds.add(st.id);

      const matches = st.matches || [];
      const byId = new Map(matches.map(m => [m.id, m]));
      if (st.format === 'single' || st.format === 'double' || st.format === 'tiered-double') {
        for (const m of matches) {
          if (m.nextId && !byId.has(m.nextId)) errors.push(`「${t.name}/${st.name}」对局 ${m.id} 的 nextId 指向不存在的对局`);
          if (m.loserNextId && !byId.has(m.loserNextId)) errors.push(`「${t.name}/${st.name}」对局 ${m.id} 的 loserNextId 指向不存在的对局`);
        }
      }
      if (st.format === 'group') {
        const gids = new Set(((st.config && st.config.groups) || []).map(g => g.id));
        for (const m of matches) if (m.groupId && !gids.has(m.groupId)) warnings.push(`「${t.name}/${st.name}」对局 ${m.id} 的 groupId 不存在`);
      }
    }
  }
  return { errors, warnings };
}

const repaired = repair(data);
const { errors, warnings } = validate(repaired.data);
if (errors.length) {
  console.error('✗ 数据校验失败：');
  errors.slice(0, 20).forEach(e => console.error('   - ' + e));
  process.exit(1);
}
if (warnings.length) {
  console.log(`! ${warnings.length} 条警告（不阻塞构建）：`);
  warnings.slice(0, 8).forEach(w => console.log('   - ' + w));
}

/* ---------- 3. 统计与版本号 ---------- */
const canonical = JSON.stringify(repaired.data);
const version = 'seed-' + crypto.createHash('sha1').update(canonical).digest('hex').slice(0, 10);
const stats = {
  clubs: (repaired.data.clubs || []).length,
  seasons: (repaired.data.seasons || []).length,
  tournaments: (repaired.data.tournaments || []).length,
  stages: (repaired.data.tournaments || []).reduce((a, t) => a + (t.stages || []).length, 0),
  matches: (repaired.data.tournaments || []).reduce((a, t) => a + (t.stages || []).reduce((b, s) => b + (s.matches || []).length, 0), 0)
};

/* ---------- 4. 输出 ---------- */
const dataDir = path.join(ROOT, 'data');
fs.mkdirSync(dataDir, { recursive: true });

const jsonOut = path.join(dataDir, 'esports-data.json');
fs.writeFileSync(jsonOut, JSON.stringify(repaired.data, null, 2) + '\n', 'utf8');

const seedJs =
  '/* 自动生成，请勿手改：由 tools/build-seed.mjs 从 data/esports-data.json 生成 */\n' +
  '/* 内置数据集：' + version + ' · ' + stats.tournaments + ' 赛事 / ' + stats.matches + ' 对局 */\n' +
  'window.THEGAME_SEED = {\n' +
  '  version: ' + JSON.stringify(version) + ',\n' +
  '  name: "内置数据集",\n' +
  '  generatedAt: ' + JSON.stringify(new Date().toISOString()) + ',\n' +
  '  stats: ' + JSON.stringify(stats) + ',\n' +
  '  data: ' + canonical + '\n' +
  '};\n';
fs.writeFileSync(path.join(dataDir, 'seed-data.js'), seedJs, 'utf8');

console.log('✓ 源文件：' + path.relative(ROOT, src));
console.log('✓ 规范化：' + stats.clubs + ' 队伍 · ' + stats.seasons + ' 赛年 · ' + stats.tournaments + ' 赛事 · ' + stats.stages + ' 阶段 · ' + stats.matches + ' 对局');
console.log('✓ 修复重复阶段 id：' + repaired.renamed + ' 处');
console.log('✓ 版本号：' + version);
console.log('✓ 输出：data/esports-data.json（' + (fs.statSync(jsonOut).size / 1024).toFixed(1) + ' KB）');
console.log('✓ 输出：data/seed-data.js（' + (fs.statSync(path.join(dataDir, 'seed-data.js')).size / 1024).toFixed(1) + ' KB）');
