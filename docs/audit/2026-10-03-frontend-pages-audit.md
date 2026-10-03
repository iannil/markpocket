# 前端页面审计报告 · 2026-10-03

> **修复状态（2026-10-03 同日）：全部 3 项 P1、27 项 P2 已修复；P3 除下列 5 项说明外全部落地。验证：`tsc --noEmit` ✅、`eslint` ✅、`prettier --check` ✅、`vitest run` 553/553 ✅。**
>
> **浏览器实测补充（同日，生产构建 + agent-browser 全页遍历）：21 张截图全部 PASS。过程中发现并修复 3 个静态审计未覆盖的问题：**
> 1. **`cell.ts` 物化调用参数顺序反转（P0 级，HEAD 即存在）**——`materializeExpressionsForRecord(tx, tableId, recordId, fieldId, userId)` 把 `userId`/`changedFieldId` 传反，dependsOn 永不匹配，**所有依赖表达式的服务端重算从未生效过**（P1-3 的深层根因）。已修 + 回归测试锁定参数顺序。
> 2. **`command-palette.ts` 的 `useSyncExternalStore` 缺 `getServerSnapshot`**（修复时引入）——SSR 报错并触发整页 client-rendering 回退。已补服务端快照。
> 3. **feed 路由导出 `FEED_DEFAULT_LIMIT` 等常量**（HEAD 即存在）——违反 Next 路由导出约束，`next build` 直接失败。已改为模块内常量。
>
> 环境备注：`next dev`（next-rspack 实验性 bundler）在本机完全不水合（干净 HEAD 同样复现，HMR websocket 不连接、无控制台错误）；生产构建水合与功能完全正常。视觉验收基于生产构建完成。
>
> 有意不修（含理由）：
> 1. **grid-editor.tsx 拆分（1185 行 → hooks）**——架构建议而非缺陷；无浏览器验证的纯重构风险大于收益，其中的具体缺陷（Escape 死区、切表残留、写序竞态等）已逐项修复。
> 2. **忘记密码流程**——项目无邮件基础设施（无 SMTP/邮件 SDK），接线一个无法投递的重置 UI 比缺失更糟。
> 3. **Link 目标表 1000 条浏览上限**——<100k 行设计目标内的既有权衡，标签回退保留。
> 4. **keyset 分页替代 offset 窗口**——需服务端协议变更；经分析：插入缺口的持久窗口不存在（每次写入的 ws 广播会失效并重拉全部已加载页，自动闭洞），已在 `use-paged-records.ts` 注释中记录该结论。尝试加"去重差异自动重拉"被验证为有害（对正常重叠误报、死循环）并已回退。
> 5. **statusbar "saved" 按 baseId 过滤**——单标签页内 mutations 只能作用于当前可见 base，语义已等价；已加注释说明。

> 范围：`apps/web/src/app/**` 全部 15 个页面路由及其引用的组件、hooks、tRPC 客户端调用链（server router 仅核对权限/校验假设，不做后端审计）。
> 方法：5 组并行静态审计（全局/认证、bases 列表与详情、settings、表格网格编辑器、公开令牌页），逐文件完整阅读；辅以 `tsc --noEmit`（✅ 零错误）与 `eslint`（✅ 零警告）。
> 严重级别：P0 阻断 / P1 严重 / P2 应修 / P3 建议。

## 总览

| 分组 | P0 | P1 | P2 | P3 | 总评 |
|---|---|---|---|---|---|
| 全局 + 认证（/, login, register, error/loading/404） | 0 | 0 | 3 | ~12 | B+（安全 A，a11y C+） |
| bases 列表/新建/详情/历史 | 0 | 2 | 4 | ~14 | B（架构优，错误态一致性差） |
| settings 六页 | 0 | 0 | 8 | ~14 | B（服务端权限扎实，UX 欠打磨） |
| 表格网格编辑器 | 0 | 1 | 8 | ~15 | B+（亮点多，数据一致性有盲区） |
| 公开令牌页（share/invite/feed） | 0 | 0 | 4 | ~12 | B+（安全骨架强，复合字段未公开化） |

无 P0。整体安全基线显著高于平均水准；问题集中在**错误态处理一致性**、**危险操作确认体系**、**网格编辑器「单格 reconcile」策略盲区**三条主线。

---

## P1（3 项，优先修复）

### P1-1 base 详情布局无服务端成员校验，未授权访问渲染完整应用外壳
- 位置：`apps/web/src/app/bases/[baseId]/layout.tsx:15-30`
- 布局直接信任 URL 参数，只做 `BaseContextProvider`，未调 `caller.base.get` + `notFound()`（全 `/bases` 目录无任何 `notFound` 调用）。数据层安全（`base.get`/`table.list`/`history.listByBase` 均有 `assertRole`），但未授权用户进入 `/bases/<别人id>` 时渲染完整 shell（顶栏/侧栏/状态栏），面包屑显示兜底 "Base"，正文是客户端 FORBIDDEN 错误态。
- 影响：既非 404 也非 403，泄露 base 路由结构存在性，给出误导性重试 UI。
- 修复：layout 服务端调 `caller.base.get({ id: baseId })`，失败 `notFound()`。

### P1-2 历史列表吞掉 `isError`，查询失败被渲染成「没有变更记录」
- 位置：`apps/web/src/components/base-history-list.tsx:24, 36-38`
- `const { data, isLoading } = ...`，`if (!data || data.rows.length === 0)` 走空态分支。FORBIDDEN/网络错误/500 全部伪装成空历史。该组件同时被 `history/page.tsx` 与 `settings/history/page.tsx` 复用，缺陷双处生效；与 P1-1 叠加后未授权用户看到的是「这个 base 没有任何变更」。
- 修复：解构 `isError` 渲染错误态（区分 403），空态仅在 `data && rows.length===0` 时出现。

### P1-3 编辑源字段后，依赖它的 Expression 列本地缓存永不刷新
- 位置：`apps/web/src/app/bases/[baseId]/tables/[tableId]/grid-editor.tsx:258-295`
- `cell.upsert` onSuccess 刻意只回写被编辑的那一个格子且不 invalidate（echo suppression 设计）；但服务端 `cell.ts:277-283` 会同事务重算依赖表达式，广播又以 `exceptUserId` 排除本人。结果：编辑数字列 A 后 `B = A*2` 在本地持续显示旧值，纯单人场景**永远不纠正**。
- 修复：`cell.upsert` 返回同事务重算过的 `(fieldId, value)` 列表，onSuccess 逐个 patch；或客户端按 `dependsOn` 自行重算。

---

## P2（27 项）

### 全局 + 认证
1. **登录/注册错误提示无 `role="alert"`/`aria-live`** — `login/page.tsx:70`、`register/page.tsx:105`。视障用户提交失败无任何反馈；输入框也缺 `aria-invalid`。
2. **密码无最小长度提示，前后端校验不一致** — `register/page.tsx:85-91` 无 `minLength={8}`，服务端 better-auth 默认 8 位，短密码得到未映射的英文报错 "Password too short"。
3. **`getBaseUrl` 服务端分支硬编码 `http://localhost:3000`** — `lib/trpc/client.tsx:12-15`。当前无害，但任何未来 SSR 预取会打错地址（埋雷）。

### bases 列表/新建/详情/历史
4. **`initialData` 缺 `initialDataUpdatedAt`，服务端预取后仍重复请求** — `bases/page.tsx:25-27`。v5 无时间戳时 initialData 立即 stale，layout 注释宣称的 "nothing re-fetches" 不成立。恒传 `initialData`（含空数组）+ `Date.now()` 即可。
5. **`table.create` 无 `onError`，失败静默** — `bases/[baseId]/page.tsx:24-29`。viewer 在空态点 create 被 FORBIDDEN 但无任何反馈。
6. **错误态不区分 FORBIDDEN 与瞬时故障** — `bases/[baseId]/page.tsx:52-67`。403 重试永远失败，权限问题伪装成网络问题。

### settings
7. **删除 base 确认按钮用 primary 样式** — `settings/general/page.tsx:151-153`。不可逆整库删除与主按钮视觉无异，缺 `variant="destructive"`（agent 页 Revoke 同款，`agent/page.tsx:269`）。
8. **settings UI 完全无角色门控** — `settings/members/page.tsx:173-215`。页面不查已存在的 `trpc.member.me`，viewer 面对一排必然 403 的角色下拉/remove/invite/share 控件。
9. **邀请链接只有创建瞬间 3 秒 toast 可复制，错过即永久丢失** — `members/page.tsx:27-30, 91-99`。列表 copy 是死按钮；丢失后只能作废重发。应改为与 Agent token 相同的一次性 Dialog（`agent/page.tsx:233-254` 已有现成模式）。
10. **邀请过期状态不显示** — `members/page.tsx:87-89`。`expiresAt` 已在返回值中但 UI 不渲染，48h 过期的邀请与有效邀请无差别且永久堆积。
11. **危险操作确认三种并存：Dialog / 原生 `confirm()` / 无确认** — 移除成员用 `confirm()`（`members/page.tsx:193`）、删除分享链接**无确认**（`:245-250`）、删 base/撤销 token 用 Dialog。删除分享会立即断掉所有持链接者与 RSS 订阅，必须加确认。
12. **agent 页 SSR/CSR hydration mismatch：origin 服务端为空串** — `settings/agent/page.tsx:56-60, 146-148`。`typeof window === 'undefined' ? ''` 使 MCP 配置 JSON 首帧输出空 URL；应放入 useEffect 后的 state。
13. **CSV 导入 file input 不重置，同一文件无法二次导入** — `packages/plugin-csv/src/client.tsx:29-34`。onChange 后未清空 `e.target.value`，失败重试路径被 UI 堵死。
14. **服务端全量导出所有表，客户端再按勾选过滤** — `settings/export/page.tsx:32-35` + `routers/export.ts:26-89`。只勾 1 张表也要付全量代价；无进度/abort。接口应支持 `tableIds`。

### 表格网格编辑器
15. **选中记录消失后 Escape 死区、选择悬空** — `grid-editor.tsx:731-734` 与 `843-847`。清除选择逻辑在 `r<0` guard 之后永远到不了；`aria-activedescendant` 指向不存在的 DOM；只能靠鼠标点空白自救。
16. **切换 tableId 时组件复用，editing/selectedCell/selectedRows 残留** — `grid-editor.tsx:133, 213-217`。App Router 下 `/b1/t1 → /b2/t2` 复用同一实例，旧表选择悬空。修复：页面层 `<GridEditor key={tableId}>`。
17. **列宽防抖提交触发全表 record.list refetch** — `grid-editor.tsx:313-321, 657-670`。`updateOptions` onSuccess 无条件双 invalidate；拖列宽 = 每 400ms 全分页 refetch 风暴。应按 dirty-keys 区分「行集相关」与纯 UI 选项。
18. **并发 mutation onSuccess 交错，缓存终值可能 ≠ 服务器终值** — `grid-editor.tsx:258-268`。MultiSelect/Link write-through 连点时响应乱序可让多选格静默显示错误集合。需按 `(recordId, fieldId)` 串行化。
19. **LinkTablesProvider value 每渲染重建，所有 Link 格随任意网格状态重渲染** — `link-cell.tsx:48-65`。`useQueries` 结果数组每渲染新引用 → memo 失效 → 重建每目标表 1000 条 Map × N，绕过 MemoCell。本页最大重渲染热点；仿 `use-paged-records.ts:90-96` 的 `dataUpdatedAt` 签名即可。
20. **附件连续上传竞态（Link 同款已修，此处漏修）** — `cell-renderers.tsx:106-124`。第二次上传完成时从渲染闭包旧 `value` 计算，第一个附件 id 被丢弃。
21. **删除字段零确认** — `components/field-config/field-editor-dialog.tsx:211-218`。点 Delete 立即 `remove.mutate`，连带清空整列数据。对比：删视图/恢复历史值都有确认。
22. **删除记录按钮键盘完全不可达** — `grid-row.tsx:160-173`。`tabIndex={-1}` + 纯 hover 显示，键盘/触屏用户无法删除记录。
23. **偏移分页对并发插入无缺口检测** — `use-paged-records.ts:22-48`。两页之间他人插入记录时中间一条被静默跳过。建议迁移 keyset 或校验去重计数。

### 公开令牌页
24. **附件字段在公开页完全不可用** — `share-view.tsx:150-164` + `api/files/[id]/route.ts:28-31`。缩略图 401，点击落到裸 JSON `{"error":"Unauthorized"}`。公开页应隐藏 attachment 缩略图或提供基于 share token 的受限文件代理。
25. **Link 字段把内部 record id 前 8 位当标签** — `share-view.tsx:150-165`（未包 `LinkTablesProvider`，`users={[]}`）→ `link-cell.tsx:75-77` 回退 `id.slice(0,8)`。既泄露内部 id 又像 bug。
26. **loadMore 缺 catch，unhandled rejection 且无用户反馈** — `share-view.tsx:56-75, 174`。失败后按钮静默恢复可点。
27. **全站无 robots/noindex，含 token 的 URL 面可被索引** — `/share/`、`/invite/`、`/feed/` 三处均无 `robots: { index: false }` / `X-Robots-Tag`，全仓无 `robots.ts`。secret URL 一旦外泄可能被搜索引擎收录缓存。

---

## P3 主题清单（约 67 项，按主题归并）

### 可访问性
- 根 `loading.tsx` 加载态无 `role="status"`；`error.tsx`/`not-found.tsx` 标题用 h3 无 h1（`empty-state.tsx:20` 写死）；404 缺 metadata title。
- 历史列表无表格/列表语义、固定列宽、无键盘焦点（`base-history-list.tsx:42-56`）；骨架用 index key。
- 侧栏 base 设置图标仅 hover 可见，键盘/触屏不可达（`sidebar.tsx:103-112`，缺 `focus-visible:opacity-100`）。
- 网格 Tab 序污染：每行行号按钮 + 每列 resize separator 都是 tab stop（约 1500+ 停留点）；缺 Home/End/PageUp；`aria-rowcount` 未计组头行。
- share 页表切换按钮无 `role="tab"`/`aria-current`、`<th>` 无 `scope="col"`、整页无 `<main>`；只读 Boolean 渲染 disabled button。
- invite-view 错误提示无 `role="alert"`。

### 水合与时间
- `timeAgo`/`fmtTime` 在 SSR/水合两端用 `Date.now()`，跨分钟边界 hydration mismatch（`bases/page.tsx:9-15`、`lib/format.ts:18-25`）。
- 相对时间格式化三处重复实现且行为不一致（`bases/page.tsx` / `lib/format.ts` / `statusbar.tsx`）。

### UX 一致性
- 错误反馈双通道（toast + 行内红字）：`bases/new/page.tsx:21,51`、`members/page.tsx:33-36`。
- 错误态无重试入口：`bases/page.tsx:39-50`；成员列表查询失败渲染空列表（`members/page.tsx:145-159`）。
- 导出截断提示通道混乱：general 页 toast.info + 病句 "10,000 of more records"（`general/page.tsx:91`），export 页红色 error 样式（`export/page.tsx:48-53`）。
- 多文件下载依赖 200ms delay 的 click 循环，浏览器多下载拦截无提示（`export/page.tsx:38-47`）。
- 标签命名冲突：settings 默认 tab 叫 `Tables` 但面包屑是 `Settings`，与 general 页 `Settings` 面包屑相同（`settings-tabs.tsx:11-18`）。
- 登录成功 `router.push` 应为 `replace`；register 链接丢失 `callbackUrl`（邀请流程断裂）；已登录访问 /login 无服务端重定向。
- "Already accepted" 邀请重复接受应走成功分支跳转而非红字报错（`invite-view.tsx:18-25`）。

### 输入校验
- name 类输入无长度上限且前后端不一致：`token.create` 有 `max(64)`，而 `base.create/rename`、`table.create/rename` 仅 `min(1)`（`base.ts:41,66`、`table.ts:206,229`）。
- CSV 导入无 loading/进度，可并发导入造成重复数据（`plugin-csv/client.tsx:20-35`）。
- email 未 trim 即提交（`members/page.tsx:48`）。
- 复制路径 `String(currentValue)` 对数组/对象不合格且 promise 未 catch（`grid-editor.tsx:765-768`）。

### 数据与查询效率
- `loadShare` 未用 React `cache()`，一次页面请求重复执行全部查询 2 次（`share/[token]/page.tsx:7-18`；invite 页已正确用 `cache()`）。
- `base.get` 每次导航至少查 2 次（generateMetadata + 客户端 query），未用 `cache()` 桥接（`caller.ts:5-7`、`base-context.tsx:23`）。
- 服务端历史分页（含防漂移 tiebreaker）UI 从不使用，永远只显示 50 条却宣称 "All changes"（`base-history-list.tsx:24`、`history.ts:65-118`）。
- 历史值截断不可展开、无 title（`base-history-list.tsx:52-54`）。
- RSS `public, max-age=60` 使撤销的 share 有最长 60 秒 CDN 残留（`feed/[token]/route.ts:108`）；公开端点无速率限制（仓库已有现成 `createFixedWindowRateLimiter` 可复用）。
- 字段排序三处三个规则：feed 按 name、share 无 orderBy、DB 有 `order_index` 未用（`route.ts:65`、`public-share.ts:104-107`）。
- `publicShare.getBase` 暴露内部 base id 与 share id（`public-share.ts:53`，客户端未使用）。
- User 字段公开页恒显示「—」但原始 user id 仍在载荷中（`public-share.ts:155-161`）。
- share 页首屏记录加载无骨架（`share-view.tsx:127`）；share 页无 OG/description。
- 邀请作废旧 invite 为逐条 UPDATE 无事务（`invite.ts:44-71`）；accept 的 membership 插入与标记非原子（自愈，`invite.ts:131-139`）。
- `feed` RSS `describeValue` UTF-16 截断可能切断代理对（`rss.ts:106`）。

### 网格编辑器其他
- membership 未决时 viewer 闪现完整编辑 UI（`grid-editor.tsx:147-150`）。
- `getItemKey` 组键 `'__null__'` 哨兵可被真实数据撞出重复 key（`grid-editor.tsx:394`）。
- 表头单击即打开字段编辑器，与常见网格排序语义相反（`grid-editor.tsx:1015-1018`）；sticky 表头对齐依赖隐式巧合（应显式 `scrollMargin`）。
- `clipboard.ts`：`Number()` 接受 `0x10`/`1e5` 宽松形态；MultiSelect 逗号拆分与选项名含逗号冲突；多行多列粘贴静默截断无提示。
- cell-history-dock 每次选中即发查询无防抖；原生 `confirm()` 风格割裂。
- Link 目标表只浏览前 1000 条、primary 字段取第一个 text 字段（`link-cell.tsx:44-53`）。
- `relativeDate` 本地时区判定 today/yesterday 与 UTC 显示口径错位（`cell-renderers.tsx:30-39`）。
- filter/sort 条件行 index key（`filter-panel.tsx:177`、`sort-menu.tsx:45`）；add() 固定取 `fields[0]`。
- 文案大小写混乱：`+ Field` / `+ view` / `+ new record` / `No records.`；`http-guards.ts` 注释中英混用。

### 代码组织
- `(auth)/login/layout.tsx` 与 `register/layout.tsx` 逐字符重复，应抽 `(auth)/layout.tsx`。
- 双份 CSV 导出实现（`routers/export.ts` 与 `plugin-csv/server.ts`）上限/排序需同步维护。
- `topbar.tsx:51-58` 合成 KeyboardEvent 开命令面板，依赖 cmdk 实现细节。
- `statusbar` "saved Ns ago" 由全局 MutationCache 驱动，跨 base 误报（`lib/use-last-saved.ts:15-22`）。
- Breadcrumb 用数组下标作 key（`breadcrumb.tsx:19`）；AppShell 对 `table.list` 用 `!` + enabled 双保险（应 `skipToken`）。
- `currentUser.avatarUrl` 传入 shell 但 Topbar 从不渲染（头像链路未接通）。
- 1185 行的 `grid-editor.tsx` 应拆 `use-grid-keyboard` / `use-column-resize` / `use-cell-mutation` + `GridToolbar`/`GridHeader`。
- token 永不过期且 UI 未暴露有效期概念（`tokens.ts:47-55`）；token.create 无速率/数量限制。

---

## 值得肯定的实践（抽样）

- **Open redirect 根治**：`safeCallbackUrl` 用 origin 比较法 + 完整单测（`lib/http-guards.ts:282-291`），`//host`、`/\host`、`javascript:`、percent-encoded 变体全挡。
- **错误页不泄漏 `error.message`**，只展示 digest（`error.tsx:14-15`）；tRPC errorFormatter 掩蔽 INTERNAL 细节防 schema 泄露。
- **服务端权限全覆盖**：所有 mutation 强制 `assertRole`（rank 式三级），未发现任何可绕过路径；非成员与不存在 base 同报 FORBIDDEN，无枚举侧信道。
- **API token 生命周期**：sha256 存储、`timingSafeEqual` 比较、明文仅 mutation 一次性展示（不进 React Query 缓存）、list 只回前缀。
- **公开链路 fail-closed**：view 删除/过期/选项解析失败一律拒绝；hiddenFields 元数据+数据双重剔除；SQL 全参数化 + ILIKE 转义；RSS XML 转义完备且有注入单测。
- **网格编辑器工程细节**：编辑行 rangeExtractor 钉扎实现「滚动不丢草稿」、IME `isComposing` 守卫、防 blur 双提交、分页错误分级、StrictMode 双挂载处理、Last-Write-Wins 与 echo suppression 闭环。
- **last-owner 保护**：`member.ts:22-31` 用 `SELECT FOR UPDATE` 序列化最后一个 owner 的降级竞态。

---

## 建议修复顺序

1. **本周**：P1-1（layout 服务端校验 + notFound）、P1-2（isError 分支）、P1-3（cell.upsert 返回重算集合）。
2. **下一迭代（正确性/数据一致性）**：Escape 死区 + 切表 `<GridEditor key={tableId}>`、agent 页 origin hydration、附件上传竞态、并发 mutation 串行化、initialDataUpdatedAt。
3. **体系化**：统一危险操作确认组件（destructive variant + Dialog，覆盖删 base/删字段/删分享/撤 token/移成员）；settings 区接入 `member.me` 做控件门控；错误态统一分类（403 → 无权限页，其余 Retry）；三处相对时间/字段排序收敛。
4. **公开页专项**：robots.ts + noindex；attachment/link/user 字段的公开化呈现；邀请链接一次性 Dialog。
5. **性能专项**：LinkTablesProvider memo 签名、列宽 dirty-keys invalidate、export `tableIds` 参数、`cache()` 去重（loadShare/caller）。
