# 更新日志（Changelog）

本文件记录雪哨（xueqiu-watch）的所有重要变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范。

> 版本号单一来源为 `manifest.json` 的 `version` 字段；本文件与之手动同步。
> 日期格式 `YYYY-MM-DD`；历史版本日期不可考时仅写 `YYYY-MM`（月精度，不编造具体日）。

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
