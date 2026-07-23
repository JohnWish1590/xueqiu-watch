# Release Notes 规范与模板

本文件是雪哨（xueqiu-watch）**每次发版的 Release Notes 模板与发布规范**，非版本变更史（版本史见 `CHANGELOG.md`）。

---

## 1. 定义

- **GitHub Release** = 一次对外发布事件；每个 Release **关联 `CHANGELOG.md` 中一个版本段落**（一一对应）。
- **Release 标题**：`v<version>`（如 `v1.3.0`）。
- **Release 描述**：复制对应 CHANGELOG 段落 + 补充「如何安装 / 升级」指引 + 资产说明。
- **资产（Assets）**：上传本次打包的 `xueqiu-watch-v<version>.zip`（用户包，按排除清单生成）。

---

## 2. 发布流程（本地无 git remote，走 API）

> ⚠️ 本地 git 仓库**没有配置 remote**，一律用 **GitHub Contents / Releases API** 推送与建 Release，**禁止 `git push`**。

1. 确认 `manifest.json` 的 `version` 与 `CHANGELOG.md` 版本段落一致。
2. 打包 zip：基名 `xueqiu-watch-v<version>.zip`，**排除** `.git/`、`test_harness.js`、`scale_icon.py`、所有 `*.md`、`docs/`、`.gitignore`、临时文件；保留 `manifest.json` + 所有 `*.js` / `*.html` + `icon16/48/128.png` + `LICENSE`。
3. 用 Releases API 创建 Release：
   - `POST https://api.github.com/repos/JohnWish1590/xueqiu-watch/releases`
   - body：`tag_name: "v<version>"`、`name: "雪哨 v<version>"`、`body`（见第 3 节模板）、`prerelease: false`。
   - 拿到返回 `upload_url` 后，`POST {upload_url}?name=xueqiu-watch-v<version>.zip`（Content-Type: application/zip）上传资产。
4. 用 Contents API 把改动过的源文件与新增文档同步到 `JohnWish1590/xueqiu-watch`（远程没有的文件不带 `sha` 直接 PUT 创建）。
5. 本地 `git add -A && git commit`（message 用中文，如 `docs: 规范化文档体系 + 升级 1.3.0（雪哨/xueqiu-watch）`）。

> 发布说明与脚本中**禁止硬编码 PAT**；token 一律用环境变量 `GH_TOKEN` 占位，运行时注入。

---

## 3. Release 描述模板

```markdown
# 雪哨（xueqiu-watch）v<version>

> 发布日期：<YYYY-MM-DD>
> 仓库：https://github.com/JohnWish1590/xueqiu-watch

## 本次更新
（粘贴 CHANGELOG.md 中对应 [<version>] 段落）

## 如何获取
- 方式 A（开发者模式）：下载下方 Assets 中的 `xueqiu-watch-v<version>.zip`，解压后在
  chrome://extensions 开启「开发者模式」→「加载已解压的扩展程序」选择解压目录。
- 方式 B（商店，若已上架）：Chrome 网上应用店搜索「雪哨」一键安装。
- 升级：覆盖原目录后回到 chrome://extensions 点「刷新」。

## 运行前置条件
- 任意 Chromium 内核浏览器（Chrome / Edge / Brave 等）。
- 已登录 xueqiu.com 的标签页保持打开。
- ⚠️ 运行不需要 WorkBuddy，也不需要任何本地开发环境。

## 验证安装
安装后在扩展设置页点「📢 发送测试提醒」，应看到系统通知 + 磁吸小窗。

## 完整变更与历史
见 CHANGELOG.md。

## 资产
- xueqiu-watch-v<version>.zip（用户包，不含开发期文件）
```

> 品牌更名版本（如 v1.3.0）在「本次更新」开头加一句：「⚠️ 本次为品牌更名版本，运行时无破坏性变更，已装用户可直接覆盖升级，无需重新配置。」

---

## 4. 首个 Release 草稿（v1.3.0）

> 标题：`雪哨 v1.3.0` ｜ tag：`v1.3.0` ｜ prerelease：`false`
> 描述见下方，复制自 `CHANGELOG.md` 的 `[1.3.0]` 段落 + 安装/升级指引 + 资产说明。

```markdown
# 雪哨（xueqiu-watch）v1.3.0

> 发布日期：2026-07-23
> 仓库：https://github.com/JohnWish1590/xueqiu-watch

## 本次更新

> ⚠️ 本次为品牌更名版本，运行时无破坏性变更，已装用户可直接覆盖升级，无需重新配置。

### Added
- 产品正式定名「雪哨（xueqiu-watch）」，GitHub 仓库迁移至 JohnWish1590/xueqiu-watch（旧仓库已重定向）。
- 新增文档体系：README / CHANGELOG / RELEASE / QUICKSTART / ARCHITECTURE。
- 新增发布流程：GitHub Releases + 打包 xueqiu-watch-v1.3.0.zip。

### Changed
- manifest name 由「雪球特别关注 新帖提醒」改为「雪哨」。
- 所有文档与界面中的仓库链接统一指向新仓库地址。

## 如何获取
- 方式 A（开发者模式，本期唯一分发方式）：下载下方 Assets 中的 `xueqiu-watch-v1.3.0.zip`，
  解压后在 chrome://extensions 开启「开发者模式」→「加载已解压的扩展程序」选择解压目录。
- 方式 B（商店）：本期暂未上架 Chrome Web Store，仅开发者模式分发；上架见 STORE_GUIDE.md。
- 升级：覆盖原目录后回到 chrome://extensions 点「刷新」。

## 运行前置条件
- 任意 Chromium 内核浏览器（Chrome / Edge / Brave 等）。
- 已登录 xueqiu.com 的标签页保持打开。
- ⚠️ 运行不需要 WorkBuddy，也不需要 Node / Python 等任何开发环境，不需要本地编译。

## 验证安装
安装后在扩展设置页点「📢 发送测试提醒」，应看到系统通知 + 磁吸小窗。

## 完整变更与历史
见 CHANGELOG.md。

## 资产
- xueqiu-watch-v1.3.0.zip（用户包，不含开发期文件）
```
