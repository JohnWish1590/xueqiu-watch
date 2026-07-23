# 更新日志（Changelog）

本文件记录雪哨（xueqiu-watch）的所有重要变更，遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 规范。

> 版本号单一来源为 `manifest.json` 的 `version` 字段；本文件与之手动同步。
> 日期格式 `YYYY-MM-DD`；历史版本日期不可考时仅写 `YYYY-MM`（月精度，不编造具体日）。

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
[1.3.0]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.3.0
[1.2.2]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.2.2
[1.2.0]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.2.0
[1.1.0]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.1.0
[1.0.0]: https://github.com/JohnWish1590/xueqiu-watch/releases/tag/v1.0.0
