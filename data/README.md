# 内置静态数据集

这个目录是网站的「数据底座」。数据不依赖浏览器缓存、localStorage 或 IndexedDB，
而是随网站一起发布的静态文件，换电脑、清缓存、重写前端都不会丢。

| 文件 | 说明 |
| --- | --- |
| `esports-data.json` | 规范化后的数据集，人类可读，是唯一数据源 |
| `seed-data.js` | 由脚本生成，供 `index.html` 用 `<script>` 直接加载（`window.THEGAME_SEED`） |

> 为什么不用 `fetch('data/esports-data.json')`？因为网站常常是直接双击 `index.html`
> 用 `file://` 打开的，浏览器会以 CORS 为由拒绝读取本地 JSON。用 `.js` 包装可以绕开这个限制。

## 怎么更新这份数据

1. 在网站里把数据改好，点右上角「导出」，得到 `esports-data.json`；
2. 用它覆盖项目根目录的源文件（或直接指定路径）；
3. 重新生成：

```bash
node tools/build-seed.mjs                       # 默认读取根目录 esports-data (5).json
node tools/build-seed.mjs 我的导出.json          # 指定源文件
node tools/build-seed.mjs --from data/esports-data.json
```

脚本会做三件事：修复重复的阶段 id、校验引用与框图连线、生成新版本号并写出上面两个文件。
校验不通过会直接失败并列出问题，不会生成半成品。

## 数据契约（改代码前请先读这一段）

一个「赛事」的完整结构：

```
tournament
  id, name, type, subtype, date, seasonId, teamIds[], createdAt
  stages[]                     ← 赛制阶段，按顺序展示
    id, name, format           ← group | swiss | single | double | tiered-double | wc
    config                     ← group: { groups:[{id,name,teamIds[]}] }；swiss: { rounds }
    matches[]                  ← 对局，赛制框图的数据来源
      id, round, bracket       ← bracket: winners | losers
      teamAId, teamBId, scoreA, scoreB, winnerId, note
      nextId, nextSlot         ← 胜者去向（同一阶段内的对局 id）
      loserNextId, loserNextSlot ← 败者去向（双败/分级双败）
  finalStandings[]             ← 最终名次
  points                       ← 可选积分表
```

必须保持的不变量：

1. **阶段 `id` 全局唯一**（复制赛事时最容易违反，已由 `reidCopiedStages()` 修复）；
2. 淘汰赛里 `nextId` / `loserNextId` 必须指向**同一阶段内存在的对局**；
3. `groupId` 必须存在于该阶段的 `config.groups` 中；
4. `teamIds` / `finalStandings[].clubId` 引用 `club.id`，`seasonId` 引用 `season.id`。

### 修改前端/赛制渲染时的约定

- **只读渲染**：框图、表格、积分榜都应当从 `matches` 直接推导，不要因为「换了布局」就重新生成对局数据。
  重新生成（`generateMatches`）是用户显式点击才会发生的操作。
- 如果确实要调整数据结构（比如给对局加字段），请在 `normalizeState()` 里写**向前兼容的迁移**：
  旧字段能读就继续读，新字段缺失时补默认值，永远不要因为字段对不上就整段丢弃。
- 新增赛制时，把新字段加在这里并在 `build-seed.mjs` 的校验里补一条不变量。

## 启动时的行为

- 本地没有数据 → 直接载入内置数据集；
- 本地有数据 → **只补缺失**：缺的赛事/阶段/对局会补回来，已有的内容（包括你改过的比分）不会被覆盖；
- 同名队伍不会重复添加：如果本地已经有一支「简称 + 全称」都相同的队伍（早期用「快速导入」建的），
  内置赛事会自动引用本地这支队伍的 id，而不是再造一份；已经重复的会在启动时自动合并，
  内置 id → 本地 id 的对应关系记录在 `meta.seedClubAlias` 里，之后不会再次分裂；
- 你手动删掉的内置条目会记进 `meta.seedRemoved`，不会每次启动都复活；
- 这些行为可以在网站「存储与备份 → 内置数据集」里开关，也可以「用内置数据覆盖」一键还原。
