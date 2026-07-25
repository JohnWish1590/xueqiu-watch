# 更新日志（Changelog）

本文件记录雪哨（xueqiu-watch）的所有重要变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范。

> 版本号单一来源为 `manifest.json` 的 `version` 字段；本文件与之手动同步。
> 日期格式 `YYYY-MM-DD`；历史版本日期不可考时仅写 `YYYY-MM`（月精度，不编造具体日）。

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
[1.3.2]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.3.2
[1.3.1]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.3.1
[1.3.0]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.3.0
[1.2.2]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.2.2
[1.2.0]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.2.0
[1.1.0]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.1.0
[1.0.0]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.0.0
