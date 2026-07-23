# 交接文档：雪哨（xueqiu-watch）（Chrome 扩展 / Manifest V3）

> **用途**：本文档供**接手本项目的下一位 AI / 开发者**阅读，目标是「无需追问即可继续开发、测试、发布」。
> **整理时间**：2026-07-23 ｜ **整理人**：WorkBuddy（嘎嘎姑）｜ **当前版本**：1.3.0
> ⚠️ **本期（v1.3.0）暂不上架 Chrome Web Store**，仅以开发者模式分发；上架准备见 `STORE_GUIDE.md`。
> **配套文档**：`README.md`（给用户看的使用说明）、`STORE_GUIDE.md`（上架清单）、`PRIVACY.md`（隐私政策）、`LICENSE`（版权）。本文档是「工程交接视角」，与前几份互补。

---

## 0. 速览（30 秒）

- **它是什么**：一个 Chrome 扩展，监控你在雪球（xueqiu.com）「特别关注」分组里的博主，他们一发新帖，就**在本机弹系统通知 + 右侧磁吸常驻小窗 + 可选提示音**，并可选地**推送到你的个人微信**（企业微信自建应用）。
- **当前版本**：`1.3.0`（Manifest V3）。
- **GitHub 仓库（public）**：`https://github.com/JohnWish1590/xueqiu-watch`
- **本地路径**：`C:\Users\user\WorkBuddy\2026-07-20-13-33-18\xueqiu-chrome-extension\`
- **完成度**：功能完整、关键 bug 已修、可打包上架。上架还差两件事：① 把 `PRIVACY.md` 托管成可访问的 URL（Gist/Pages）填进商店后台；② 用户付 $5 开发者注册费。
- **⚠️ 关键事实**：本地 git 仓库**没有配置 remote**（历史上是用 GitHub Contents API 推送的，不是 `git push`）。直接 `git push` 会失败，必须用 API 方式同步（见第 11 节）。

---

## 1. 项目是做什么的（产品定义）

利用**用户已登录 Chrome 的免费雪球登录态**，免 Cookie 提取、免常驻服务，定时监测「特别关注」分组博主的新帖，并以最醒目的方式提醒用户：

- **在电脑前**：屏幕右侧滑入的常驻小窗（按博主合并、已读消隐、全部一键已读）+ 系统通知（高优先级、不自动消失）+ 可选提示音。
- **离开电脑**：通过企业微信自建应用把新帖推到用户的**个人微信**（桌面微信跳出 / 手机微信收到），只过滤特别关注、不淹没。

**为什么不做独立 App / 微信小程序**（已论证过）：手机沙盒读不了别的 App 数据；小程序无后台定时能力、无系统通知；独立 App iOS 保活是硬坑且需开发者账号。当前桌面弹窗 + 企微推微信的双端方案是最优解。

---

## 2. 功能清单

| # | 功能 | 状态 | 实现位置 |
|---|------|------|----------|
| 1 | 定时轮询特别关注分组博主时间线（默认 2 分钟，1–60 可调） | ✅ | `background.js` `checkOnce` + `alarms` |
| 2 | 系统通知（高优先级、不自动消失、带「打开原帖」按钮） | ✅ | `background.js` `notifyNewPosts` |
| 3 | 右侧磁吸常驻弹窗（按博主合并、数字角标、点击打开原帖并标记已读、「全部已读」按钮、全读完自动关） | ✅ | `alert.html` / `alert.js` |
| 4 | 3 分钟未读完自动重弹（复用不新建） | ✅ | `background.js` `maybeRepopAlert` |
| 5 | 可选提示音（Web Audio 蜂鸣，Chrome 最小化也响；被拦则改系统朗读 TTS） | ✅ | `offscreen.js` + `background.js` `playAlertSound` |
| 6 | 企业微信推送进个人微信（CorpID/Secret/AgentID，token 缓存 2h） | ✅ | `background.js` `pushWecom` / `getWecomToken` |
| 7 | 零配置登录检测（借已登录雪球标签页注入 fetch，无需手动 Cookie） | ✅ | `options.js` `testLogin` + `background.js` `fetchJSON` |
| 8 | 一键诊断（逐环节测登录态获取路径，输出可复制报告） | ✅ | `background.js` `diagnose` + `options.js` `runDiagnose` |
| 9 | 运行日志（INFO/WARN 滚动 300 条，ERROR 永久保留，可刷新/复制/下载/清空） | ✅ | `background.js` 日志模块 + `options.js` `renderLog` |
| 10 | 测试提醒按钮（验证通知+弹窗+声音链路） | ✅ | `background.js` `testNotify` |
| 11 | 弹窗跨 MV3 service worker 重启不堆积（单例复用孤儿窗口） | ✅ 已修复 | `background.js` `findExistingAlertWin` / `closeAllAlertWindows` |
| 12 | 打包上架 Chrome Web Store | ⏳ 待用户操作 | 见第 10 节 |

---

## 3. 架构与数据流

**Manifest V3 组成**：
- `background.js`：service worker（事件驱动、会被系统重启）。负责定时轮询、调雪球 API、比对新帖、发通知/弹窗/声音/企微。
- `content.js`：注入 xueqiu.com 页面，代发同源 fetch（自动带全部 Cookie，含 httpOnly）。
- `offscreen.html` / `offscreen.js`：离屏文档，在后台用 Web Audio 播提示音（MV3 规定音频必须在离屏文档）。
- `popup.html` / `popup.js`：点扩展图标弹出的状态面板（监控人数、上次运行、未读数、最近新帖、立即检查、唤出提醒窗）。
- `alert.html` / `alert.js`：新帖提醒小窗（独立 popup 窗口）。
- `options.html` / `options.js`：设置页（登录检测、勾选博主、轮询间隔、声音、企微配置、诊断、运行日志）。

**一次新帖提醒的数据流**：
```
chrome.alarms('poll') 每 N 分钟触发
   → background.checkOnce()
   → getSpecialFollowUsers()：fetchJSON(friendships/groups.json) 找「特别关注」分组 → members
       （取数路径优先级：① scripting 注入 > ② content script > ③ Cookie 兜底）
   → 对每个博主 getUserTimeline(user_id)：fetchJSON(v4/statuses/user_timeline.json)
   → 用 lastIds[userId] 比对，筛出 id 更大的新帖
   → notifyNewPosts(newPosts)：
       1. chrome.notifications.create（系统通知，带 urlMap 记录 id→原帖URL）
       2. pushWecom(newPosts)（若开启企微）
   → 若开声音 playAlertSound()（ensureOffscreen → 发 beep 消息给 offscreen）
   → openAlertWindow()：真实扫描是否已有 alert 窗，有则聚焦+重渲染，无则新建（贴屏幕右缘）
   → 把新帖写 recent[]（未读） + noteNewPostsArrived()（记录到达时间供3分钟重弹）
```

**点击通知/卡片打开原帖**：`urlMap[id]` → `chrome.tabs.create`，并把该博主未读标记已读（`markRead` / `markAllRead`）。

---

## 4. 文件清单（每个文件职责）

| 文件 | 职责 |
|------|------|
| `manifest.json` | MV3 清单。权限：`alarms, notifications, storage, offscreen, windows, tabs, scripting, system.display`；host：`xueqiu.com`、`qyapi.weixin.qq.com`；service_worker=`background.js`；content_scripts 注入 xueqiu.com；`action`(popup) + `options_page`。 |
| `background.js` | 核心 service worker（~1100 行）。含：运行日志系统、三层取数路径、诊断、特别关注分组/时间线解析、去重比对、通知/弹窗/声音/企微、已读与重弹、全部消息路由（`onMessage`）。**改逻辑主要动这里。** |
| `content.js` | 注入 xueqiu.com，监听 `xqFetch` 消息，在雪球同源上下文 `fetch` 并返回 `{ok,status,text}`。 |
| `offscreen.html` / `offscreen.js` | 离屏文档播提示音。`beep()` 两段式「滴-滴」蜂鸣；失败兜底 `speak()` 系统朗读。 |
| `alert.html` / `alert.js` | 提醒小窗。按博主合并未读卡片、点击打开原帖+标已读、滑出动画、全读完自动关；「关闭」与「全部已读」按钮均调 background 关掉**所有** alert 窗（含跨 SW 孤儿窗）。 |
| `popup.html` / `popup.js` | 图标面板。显示监控人数/上次运行/未读/抓取诊断/最近新帖；「立即检查」「唤出提醒窗」「设置」入口。 |
| `options.html` / `options.js` | 设置页。登录检测、读取特别关注分组并勾选、轮询间隔、声音、企微配置、一键诊断、运行日志面板、关于与版权区块。 |
| `icon16/48/128.png` | 扩展图标（渐变雪球 + 立体白雪晶）。`scale_icon.py` 是生成图标的脚本（非运行所需）。 |
| `test_harness.js` | Node 测试脚手架（vm 沙盒 + chrome API mock），**53 条断言**覆盖主要逻辑与防回归场景。开发后跑它验证。 |
| `README.md` | 给用户看的使用说明（安装、使用、原理、企微配置、故障排查）。 |
| `STORE_GUIDE.md` | 上架 Chrome Web Store 的逐项清单（包、商品信息、隐私披露、权限理由、远程代码声明）。 |
| `PRIVACY.md` | 隐私政策正文（上架需托管成 URL）。 |
| `LICENSE` | 版权声明（署名「下一站澳门」、邮箱、免责）。 |
| `.gitignore` | 排除 `.git` 等。 |

---

## 5. 关键技术实现

### 5.1 登录态获取：三层路径（核心设计）
`background.js` 的 `fetchJSON(url, opts)` 按优先级尝试，最稳优先：
1. **① scripting 注入（主路径）**：`chrome.scripting.executeScript` 在已打开的雪球标签页内临时注入 fetch，随用随注入、无需用户 F5，浏览器自动带全部 Cookie（含 httpOnly `xq_a_token`）。**最稳、零操作。**
2. **② content script（次路径）**：若标签页已注入 `content.js`，直接 `sendMessage` 代发，少一次注入开销。标签页没刷新导致未注入时报 "Receiving end does not exist"，自动回退 ①，无影响。
3. **③ Cookie 兜底**：`chrome.cookies.getAll` 或用户手动粘贴的 `xqCookie`。无雪球标签页时的最后手段。

> 雪球 `user/current.json` 登录校验接口已失效（404），现用 `friendships/groups.json` 作登录探针：未登录返回 `{error_code:400016}`，已登录返回**顶层数组** `[{分组},...]`。

### 5.2 弹窗单例 + 跨 SW 重启复用（关键 bug 修复，v1.2.2）
- **现象**：用户离开半小时，新帖每 3 分钟重弹，堆出几十个 alert 小窗；点「全部已读」只关当前窗口。
- **根因**：原用单一内存变量 `alertWinId` 维护单例；MV3 service worker 被系统重启后变量归零，但上辈子 SW 开出的弹窗仍开着 → 新 SW 误以为没窗口又新建，循环累积。
- **修复**：
  - 改用 `alertWinIds`（Set）+ **真实扫描** `chrome.windows.getAll({windowTypes:['popup']})` 找 url 含 `alert.html` 的窗口来复用；
  - `openAlertWindow()` 先 `findExistingAlertWin()`，有则聚焦 + 发 `alertRefresh` 重渲染，**绝不新建第二个**；
  - 新增 `closeAllAlertWindows()`：集合里的 + 兜底扫到的全部 `remove`（覆盖 SW 重启遗留的孤儿窗）；
  - `onRemoved` 监听清理集合；
  - `alert.js` 的「关闭」与「全部已读」按钮都调 `closeAllAlerts`/`closeAllAlertWindows` 关**所有**窗口。
- **防回归测试**：`test_harness.js` 场景 12（复用不新建、关全部含孤儿、关闭后再建 1 个）。

### 5.3 已读 / 3 分钟重弹
- `recent[]` 每条：`{id, userId, name, text, ts, read}`。`markPostRead` / `markAllRead` 标记已读。
- `noteNewPostsArrived()` 记录新帖到达时间；`maybeRepopAlert()` 在每次轮询时检查：仍有未读 + 无活窗口 + 距到达 ≥3 分钟 → 重新 `openAlertWindow()` 并重设计时起点（再给 3 分钟）。

### 5.4 企业微信推送
- 配置存 `options.wecom`：`{enabled, corpid, corpsecret, agentid, touser}`。**凭证仅存本机 `chrome.storage.local`，不上传任何服务器。**
- `getWecomToken(cfg)`：用 CorpID+Secret 换 `access_token`，缓存 2h、提前 5 分钟视为过期。
- `sendWecomText(cfg, content)`：调 `message/send`（`touser` 留空则 `@all`）。
- `pushWecom(posts)`：在 `notifyNewPosts` 里调用；未开启或配置不全则跳过并记 WARN。
- 配置一次后，新帖同时触发：本机通知 + 声音 + 弹窗 + 微信消息。

### 5.5 运行日志系统
- `logBuf`（INFO/WARN，滚动上限 300 条）+ `errBuf`（ERROR，永久保留、不被冲刷）。
- ERROR 立即落盘；其余防抖 1s 落盘（`chrome.storage.local` 键 `runLog` / `runLogErrors`）。
- SW 冷启动读回内存，跨重启不丢。
- 接口：`getLog` / `clearLog`（全清）/ `clearErrors`（复制后清 ERROR）。`options.js` 提供刷新/复制/下载 .txt/清空。
- `alert.js` 通过 `uiLog` 把关键交互（如「点击卡片打开原帖」）记回后台。

### 5.6 声音（Offscreen Document）
- MV3 规定音频必须在离屏文档。`ensureOffscreen()` 创建 `offscreen.html`（reason `AUDIO_PLAYBACK`）；`playAlertSound()` 发 `beep` 消息；被自动播放策略拦则 `offscreen.js` 自动改 `speak()` 系统朗读。

### 5.7 通知点击 / 打开原帖
- `chrome.notifications.onClicked` / `onButtonClicked` → `openPost(nid)`：从 `urlMap[nid]` 取原帖 URL → `chrome.tabs.create` + 清通知。
- 弹窗卡片点击：`alert.js` `onCardClick` → `chrome.tabs.create` + `windows.update(focused:true)` 把新标签提到前台 + 标记该博主所有未读已读。

---

## 6. chrome.storage.local 存储键一览

| 键 | 内容 |
|----|------|
| `options` | `{intervalMin, soundOn, manualUsers, wecom:{enabled,corpid,corpsecret,agentid,touser}}` |
| `lastIds` | `{userId: 最大已见帖id}` 去重基准 |
| `initialized` | 首跑只记录不推送，置 true 后开始提醒 |
| `recent` | 未读/已读新帖列表（上限 50）`[{id,userId,name,text,ts,read}]` |
| `trackedCount` | 本次监控人数 |
| `perUser` | 每用户抓取诊断 `{userId:{name,ok,parsed/error}}` |
| `lastCheck` / `lastRunAt` | 上次检查/运行时间戳 |
| `lastError` | 上次错误（面板标红） |
| `urlMap` | `{通知id: 原帖URL}` 点击通知打开用 |
| `selectedUsers` / `recentGroupUsers` | 设置页勾选的博主 / 缓存的分组成员 |
| `xqCookie` | 用户手动粘贴的兜底 Cookie |
| `wecomToken` | 企微 access_token 缓存 `{token, expireAt}` |
| `lastNewPostAt` | 最近一次新帖到达时间（3 分钟重弹用） |
| `runLog` / `runLogErrors` | 运行日志滚动缓冲 / 错误永久缓冲 |

---

## 7. 消息协议（background ↔ 各页面）

`background.js` 的 `onMessage` 路由支持以下 `type`：

| type | 发起方 | 作用 |
|------|--------|------|
| `getLog` / `clearLog` / `clearErrors` | options | 运行日志读取/清空 |
| `checkNow` | popup | 立即跑一次检查 |
| `getStatus` | popup | 返回监控人数/最近/未读/错误等 |
| `testWecom` | options | 用表单配置发一条企微测试消息 |
| `saveOptions` | options | 保存设置并重排 alarm |
| `apiGet` | options | 代理请求（走 fetchJSON 自动选路径），用于登录检测 |
| `testNotify` | options | 触发测试提醒（通知+弹窗+声音） |
| `markRead` / `markAllRead` | alert | 标记单条/全部已读 |
| `closeAllAlerts` | alert | 全部已读 + 关所有 alert 窗 |
| `closeAllAlertWindows` | alert | 仅关所有 alert 窗（不标记已读） |
| `uiLog` | alert | 弹窗交互日志回传后台 |
| `openAlert` | popup | 唤出提醒窗 |
| `getUnread` | （通用） | 未读数 |
| `getSpecialFollow` | options | 取特别关注分组成员 |
| `diagnose` | options | 跑登录态诊断 |
| `setSound` | options | 勾选声音=解锁音频（确保 offscreen） |

---

## 8. 测试（test_harness.js）

- Node 脚本：用 `vm` 沙盒加载 `background.js`，mock 一套内存版 `chrome` API（storage/alarms/notifications/windows/tabs/scripting/offscreen/system.display/cookies）+ `fetch` mock（按真实雪球返回**顶层数组**分组、v4 时间线）。
- **53 条断言**，分 12 个场景：正常取分组、手动名单兜底、纯函数、声音+弹窗、登录检测（顶层数组/400016）、三层路径回退、全不可用报错、诊断、测试提醒、错误日志永久保留+复制清空、企微推送（开/关/缺配置/testWecom）、**弹窗不重复创建+全部关闭（防回归 bug）**。
- **运行**：在扩展目录下 `node test_harness.js`。建议每次改 `background.js` 后跑一遍。
- 注意：沙盒里 `windowsState` 可变，用于模拟「SW 重启遗留孤儿窗」等场景；`scriptingEnabled`/`contentScriptEnabled` 开关模拟路径可用性。

---

## 9. 配置与权限（manifest.json）

- `manifest_version: 3`，`version: 1.3.0`。
- `permissions`: `alarms, notifications, storage, offscreen, windows, tabs, scripting, system.display`。
- `host_permissions`: `https://xueqiu.com/*`、`https://*.xueqiu.com/*`、`https://qyapi.weixin.qq.com/*`。
- `author`: `{ email: "cheung.cn@gmail.com", url: "https://github.com/JohnWish1590/xueqiu-watch" }`。
- 上架权限理由对照见 `STORE_GUIDE.md` 第五节。

---

## 10. 上架准备清单（Chrome Web Store）

完整清单在 `STORE_GUIDE.md`。要点：
1. 打包 `.zip`：**排除** `.git/`、`test_harness.js`、各 `.md`、`scale_icon.py`、`node_modules`。保留运行必需文件（manifest/background/content/popup*/alert*/options*/icon*）。
2. 商店后台填：名称、简述、详细描述、类别（生产力/通知）、语言（简体中文）、图标 128、截图（≥1 张）、宣传图（可选）。
3. **隐私政策 URL**：把 `PRIVACY.md` 托管到可公开访问地址（GitHub Gist 或 Pages），链接填后台「隐私政策」字段。**当前尚未托管 → 这是上架前唯一阻塞项（代码层面）。**
4. **权限理由**：每项权限填用途（见 STORE_GUIDE 第五节）。
5. **远程代码声明**：选「否」（无远程 JS）。
6. 付 $5 开发者注册费 → 提交审核（1–2 工作日）。

---

## 11. ⚠️ GitHub 同步方式（必读，否则会卡住）

**本仓库的本地 git 没有配置 remote**（历史上是用 GitHub Contents API 推送的，不是 `git push`）。所以：
- ❌ `git push` 会失败（No configured push destination）。
- ✅ 同步用 **GitHub Contents API**（`PUT /repos/{owner}/{repo}/contents/{path}`）。

**推送机制（给下一位 AI）**：
- 仓库：`JohnWish1590/xueqiu-watch`（owner 即用户 GitHub 用户名）。
- 认证：需要用户的 **Personal Access Token（PAT）**，scope 需 `repo` + `workflow`。**请勿把 token 明文提交进本仓库任何文件**（仓库是 public，会泄露）。脚本里用环境变量 `GH_TOKEN` 占位，运行时由用户提供或在本地安全环境注入。
- 流程：对每个要更新的文件，`GET /contents/{path}` 取当前 `sha`（404 表示新建），再 `PUT /contents/{path}`（更新带 `sha`，新建不带）传 `content`（文件 Base64）+ `message`。
- 示例（Python，token 从环境变量读）：
  ```python
  import base64, json, os, urllib.request
  TOKEN = os.environ["GH_TOKEN"]          # 用户提供的 PAT，勿硬编码
  REPO  = "JohnWish1590/xueqiu-watch"
  def sync(local_path, repo_path):
      with open(local_path, "rb") as f:
          content = base64.b64encode(f.read()).decode()
      url = f"https://api.github.com/repos/{REPO}/contents/{repo_path}"
      req = urllib.request.Request(url, headers={"Authorization": f"token {TOKEN}", "Accept": "application/vnd.github+json"})
      try:
          sha = json.load(urllib.request.urlopen(req))["sha"]
      except Exception:
          sha = None
      body = {"message": f"update {repo_path}", "content": content}
      if sha: body["sha"] = sha
      req2 = urllib.request.Request(url, data=json.dumps(body).encode(),
              headers={"Authorization": f"token {TOKEN}", "Content-Type": "application/json", "Accept": "application/vnd.github+json"}, method="PUT")
      print(repo_path, urllib.request.urlopen(req2).status)
  # sync("HANDOFF.md", "HANDOFF.md")  etc.
  ```
- 二进制（icon*.png）同样 Base64 上传即可。
- 用户已知该 PAT 且授权用于此仓库；如需重新生成，在 GitHub → Settings → Developer settings → Personal access tokens。

---

## 12. 署名 / 版权 / 联系（现状，已全部填好，无占位符）

- **作者署名**：下一站澳门（关于区块显示「微博@下一站澳门」，带超链接跳 `https://weibo.com/u/7708742647`）。
- **联系 / 源码**：GitHub `https://github.com/JohnWish1590/xueqiu-watch`（设置页「源码：」一行 + `manifest.author.url`）。
- **邮箱**：`cheung.cn@gmail.com`（`manifest.author.email`、`LICENSE`、`PRIVACY.md` 联系处）。
- **微博**：`@下一站澳门`（`https://weibo.com/u/7708742647`），写在 `PRIVACY.md` 联系处与设置页作者超链。
- **版权**：`© 2026 下一站澳门. 保留所有权利。`（设置页关于区块）；`LICENSE` 含完整免责（与雪球官方无隶属关系）。

> 注：`STORE_GUIDE.md` 第九节原文写「占位符仍需替换」，实际署名/邮箱/URL **已全部回填真实值**，无残留占位符——该节描述已过时，特此更正。

---

## 13. 给新 AI 的接手步骤

1. **读文档**：先读本 `HANDOFF.md` → `README.md` → `STORE_GUIDE.md` → `PRIVACY.md`。
2. **本地加载试跑**：Chrome → `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选本目录。打开 xueqiu.com 并登录 → 扩展设置页点「自动检测登录」→ 读特别关注分组 → 勾选博主 → 保存。等几分钟看是否弹通知。
3. **改代码**：逻辑在 `background.js`；UI 在 `alert.*` / `popup.*` / `options.*`；图标在 `icon*.png`。改完回 `chrome://extensions` 点该扩展「刷新」。
4. **跑测试**：`node test_harness.js`，确认 53 条断言全 PASS。
5. **同步到 GitHub**：用第 11 节的 Contents API 方式（别用 `git push`）。
6. **上架**：按第 10 节把 `PRIVACY.md` 托管成 URL 并填后台，打包 zip 提交。

---

## 14. 已知限制 / 坑

- **依赖 Chrome 常开 + 雪球已登录**：MV3 service worker 无法在 Chrome 完全关闭后运行；雪球标签页至少开一个。否则收不到提醒。（想要"Chrome 关了也推"需另加 GitHub Actions 定时 workflow 调企微，当前版本不含。）
- **雪球接口为半公开**：未来雪球调整接口或加强风控（如 `acw_sc__v2` 加密）可能影响运行，这是所有非官方客户端共有风险；遇到时手动开一下雪球网页刷新 Cookie 多可恢复。
- **弹窗定位依赖显示器信息**：用 `chrome.system.display` 算贴边坐标，`BROWSER_CHROME_HEIGHT=150` 是估算（标签栏+地址栏+书签栏）；多显示器/特殊 DPI 可能略有偏差，属已知小瑕疵。
- **本地 git 无 remote**：见第 11 节，推代码必须用 API。
- **隐私政策 URL 未托管**：上架前需补（见第 10 节）。

---

## 15. 相关外部资源

- 用户旧版 JS 实现（接口参考来源）：`https://github.com/JohnWish1590/xueqiu`（已对照核实 `friendships/groups.json`、`v4/statuses/user_timeline.json` 等接口可用）。
- 企业微信管理后台：`https://work.weixin.qq.com`（个人微信扫码即可建企业+应用，无需公司资质）。
- Chrome Web Store 开发者控制台：`https://chrome.google.com/webstore/devconsole`

---

*整理完毕。本仓库代码与文档均已就绪，下一开发者按第 13 节即可无缝接手。*
