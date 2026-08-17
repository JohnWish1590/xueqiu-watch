# 更新日志（Changelog）

本文件记录雪哨（xueqiu-watch）的所有重要变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范。

> 版本号单一来源为 `manifest.json` 的 `version` 字段；本文件与之手动同步。
> 日期格式 `YYYY-MM-DD`；历史版本日期不可考时仅写 `YYYY-MM`（月精度，不编造具体日）。

## [1.5.4] - 2026-08-17

> 🛡️ **彻底解决雪球 WAF「访问被阻断」（重要）**。根因：雪哨每 `intervalMin`（默认 2 分钟）对特别关注分组里 N 个用户**3 路并发**逐个打 `user_timeline.json`，请求过于密集被雪球 WAF 判为爬虫/CC，返回「您的访问被阻断」HTML 阻断页。原代码不识别阻断页（JSON 解析失败误报「不是 JSON」）、不熔断，导致每轮每个用户重复撞墙，风控越锁越死，且阻断页会污染浏览器里所有雪球标签页。

### 修复

- **识别阻断页 + 熔断**：`looksLikeBlockPage()` 识别 body 含「访问被阻断/安全威胁/被阻断」等特征（含 403/503 + body 检测），抛 `[BLOCKED]` 错误；`fetchJSON` 捕获后触发熔断（`rlTrip`），停止本轮、指数退避（5→10→20→30 分钟），冷却期内 `checkOnce` 直接跳过。
- **串行化请求**：`mapConcurrent(users, 3)` → `mapSerial(users, 1.2~2.2s 随机间隔)`，把 N 个请求均匀铺开，杜绝并发突发。
- **降频**：`intervalMin` 默认 2→5 分钟；`scheduleAlarm` 下限 3 分钟，防止手动设过低触发风控。
- **跨 SW 重启持久化**：熔断状态存 `chrome.storage.local['rateLimit']`，Service Worker 被浏览器杀掉后重启仍保留冷却期，不会重启即再撞墙。
- **测试**：新增场景 13（阻断页 → 熔断 + 冷却期跳过），断言 61 PASS / 0 FAIL。

## [1.5.3] - 2026-08-11

> 🐛 **特别关注分组超一页时漏人（严重）**。原 `getSpecialFollowUsers` 取成员只请求 `friendships/groups/members.json` 的**第 1 页**，不翻页。雪球该接口默认每页约 20 人，若「特别关注」分组人数超过一页，靠后的成员会被整体漏掉——表现为「某人在雪球里是特别关注、雪哨却没取到」。新增 `fetchGroupMembersAll(gid)` 按 `page` 分页拉全（每页 20，最多 50 页 ≈ 1000 人，到末页或 `maxPage` 即止）。`test_harness` 新增场景 A（25 人 / 2 页）锁定该回归，断言 56 PASS / 0 FAIL。

### 修复

- **特别关注漏人**：`background.js` 取成员改为分页（详见上方说明）。

## [1.5.2] - 2026-07-27

> 🐛 **弹窗垂直位置再校正（贴到「红线」）**。1.5.1 用写死的 `BROWSER_CHROME_HEIGHT = 150` 把窗口推得过低，弹窗整体落在红线（用户期望的弹窗顶部最高位置）下方一大截。本版改为按屏幕 DPI 动态估算浏览器顶部栏高度，使弹窗顶部精确落在标签栏/地址栏下方、贴近红线，不再受显示缩放影响。

### 修复
- **`snapTop()` 改为 DPI 感知**：原 `top = workArea.top + 150`（写死）在不同缩放下偏差大。现按 `window.devicePixelRatio` 动态估算浏览器顶栏高度（`100%≈108px / 125%≈135px / 150%≈162px`，+4px 安全留边），弹窗顶部刚好停在浏览器顶栏下方（红线处）。多屏/任务栏在顶等场景仍沿用 `chrome.system.display` 取真实屏 workArea，不破坏 v1.4.10 安全设计。
- **清理**：删除 `alert.js` 中已不再使用的 `BROWSER_CHROME_HEIGHT` 常量（计算改由 DPI 动态得出）。
- 测试：`test_harness` 复跑 **53 PASS / 0 FAIL**。

## [1.5.1] - 2026-07-26

> 🐛 **修复弹窗高度遮挡浏览器标签栏**。本版仅修这一处，无功能变更。

### 修复
- **弹窗垂直锚定到标签栏下方**：根因为 `alert.js` 中 `BROWSER_CHROME_HEIGHT = 150` 常量定义了却从未被使用，且 `background.js` 的 `openAlertWindow` 创建窗口时不传 `top`，导致 Chrome 默认把小窗落在屏幕最顶端、盖住标签栏。`alert.js` 新增 `snapTop()`，用 `chrome.system.display.getInfo` 取出当前屏内容区顶部并加上 150px 浏览器 chrome 留白作为窗口 `top`，窗口刚好停在标签栏下方；沿用 `snapToRight` 的 `update` 写法，不破坏 v1.4.10 的多屏安全设计。
- **高度上限下调**：`resizeToContent` 上限 `600 → 540`（与文档「240~540px」一致，改善「太高」观感）；`background.js` 弹窗初始高度 `520 → 360`（随即被 `resizeToContent` 按内容校正）。
- 测试：`test_harness` 复跑 **53 PASS / 0 FAIL**。

### 升级提示
- 已装用户请在开发者模式重新加载（指向本地源码文件夹）即可生效；GitHub 发布的 zip 为本文件夹打包快照。

## [1.5.0] - 2026-07-26

> 🔧 **依据第三方代码评审（18 项意见）做一次集中重构**。逐条字节级核验后，真问题全部修复，架构项全部落地，评审中的乱码/CJK 误报经字节验证未改。已装用户请开发者模式重新加载覆盖升级。

### 修复（真 bug / 风险）
- **#1 轮询静默卡死**：`sendMessageWithTimeout` 原在 `setTimeout` 回调里 `throw`，错误不进 Promise 链 → content script 挂起时永不 reject、轮询永久卡住。改为 `Promise.race([chrome.tabs.sendMessage(tabId, msg), timeoutP])`，超时真正 reject。
- **#3 空轮询 8 秒**：`waitTabComplete` 标签页中途关闭时 `catch` 空转 → 仍每 300ms 轮询到 8s 超时。改为 `catch` 内 `clearInterval + resolve(false)` 立即判定失败。
- **#4 删除 Cookie 死路径**：`getXueqiuCookies` / `fetchWithCookie` 在「无雪球标签页」场景永远失败（跨域 fetch 手动设 `Cookie` 属 forbidden header 被静默丢弃 + SW 自身 credentials 无登录态）。采用方案 A：删除两个死函数与 `fetchJSON` 的第③兜底分支；取数失败时提示「请保持至少一个雪球标签页打开」。测试场景 6b 同步为诚实行为（`ok=false` + 错误含「无法获取登录态」）。
- **#5 通知跳转 url 竞态**：`notifyNewPosts` 的 `urlMap` 改用**模块级内存缓存** + 异步 flush 到 storage，避免「读-改-写」竞态；`openPost` 优先读内存，命中即直接打开，未命中再回退 storage。
- **#6 卡片顺序不按时间**：`checkOnce` 合并所有用户新帖后缺全局排序 → 弹窗卡片顺序混乱。末尾新增 `newAll.sort((a,b)=>Number(b.id)-Number(a.id))`，全局按时间线倒序。
- **#18 emoji 被劈半**：`truncate` 原用 `s.length`/字符串下标切分，代理对（emoji 等）会从中断开成半个字符。改用 `Array.from(s)` 按码点切分，保证边界完整。

### 架构优化
- **#7 消息路由 dispatch map**：`onMessage` 约 140 行 `if (msg.type===...)` 长链改为 `msgHandlers` 对象 + 统一 `Promise.resolve().then(handler).then(sendResponse).catch(...)` 包装，新增消息类型只加一行；保留 `return true` 异步契约。
- **#8 since_id 防御式增量**：`getUserTimeline(userId, page, since)` 在 `since>0` 时附加 `&since_id=`，减少流量与 429 概率；同时保留 `checkOnce` 客户端 id 过滤作安全网（雪球接口万一不认 since_id 仍正确）。
- **#9 并发抓取池**：新增 `mapConcurrent(items, limit, fn)`（默认并发 3）替代 `checkOnce` 内串行 `for...of`，多用户检测延迟显著下降。
- **#10 统一响应解析**：抽出 `parseXQResponse(r, url)` 处理 `{status, text}`，`fetchJSON` 的 scripting 注入与 content script 两条路径共用，消除重复解析与不一致。
- **#11 离屏文档冷启动检查**：`ensureOffscreen` 在创建前用 `chrome.offscreen.hasDocument?.()` 询问文档是否真实存在（SW 重启后内存 `offscreenReady` 归零但文档可能仍在），避免重复 `createDocument` 触发 exists 错误分支。
- **#12 贴边时间轴循环化**：`alert.js` 初始化里 5 个散落的魔法数字 `setTimeout(...60/250/600/1200/2000)` 合并为常量数组 `SNAP_TIMELINE` + `forEach` 循环，行为不变、便于调参、消除复制粘贴。
- **#14 stripHtml 增强**：新增移除 HTML 注释 / `<style>` / `<script>` 整段；块级标签（`</p> </div> </li> </h1-6> </tr>`）转换行；实体解码补全 `&nbsp; &amp; &#数字; &lt; &gt; &quot; &apos; &hellip; &mdash; &ndash;` 并归一 `&nbsp;`/`&#160;` 为普通空格；`&amp;` 先于其他实体解码以正确处理双重转义。原有测试 `'<p>aa</p><br>b<b>x</b>' === 'aa\nbx'` 仍通过。
- **#15 启动引导 ready Promise**：原 urlMap 恢复 IIFE 改为模块级 `ready` Promise；`onInstalled` / `onStartup` / `onAlarm` 三个监听器 `await ready` 后再工作，杜绝 SW 冷启动竞态。

### 文档 / 代码风格
- **#13 README 版本徽章同步**：`1.4.3 → 1.5.0`（链接同步至 v1.5.0）；manifest `description` 经字节扫描确认干净无乱码（评审该条为误报）。

### 评审误报（经字节级验证，未改原写法）
- **#17 源码乱码 = 误报**：Python 字节级扫描全部 `.js/.html/.json`（含 popup/options/content/background），均合法 UTF-8、无 BOM、零乱码串（闆/鎶撳彇/鏂笘/銆? 均无）。大神看到的乱码是其阅读工具对中文渲染/拷贝残影。
- **#2 "异常被空 catch 吞" = 机制误报**：`getXueqiuCookies` 本就有 `if (chrome.cookies && chrome.cookies.getAll)` 守卫、不抛异常；其底层结论（无标签页场景不工作）与 #4 一致，已随 #4 一并处理。
- **#16 物理模块拆分 = 采用替代方案**：评审建议拆成多个 ES module。鉴于 `test_harness.js` 用 `vm.runInContext` 加载**单文件** `background.js` 并依赖全局函数暴露，物理拆分会破坏整套测试网。决策为**单文件内模块化**（dispatch map + 清晰分段注释），等价获得可读性收益且不重写测试桩。

> 🧪 回归：全部 53 条单元测试断言通过（0 FAIL）。

## [1.4.10] - 2026-07-26

> 🐛 **多显示器弹窗创建失败 + 弹窗宽度/布局反复调试最终定稿**。已装用户请开发者模式重新加载覆盖升级。

### 修复
- **多显示器弹窗创建失败**：`background.js` 原按浏览器窗口位置算 `left`，副屏下 `left` 超出主屏可见范围 → Chrome 报 `Bounds must be at least 50% within visible screen space` 拒绝创建。改为**不预设 left/top**，由 `alert.js` 的 `snapToRight()` 精确定位。
- **多屏贴边坐标错误**：`snapToRight()` 原用 `window.screen.width`（窗口所在屏本地宽）配合 `window.screenX`（全局虚拟坐标）→ 副屏 gap 算成负值、推错屏。改为用 `chrome.system.display.getInfo()` 取真实显示器边界，找窗口当前所在屏的 workArea 右沿定位。
- **弹窗宽度最终定稿 440px（外部）**：
  - ❌ 曾试 `440 → 360`（太窄，头部「已读全部+关闭+明亮|黑暗」被截断）
  - ❌ 试 `380` + body 固定 `width:380px`（Chrome 弹窗 `width` 是**外部宽**，内部要扣边框 ~8-10px → 实际 ~370px 容器装不下 380px 内容 → 溢出）
  - ❌ 去掉 body width 自适应（`outerW` 仅 ~380 → 内部 ~370px 还是不够装头部按钮）
  - ✅ 最终：`background.js` 窗口外部宽 **440px**（内部 ~430px 够用），`alert.html` body **不设固定 width**，自适应窗口内部空间；头尾按钮一行完整显示。
- **去掉弹窗内圆角/边框**：`alert.html` 的 `html,body` 原带 `border:1px solid + border-radius:12px`，但 Chrome 弹窗窗口本身有边框，内部再圆角视觉冗余 → 删除（卡片圆角保留）。
- **滚动条消除**：列表 `overflow-y: auto → hidden`，高度由 `alert.js` 的 `resizeToContent()` 动态测量内容后设置（MIN 240 / MAX 600），不再出现竖滚动条。
- **关键认知**：Chrome `chrome.windows.create({width})` 的 `width` 是**窗口外部宽**（含 OS 边框），不是页面内容宽。页面 CSS 的 `width` 若等于外部 `width`，必然溢出。弹窗页面应**不设固定 width** 让 body 自适应窗口内部，窗口大小只由 `background.js` 的 `width` 决定。

> 🎛️ **外观微调用户反馈四连**：
> 1. **主题按钮当前态改蓝色**：「明亮/黑暗」分段按钮激活的那一格用蓝色底白字（与「已读全部」同款 `#1E6FFF`），一眼识别当前主题，不再用红色。
> 2. **顶部/底部空白等大**：头部与底部 padding 统一为 `10px`，header→首卡 与 末卡→footer 视觉间距恒为 24px，不受人数（1人/2人/5人…）影响。
> 3. **最多显示 3 张卡片**：超出部分折叠为「▼ 还有 N人 · M条未读（展开）」，点击展开其余卡片并显示「▲ 收起折叠内容」。
> 4. **折叠行左对齐**：「▼ 还有…」与底部说明文字同一条左对齐竖线（25px）。
>
> 已装用户请开发者模式重新加载覆盖升级。

## [1.4.8] - 2026-07-26

> 📐 **头部/底部与卡片内容左对齐**。头部「N人·N条未读」和底部说明文字左缩进至跟卡片头像对齐（25px = 列表padding 14px + 卡片padding 11px）。已装用户请开发者模式重新加载覆盖升级。

## [1.4.7] - 2026-07-26

> 🎛️ **头部新增明亮/黑暗分段切换按钮**。已装用户请开发者模式重新加载覆盖升级。

### Added
- **头部主题切换**：`已读全部` `关闭` 右侧新增 `明亮 | 黑暗` 分段按钮，点击即时切换并持久化到 storage
- 当前主题高亮（红底白字）；`3 人 · N 条未读` 留在最左，其余按钮经弹性占位符 `hd-spacer` 推到最右对齐

## [1.4.6] - 2026-07-26

> 🎨 **卡片容器修复：内容不溢出圆角框**。已装用户请开发者模式重新加载覆盖升级。

### Fixed
- **卡片内容溢出**：`.row`（卡片模式）添加 `overflow: hidden`，确保头像、名字、摘要全部在圆角框内，文字不再溢出到框外
- **回归 CSS 截断**：摘要改回 `-webkit-line-clamp: 2` + `overflow: hidden`，去掉 JS Canvas 截断方案（简化代码，CSS 原生支持 CJK 字符边界）

## [1.4.5] - 2026-07-26

> 🔧 **贴边闭环校正 + CJK 文字截断修复**。已装用户请开发者模式重新加载覆盖升级。

### Fixed
- **贴边仍不生效（闭环校正）**：v1.4.3~1.4.4 的 `snapToRight()` 只做一次「测→设」就结束，但 Chrome 的 DWM/窗口管理器可能在设置后异步微调位置（特别是 Windows 上），导致我们设对了又被推回来。本次改为**递归闭环**——每次设完位置后等 150ms 再重测，若仍有间隙则继续推，最多 3 轮。配合 5 个时间点的初始化调用，最多可执行 15 次校正。
- **帖子摘要文字截断出现半个 CJK 字符**（如"心非"、"窗口自"）：原 CSS `-webkit-line-clamp: 2` 按「行」截断但不尊重 CJK 字符边界，会在行尾切掉半个汉字。改为 JS `truncateTextToLines()` 函数——用 Canvas `measureText()` 逐字符测量实际渲染宽度，按像素精确断行，保证不切半字，末尾加 `…` 省略号。

### Changed
- `.summary` CSS 移除 `-webkit-line-clamp` / `-webkit-box` 属性（截断逻辑已由 JS 接管），保留 `word-break: break-word` + `overflow-wrap: break-word` 作为安全兜底。

---

## [1.4.4] - 2026-07-26

> 🛡️ **根治空白孤儿窗口（chrome://newtab）问题**。已装用户请开发者模式重新加载覆盖升级。

### Fixed
- **空白 `chrome://newtab` 孤儿窗口反复弹出（根因修复）**：MV3 Service Worker 被浏览器空闲 ~5 分钟后杀掉 → 内存变量 `alertWinIds` 归零 → 旧弹窗还在但 SW 不知道其 ID → 扩展更新后旧弹窗 URL 从 `alert.html` 变成 `chrome://newtab`（Chrome 对失效扩展页面的默认回退）→ `findExistingAlertWin()` 只认 `alert.html` URL，匹配不上孤儿 → 以为没窗口又新建 → `maybeRepopAlert()` 每轮轮询都触发 → **堆出几十个空白窗口**。本次三管齐下：
  1. **`alertWinIds` 持久化到 `storage.local`**：SW 重启后自动恢复，不再丢失窗口 ID
  2. **增强 `findExistingAlertWin()` 扫描**：除正常 `alert.html` 匹配外，新增「孤儿兜底」——识别 `chrome://newtab` / `about:blank` + 弹窗尺寸（380~500 × 200~600）的 popup 窗口，当作 alert 孤儿复用并导航回 `alert.html`
  3. **创建前清理孤儿 + 创建后验证 URL**：新弹窗创建前先扫描关闭残留孤儿；创建后 3 秒延迟验证实际 URL 是否为 `alert.html`，若不是则自动关闭此异常窗口
- **`maybeRepopAlert()` 防抖**：两次重弹之间至少间隔 60 秒，避免 SW 重启后每轮轮询都重复创建窗口

### Changed
- **`closeAllAlertWindows()` 增强清理范围**：不只关 `alert.html` 的窗口，也清理符合孤儿特征的 popup（防止手动关闭时漏掉）
- **`onRemoved` 监听器同步持久化**：窗口被关闭时立即同步 `alertWinIds` 到 storage

---

## [1.4.3] - 2026-07-26

> ⚠️ **贴边根因修复 + 动态高度修正（内容不再被截断）**。已装用户请开发者模式重新加载覆盖升级。

### Fixed
- **弹窗依旧不贴边（第 5 次修复，根因终于找到）**：v1.4.2 的 `snapToRight()` 用的是 `window.screen.availWidth`（**工作区宽度 = 屏幕物理宽度减去任务栏等系统 UI 占用**），在 Windows 上这个值可能比真实屏宽小 80~128px，导致算出的"屏幕右边界"本身就偏左——**永远贴不上**。本次改为使用 `window.screen.width`（**完整物理屏幕像素宽度**），确保右边界计算精确到物理边缘。
- **弹窗内容被截断（第二条卡片及 footer 被窗口底部切掉）**：`resizeToContent()` 测量的是 DOM 内容高度，直接传给 `chrome.windows.update({ height })`——但此 API 的 height 参数是**窗口外部高度（含 Windows 标题栏 ~30-38px）**，导致实际内容区比预期少了一整个标题栏的高度。本次修正为 `desiredContentHeight + (outerHeight - innerHeight)`，把标题栏开销加回目标高度。

### Changed
- **初始窗口高度**从 360px 提升到 420px（在动态高度生效前更安全，减少首帧截断概率）。
- **贴边/高度校正重试增加到 5 个时间点**（60/250/600/1200/2000ms），覆盖 DWM 稳定、字体加载、动画结束等各种延迟场景。
- **高度自适应日志增强**：每次 resizeToContent 都打印「内容 + 头尾 + 标题栏 → 设定」的明细，方便排查。

---

## [1.4.2] - 2026-07-26

> ⚠️ **贴边策略重构 + 按钮布局修正 + 去星号**。已装用户请开发者模式重新加载覆盖升级。

### Fixed
- **贴边策略从根重构**：v1.4.1 及之前所有版本，background.js 一直用 `system.display` 的坐标（无论主屏/浏览器所在屏）算 left，在用户环境下**始终不贴边**（~78px 空隙）。本次彻底换策略：**background.js 不再算精确 left**（只给一个保守的「偏右余量」初始落点），**完全由 alert.js 内部的 `snapToRight()` 用 `window.screen.availLeft + availWidth` 做精确定位**——弹窗内部的 screen API 与 Chrome 渲染引擎同源坐标，不受任何外部坐标系偏差影响。分 4 个时间点（60ms/250ms/600ms/1200ms）反复校正，覆盖 DWM 稳定、字体渲染等时机。
- **按钮溢出窗口**：顶栏「已读全部」+「关闭」两个按钮从右侧移到**左侧紧跟人数后面**（`[1人·4条未读] [已读全部] [关闭]`），不再被挤出右边界。

### Changed
- **去掉未读数前的 ★ 星号**：未读数从 `★ N 人 · M 条` 改为 `N 人 · M 条`（更简洁）。
- **header 布局改为全靠左**：去掉 `justify-content: space-between` 和 `.hd-right` 容器，所有控件（人数+双按钮）在一行内左排列，右侧留空。
- **贴边日志增强**：snapToRight 每次调用都打印完整坐标（availLeft/availWidth/screenX/outerWidth/gap），方便排查定位问题。
- **background.js 精简**：删除 `getScreenForRect()` / `getPrimaryDisplayBounds()` / post-create 校正逻辑（全部由 alert.js 接管），减少出错面。

### Known Issues
- **空白小窗口频繁弹出**：用户反馈改代码后出现额外的空白 popup 窗口。疑似 service worker 重启后 `alertWinIds` 被清空 → `findExistingAlertWin()` 找不到已有弹窗 → 又建了一个新的。本次已加强日志（创建时打 id），下次复现时请把日志里「弹窗已创建 id=」和「贴边检测」条目发我，用于确认是否为重复创建。

---

## [1.4.1] - 2026-07-26

> ⚠️ **贴边从根修复 + 弹窗高度动态自适应 + 头部/卡片视觉修正**。已装用户请开发者模式重新加载覆盖升级，无需重新配置。

### Fixed
- **弹窗依旧不贴边（v1.4.0 遗留）**：根因是定位一直用「主屏」坐标，而你的浏览器窗口若不在主屏、或处于多屏 / 非整数 DPI 缩放时，`system.display` 的坐标系与 `chrome.windows.create` 实际落点错位，导致右侧仍留 ~78px 空隙。本次改为**以浏览器窗口实际所在屏幕**（按窗口中心点 `getScreenForRect` 命中对应 `display`）计算右边界 `left = 屏幕右 - 宽度`，且创建后读回实际位置时用**同一块屏幕**的右边界做二次校正，从根消除跨屏 / DPI 错位。弹窗内部 `snapToRight()` 兜底也改用 `window.screen.availLeft + availWidth`（弹窗自身屏幕坐标），不再误用主屏宽度。

### Changed
- **弹窗高度动态自适应**：不再固定 500px。渲染后按真实内容高度（实测各卡片 / 行高度 + 间距 + 上下留白）自动调整窗口高度，**1 人少量帖 → 紧凑矮小、留白少；2~3 人更多帖 → 自动增高**；夹在 `[240, 540]` 之间（超出滚动）。上下（header / footer）固定，中间列表区随内容伸缩，避免「内容少却大段空白」。
- **头部精简**：去掉顶栏重复的「❄ 雪哨」logo 与标题（窗口标题栏已显示「雪哨」，内部不再重复），未读数改为 `★ N 人 · M 条未读` 置于左侧，右侧两个按钮（已读全部 / 关闭）从此不再被挤出窗口。
- **底部提示左对齐**：「点击卡片打开并标记已读 · 3分钟未操作自动关闭」由居中改为**左对齐**，与顶栏左侧对齐，长文案不再被右侧截断。
- **卡片底色可辨**：明亮模式卡片底色由纯白改为浅灰 `#F3F4F6`（暗色 `#2A2A30`），与纯白窗体拉开层级，卡片边界清晰可见。

---

## [1.4.0] - 2026-07-26

> ⚠️ **外观可配置 + 弹窗贴边精校补强**。已装用户请开发者模式重新加载覆盖升级，无需重新配置。

### Added
- **弹窗外观可配置**：设置页新增「外观设置」区块，可独立选择**弹窗布局**（紧凑精准·卡片式 / 收件箱式·分隔线行）与**弹窗主题**（明亮 / 黑暗），存储于 `appearance`，下次弹窗生效；切换即时写入，无需点保存。
- **两种布局**：`card`（卡片式，圆角边框 + 马卡龙头像 + 双行摘要）、`inbox`（收件箱式，无卡片框、分隔线分行、单行摘要，一屏容纳更多条）。
- **两种主题**：`light`（白底）与 `dark`（深灰底 #1E1E22 + 浅字），同一套布局翻转配色。共 2×2 = 4 种组合，设置页任选。

### Changed
- **弹窗 UI 重写**（alert.html + alert.js）：改用 CSS 变量驱动主题/布局，严格按设计稿交付——红色雪花 logo（❄ 形）、顶栏「已读全部」+「关闭」双按钮、未读数红角标移至博主名右侧、去掉高饱蓝与毛玻璃、改为扁平干净风格。
- 弹窗尺寸 420×480 → **440×500**，容纳双按钮且避免底部提示截断。
- 头像改为低饱和马卡龙色**圆角方块**（非正圆），与卡片/行风格统一。

### Fixed
- **弹窗贴边精校补强**：v1.3.3 仅靠 background.js 基于 `system.display` 的坐标校正，在 DPI 缩放下会与 `chrome.windows.create` 坐标系错位（用户实测仍有 ~78px 空隙）。本次在弹窗内部新增 `snapToRight()`，改用 `window.screen` 坐标（与 create 同一坐标系，不受 DPI 偏差影响）计算右侧间隙并 `chrome.windows.update` 右移补平，从根上消除空隙。

---

## [1.3.3] - 2026-07-26

> ⚠️ **弹窗贴边修复（补强）**。已装用户请开发者模式重新加载覆盖升级。

### Fixed
- **弹窗仍不贴边（v1.3.2 遗留）**：仅改用 `bounds` 取屏幕宽度还不够——Windows 上 `type:'popup'` 窗口创建后，系统边框 / DWM 会把实际右边界比设定值**左移几像素**，留下可见间隙。本次新增**创建后读回实际位置、按右侧间隙微调**的校正逻辑（`chrome.windows.create` → `chrome.windows.get` 读实际 `left/width` → `chrome.windows.update` 右移 `gap` 像素），保证真正紧贴物理屏幕右边缘。同时显式加 `state:'normal'` 避免被吸附行为干扰。

---

## [1.3.2] - 2026-07-26

> ⚠️ **UI 重构 + 日志策略优化 + 弹窗贴边修复**。已装用户请开发者模式重新加载覆盖升级，无需重新配置。

### Changed
- **弹窗 UI 全面重构**（alert.html + alert.js）：
  - 顶栏由高饱和蓝渐变改为**浅色毛玻璃风格**（`backdrop-filter: blur(12px)` + 半透明白底），视觉更轻盈精致。
  - 窗口宽度从 360px 加宽至 **420px**（+17%），高度 460→480px，内容呼吸感更强。
  - 头像色板从高饱和蓝/绿/粉改为**马卡龙低饱和色系**（柔蓝、鼠尾草绿、藕粉、奶茶等 8 色），不再刺眼。
  - 角标颜色从蓝色改为**红色**（`#F53F3F`），更符合"未读/提醒"的通用语义。
  - 卡片样式：`0.5px` 细边框 → `1px #EFEFEF` + `box-shadow: 0 2px 8px rgba(0,0,0,.04)` 微阴影，悬浮时加深。
  - 按钮从半透明白底改为**圆角线框风格**（hover 变蓝），与整体轻量风格统一。
  - 字号阶梯规范化：用户名 **14px Bold / #1D2129**、正文 **12px / #4E5969**、时间/底部 **11px / #86909C**。
  - 底部提示字号从 10.5px 提升到 11px，颜色统一为 `#86909C`。

### Fixed
- **弹窗贴边修复**：横向定位改用屏幕完整边界（`bounds`）而非工作区（`workArea`），确保弹窗右边缘**完全紧贴屏幕物理边缘**无间隙；fallback 路径同步移除多余的 `-16px` 偏移。
- **日志保留策略**：所有日志（含 ERROR）现在统一 **7 天自动清理**（此前 ERROR 永久保留会导致 1597 条刷屏堆积）。冷启动加载、落盘、导出三个环节均加入超期过滤；新增 `LOG_RETENTION_MS = 7d` 常量与 `pruneOld()` 通用函数。

---

## [1.3.1] - 2026-07-26

> ⚠️ **功能性回归修复版本，已装用户请直接覆盖升级（开发者模式重新加载），无需重新配置。**

### Fixed
- 修复 v1.3.0 引入的弹窗完全不弹出的严重 bug：上一版为让弹窗标题栏显示「雪哨」，误在 `chrome.windows.create` 的 `createData` 中传入了 API 不支持的 `title` 字段，导致整个创建调用被 Chrome 拒绝（`Error: Unexpected property: 'title'`），弹窗静默失败仅留系统通知。
- 标题栏显示「雪哨」改由 `alert.html` 自身的 `<title>` 承担（popup 窗口会显示页面标题），移除非法 `title` 字段后弹窗恢复正常。
- 同步新增弹窗创建失败的 ERROR 日志（此前为静默失败，难以排查）。

---

## [1.3.0] - 2026-07-23

> ⚠️ **品牌更名版本，运行时无破坏性变更，已装用户可直接覆盖升级，无需重新配置。** 本次仅品牌命名、文档体系规范化与发布流程建设，扩展的权限、存储结构、设置项与对外行为均与 v1.2.2 完全一致。

### Added
- 产品正式定名「雪哨（xueqiu-watch）」，GitHub 仓库迁移至 `https://github.com/JohnWish1590/xueqiu-watch`（旧 `xueqiu-special-follow-notifier` 与曾用 `xue-watch` 均已重定向至此）。
- 新增文档体系：`README`（使用者入口）、`CHANGELOG`（变更史）、`RELEASE`（Release Notes 模板与规范）、`docs/QUICKSTART.md`（部署/快速开始）、`docs/ARCHITECTURE.md`（文档体系与发布架构设计稿）。
- 新增发布流程：GitHub Releases + 打包 `xueqiu-watch-v<version>.zip`（用户包，不含开发期文件）。

### Changed
- `manifest.json` 的 `name` 由「雪球特别关注 新帖提醒」改为「雪哨」。
- 所有文档与界面中的仓库链接统一指向新仓库地址 `https://github.com/JohnWish1590/xueqiu-watch`。
- 明确本期（v1.3.0）**暂不上架 Chrome Web Store**，仅以开发者模式分发；`STORE_GUIDE.md` 作为未来上架预留。

### Fixed
- （本次为纯文档 / 品牌发布，无运行时逻辑修复。）

---

## [1.2.2] - 2026-07
### Fixed
- 修复弹窗在 MV3 Service Worker 重启后重复堆积的 bug（改用窗口集合 + 真实扫描复用孤儿窗，单例不重建）。

## [1.2.0] - 2026-07
### Added
- 新增「一键诊断」与「运行日志」面板，便于排查登录态获取失败。
- 新增企业微信推送（可选推送到个人微信）。

## [1.1.0] - 2026-07
### Added
- 右侧磁吸常驻弹窗（按博主合并、全部已读）。
- 声音提示（Offscreen Document + Web Audio）。

## [1.0.0] - 2026-07
### Added
- 初始版本：监控雪球特别关注分组，新帖系统通知 + 基础弹窗。

---

<!-- 链接定义（便于跨文件跳转，无实际跳转需求可忽略） -->
[1.4.3]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.4.3
[1.4.2]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.4.2
[1.4.1]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.4.1
[1.4.0]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.4.0
[1.3.3]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.3.3
[1.3.2]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.3.2
[1.3.1]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.3.1
[1.3.0]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.3.0
[1.2.2]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.2.2
[1.2.0]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.2.0
[1.1.0]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.1.0
[1.0.0]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.0.0

---

## 附录：常见错误与调试记录（Troubleshooting）

> 本附录汇总开发中**反复踩过的坑**与**高频用户侧问题**，排错先看这里。

### A. 弹窗宽度/布局类

| 现象 | 根因 | 结论 |
|------|------|------|
| 头部按钮（已读全部/关闭/明亮\|黑暗）被截断，只显示「明」 | 窗口外部宽不够：Chrome `width` 含 OS 边框，内部实际比设置值小 ~8-10px | 最终外部宽设 **440px**；`alert.html` body **不设固定 width**，自适应 |
| 页面内容文字溢出、卡片右侧被切 | `alert.html` body 写死 `width:380px`，但窗口内部只有 ~370px | 页面 CSS 永远**不要**用等于窗口外部宽的 px；让 body 流式填充 |
| 弹窗出现竖直滚动条 | `overflow-y: auto` 在内容略多时出现 | 改为 `hidden`，高度由 `resizeToContent()` 动态测量设置 |
| 弹窗内圆角看起来怪 | Chrome 弹窗窗口自带边框，内部再 `border-radius` 视觉冗余 | `alert.html` 的 `html,body` **去掉 border 和 radius**（卡片圆角保留） |
| 弹窗一直是旧样式（无按钮/文字溢出） | 旧版 popup 窗口创建后未关闭，Chrome 不会随扩展代码更新重渲染 | **手动关掉旧弹窗**，新触发的才会用最新代码 |

### B. 多显示器 / 定位类

| 现象 | 根因 | 结论 |
|------|------|------|
| `ERROR 弹窗创建失败：Invalid value for bounds. Bounds must be at least 50% within visible screen space.` | `background.js` 按浏览器窗口位置算 `left`，浏览器在副屏时 `left` 超出主屏可见范围 | **不要**在 `chrome.windows.create` 传 left/top；交给 `alert.js` 定位 |
| `snapToRight` 把弹窗推到错误屏幕 | 用 `window.screen.width`（本地宽）+ `window.screenX`（全局虚拟坐标）混合，副屏 gap 算负 | 改用 `chrome.system.display.getInfo()` 取真实显示器 workArea 右沿 |

### C. 扩展机制类（历史遗留高频）

| 现象 | 根因 | 结论 |
|------|------|------|
| 弹窗变成空白 `chrome://newtab` | MV3 Service Worker 空闲被杀 → 内存变量归零 → 扩展更新后弹窗 URL 回退到 newtab | `alertWinIds` 持久化 storage；扫描时也认 newtab 孤儿窗口 |
| 屏幕堆出几十个孤儿弹窗 | `maybeRepopAlert` 每轮轮询都创建 | 加防抖；创建前先清理孤儿 |
| 改了代码刷新后没变化 | DevTools 审查视图打开的页面，关 DevTools 页面也跟着关；地址栏直接输 `chrome-extension://.../alert.html` 被 `ERR_BLOCKED_BY_CLIENT` | 用「预览页 `card-preview.html`」验证样式；验证通过就只差关旧弹窗重触发 |

### D. 快速验证清单

1. 样式对不对 → 先开 `card-preview.html` 看（它和弹窗同一套 CSS，除窗口边框外）
2. 弹窗不刷新 → 关掉所有旧弹窗 → `chrome://extensions` 点刷新 → 重新触发
3. 多屏创建失败 → 看日志有无 `Bounds must be at least 50%` → 确认 `background.js` 没传 left/top
4. 头部截断 → 确认 `background.js` 窗口宽 ≥ 440，且 `alert.html` body 无 `width` 定值
