# 雪哨（xueqiu-watch）文档体系结构与发布规范

> 文档性质：架构设计稿（非代码），供工程师照章落地。
> 作者角色：架构师 高见远（Gao）
> 适用范围：GitHub 公开仓库 `https://github.com/JohnWish1590/xueqiu-watch` 下的文档规范化与发布流程。
> 当前工程事实：v1.2.2，53 条测试断言，弹窗跨 MV3 SW 重启不堆积 bug 已修复，推送走 GitHub Contents API（非 git push）。

---

## 0. 命名与单一事实来源（前置约定）

落地所有文档前，先锁定三个**全局唯一值**，后续任何文件不得自行编造：

| 常量 | 规范值 | 说明 |
|---|---|---|
| 产品中文名 | `雪哨` | 品牌名，用于 manifest name、商店名、文档标题 |
| 仓库/上架标识 | `xueqiu-watch` | GitHub 仓库名、Chrome 上架名、产物 zip 基名 |
| 仓库 URL | `https://github.com/JohnWish1590/xueqiu-watch` | 取代旧 `xueqiu-special-follow-notifier` / 曾用 `xue-watch`（均已重定向，所有引用改到本地址） |
| 版本号 | 见第 3、7 节 | **唯一来源 = `manifest.json` 的 `version` 字段**，其余文档手动同步 |

> 旧仓库 URL 在以下 4 处存在硬编码，落地时**必须全部替换为新地址**（见第 6 节清单）：
> `manifest.json:8`、`options.html:186`、`STORE_GUIDE.md:82`、`HANDOFF.md:13/209/233/240/244/265`。

---

## 1. 文档体系总览

目标：让「下载者」和「贡献者」各取所需；仓库根目录保持扁平、清晰。

### 1.1 文档清单与职责

| 文档 | 位置 | 职责 | 处置 |
|---|---|---|---|
| `README.md` | 根 | 面向**使用者**：是什么、怎么装、怎么用、怎么配企微、FAQ、隐私、版权 | **重写**（套用新名 + 补部署/前置条件章节，复用旧内容约 70%） |
| `CHANGELOG.md` | 根 | 版本变更史，Keep a Changelog 风格 | **新增** |
| `RELEASE.md` | 根 | Release Notes 模板与发布规范 | **新增**（模板文件，非版本史） |
| `docs/QUICKSTART.md` | docs/ | 部署/快速开始，含「小白」与「开发者」两版 | **新增**（也可并入 README 安装章，见 5.1） |
| `CONTRIBUTING.md` | 根 | 贡献指南（Issue/PR 规范、编码约定） | **新增（可选）**，公开仓库建议有 |
| `PRIVACY.md` | 根 | 隐私政策（商店审核必填 URL 的源文件） | **保留 + 改名**（雪球特别关注→雪哨） |
| `STORE_GUIDE.md` | 根 | 上架 Chrome 商店清单 | **保留 + 改名/改链接**（已是好模板，更新产品名与仓库 URL） |
| `LICENSE` | 根 | 版权声明 | **保留 + 改名**（雪球特别关注→雪哨） |
| `HANDOFF.md` | 根 | 内部交接文档 | **保留**（内部用，更新仓库 URL 引用即可） |
| `docs/ARCHITECTURE.md` | docs/ | 本设计文档 | **新增**（团队内部用，不进用户包） |

### 1.2 仓库根目录（规范化后预期）

```
xueqiu-watch/
├── manifest.json            # name=雪哨, version=1.3.0(?见第3节), author.url=新仓库
├── background.js / content.js / offscreen.* / alert.* / popup.* / options.*
├── icon16.png / icon48.png / icon128.png
├── README.md                # 使用者入口
├── CHANGELOG.md             # 变更史
├── RELEASE.md               # Release 模板
├── CONTRIBUTING.md          # 贡献指南(可选)
├── PRIVACY.md               # 隐私政策
├── STORE_GUIDE.md           # 上架清单
├── LICENSE                  # 版权
├── HANDOFF.md               # 内部交接
├── docs/
│   ├── QUICKSTART.md        # 部署/快速开始
│   └── ARCHITECTURE.md      # 本设计文档
├── .gitignore
└── (test_harness.js, scale_icon.py 等开发期文件 → 不进用户包，见第7节)
```

> 说明：`README.md` 是 GitHub 仓库自动渲染的首页；`CHANGELOG.md` 是版本史；`RELEASE.md` 是**模板**（每次发版复制填充）；`docs/QUICKSTART.md` 是部署细节。四者职责不重叠。

---

## 2. README.md 规范大纲

面向**使用者**。建议标准章节顺序如下；标注「复用」的段可直接取自现有 README.md（仅替换产品名），标注「新增」的段为本次必须补写。

```markdown
# 雪哨（xueqiu-watch）— 雪球特别关注新帖提醒

[徽章位]  ← 新增：版本 / Chrome MV3 / 许可证 / 最后更新（纯 Markdown 或 shields.io 静态徽章，
           如 https://img.shields.io/badge/version-1.3.0-blue；无 CI 则用静态链接，不引入构建依赖）

## 产品简介
  ← 复用：现有 README 第 1 段（监视雪球「特别关注」分组…本机弹窗+通知+可选企微）。
     仅将「雪球特别关注 新帖提醒」改为「雪哨（xueqiu-watch）」。

## 功能特性
  ← 新增：用列表汇总 ①系统通知 ②声音 ③右侧磁吸常驻弹窗 ④可选企微推微信。
     从现有 README「三层提示」段提炼为要点。

## 截图
  ← 新增（占位）：放 2–3 张图（设置页、磁吸弹窗、系统通知）。
     当前仓库无图，先放 `![截图占位](docs/screenshots/...)` 占位并标注待补。

## 安装 / 快速部署
  ← 新增（最重要）：见第 5 节结构。务必包含「运行不需要 WorkBuddy」一句话与前置条件清单。

## 使用说明
  ← 复用：现有 README「使用」「设置」两段（检测登录、选博主、轮询间隔、兜底名单）。

## 企业微信推送配置
  ← 复用：现有 README「④ 企业微信推送」整段（建应用→填凭证→测试）。

## 常见问题 / 故障排查
  ← 复用：现有 README「已知限制」「故障排查：一键诊断」「有人发帖了但没提醒」三段。

## 隐私说明
  ← 复用+精简：引述 PRIVACY.md 要点，并链接 `PRIVACY.md`。

## License / 版权 / 联系
  ← 复用：LICENSE 要点 + 作者署名「下一站澳门」、邮箱 cheung.cn@gmail.com、
     微博 @下一站澳门、仓库 https://github.com/JohnWish1590/xueqiu-watch。

## 仓库链接
  ← 新增：GitHub 源码、Issue 入口、Release 页。统一用第 0 节仓库 URL。
```

**复用原则**：现有 README.md 内容质量高（使用/企微/排查三段可基本原样保留），只需全局替换产品名与仓库 URL；**真正必须新写的是「安装/快速部署」「功能特性」「截图」「徽章」「仓库链接」五处**，其中部署章节是本次规范化核心（见第 5 节）。

---

## 3. CHANGELOG.md 规范

采用 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 中文版风格。

### 3.1 条目分类（固定 5 类，按出现顺序）

- `Added` 新增功能
- `Changed` 变更的功能
- `Fixed` 修复的 bug
- `Deprecated` 即将弃用
- `Removed` 已移除

> 不强制每版五类都出现；无对应变更则省略该类别。

### 3.2 版本号语义与首个规范版本建议

- **唯一来源**：`manifest.json` 的 `version`；CHANGELOG 与之手动同步（见第 7 节）。
- **SemVer 口径**（面向终端用户，按「运行时契约」判断）：
  - 运行时契约 = 权限集、存储 schema、设置项、对外接口行为。
  - 本次变更（改名 + 文档体系 + 发布流程）**未改动运行时契约** → 属「向后兼容的文档/品牌变更」。

**建议：首个规范版本定为 `1.3.0`，而非 `2.0.0`。**

依据：
1. 扩展的代码行为、权限、存储结构、设置页与 v1.2.2 完全一致，无任何破坏性变更；按 SemVer，`MAJOR` 应保留给真正破坏兼容的改动（如存储 schema 迁移、权限增减、设置项重命名）。
2. 把纯品牌/文档升级标成 `2.0.0`，会让已装用户误以为有大版本跳跃或需重新配置，造成无谓恐慌。
3. `2.0.0` 作为「锚点」保留给未来真正的里程碑（如：新增 MV3 外推送通道、重构存储、接口大改）。

> 此结论需在「待明确事项」与用户/PM 最终确认（见第 8 节）。若用户坚持「换名即新起点」的营销口径，可改 `2.0.0`，但需在 CHANGELOG 注明「品牌更名，运行时无破坏性变更」。

### 3.3 历史版本补录（1.0 → 1.2.2 简史）

因此前无 CHANGELOG，首个文件需补录简史（基于 HANDOFF/README 提炼，**只需到版本级，不必逐 commit**）：

```markdown
## [1.2.2] - 2026-07-xx
### Fixed
- 修复弹窗在 MV3 Service Worker 重启后重复堆积的 bug。

## [1.2.0] - 2026-07-xx
### Added
- 新增「一键诊断」与「运行日志」面板。
- 新增企业微信推送（可选）。

## [1.1.0] - 2026-07-xx
### Added
- 右侧磁吸常驻弹窗（按博主合并、全部已读）。
- 声音提示（Offscreen + Web Audio）。

## [1.0.0] - 2026-07-xx
### Added
- 初始版本：监控雪球特别关注分组，新帖系统通知 + 基础弹窗。
```

> 日期用 `YYYY-MM-DD`；历史日期若不可考，统一写 `2026-07`（月精度即可），不可编造具体日。

### 3.4 首个规范条目模板（供发版时填充）

```markdown
## [1.3.0] - 2026-07-23

### Added
- 产品正式定名「雪哨（xueqiu-watch）」，GitHub 仓库迁移至 JohnWish1590/xueqiu-watch。
- 新增文档体系：README / CHANGELOG / RELEASE / QUICKSTART / CONTRIBUTING。
- 新增 Release Notes 发布流程（GitHub Releases + 打包 zip）。

### Changed
- manifest name 由「雪球特别关注 新帖提醒」改为「雪哨」。
- 所有文档与界面中的仓库链接统一指向新仓库地址。

### Fixed
- （若有随本次一并修的小问题，列于此；纯文档发布可留空该类别）
```

---

## 4. Release Notes 规范 + 模板

### 4.1 定义

- **GitHub Release** = 一次对外发布事件；每个 Release **关联 CHANGELOG 中一个版本段落**（一一对应）。
- Release **标题**：`v<version>`（如 `v1.3.0`）。
- Release **描述**：复制对应 CHANGELOG 段落 + 补充「如何安装/升级」指引 + 资产说明。
- **资产（Assets）**：上传本次打包的 `xueqiu-watch-v1.3.0.zip`（见第 7 节排除清单）。

### 4.2 Release 描述模板

```markdown
# 雪哨（xueqiu-watch）v1.3.0

> 发布日期：2026-07-23
> 仓库：https://github.com/JohnWish1590/xueqiu-watch

## 本次更新
（粘贴 CHANGELOG.md 中 [1.3.0] 段落）

## 如何获取
- 方式 A（开发者模式）：下载下方 Assets 中的 `xueqiu-watch-v1.3.0.zip`，解压后在
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
- xueqiu-watch-v1.3.0.zip（用户包，不含开发期文件）
```

### 4.3 首个 Release 草稿（v1.3.0 / 或 v2.0.0）

沿用 4.2 模板，标题按第 3.2 节最终确认结果取 `v1.3.0` 或 `v2.0.0`；描述中「本次更新」填第 3.4 节对应段落。若为 `2.0.0`，在「本次更新」开头加一句：「⚠️ 本次为品牌更名版本，运行时无破坏性变更，已装用户可直接覆盖升级，无需重新配置。」

---

## 5. 部署 / 快速开始文档结构（docs/QUICKSTART.md）

两种落地方式（二选一，推荐 A 并把要点也并入 README 安装章）：

- **A**：独立 `docs/QUICKSTART.md`（详版，含截图位、排错）。
- **B**：仅 README 的「安装 / 快速部署」章（简版）。

建议 **A+B 并存**：README 安装章放「最短路径」，QUICKSTART 放完整细节。以下为 QUICKSTART 章节结构。

```markdown
# 快速开始（部署指南）

## 0. 一句话结论
运行雪哨**只需要一个 Chromium 浏览器 + 开发者模式加载（或商店安装）+ 已登录雪球**。
**不需要 WorkBuddy，不需要 Node、Python 等任何开发环境，不需要本地编译。**

## 1. 前置条件
- ✅ Chromium 内核浏览器（Chrome / Edge / Brave / Arc 等，版本支持 MV3）。
- ✅ 一个已登录 xueqiu.com 的浏览器标签页（且保持打开）。
- ✅ 你对雪球确有「特别关注」分组（可选企微推送时才需要企业微信账号）。
- ❌ 不需要：WorkBuddy、git、Node.js、Python、任何服务器。

## 2. 方式一：开发者模式加载已解压（推荐普通用户 / 快速体验）
1. 下载仓库 zip 或 Release 中的 `xueqiu-watch-vX.Y.Z.zip`，解压。
2. 浏览器地址栏输入 chrome://extensions（Edge 为 edge://extensions）。
3. 右上角打开「开发者模式（Developer mode）」。
4. 点「加载已解压的扩展程序」，选择解压目录。
5. 图标出现即成功；Chrome 重启自动启用，更新时点「刷新」。

## 3. 方式二：Chrome 网上应用店安装（若已上架）
1. 商店搜索「雪哨」或访问 Release 中提供的商店链接。
2. 点「添加至 Chrome」，按提示授权权限即可。
（注：上架状态见 STORE_GUIDE.md；暂未上架时仅用方式一。）

## 4. 雪球登录态要求
- 必须已登录 xueqiu.com；扩展借用该登录态调 API，不读密码、不存 Cookie。
- 保持至少一个雪球标签页打开，否则收不到提醒（MV3 硬限制）。

## 5. 可选：企业微信推送
（引述 README「企业微信推送配置」或链接过去；此处只给 3 步概览 + 测试按钮说明。）

## 6. 验证安装是否成功
- 打开扩展设置页 → 点「📢 发送测试提醒」。
- 预期：右下角系统通知 + 右侧磁吸小窗同时出现（声音需在设置开启）。
- 失败则回看 README「故障排查」或 docs/QUICKSTART 排错小节。

## 附：小白用户最短路径（30 秒）
下载 zip → 解压 → chrome://extensions → 开开发者模式 → 加载已解压 → 打开 xueqiu.com 登录 → 点测试提醒。

## 附：开发者指引（仓库协作 / 改代码）
- 源码即仓库根目录；改完回到 chrome://extensions 点「刷新」即可热更。
- 测试：用 test_harness.js（53 条断言）本地校验逻辑。
- 发布：按 RELEASE.md 流程打包 zip + 用 GitHub Contents API 建 Release（非 git push）。
- 详情见 HANDOFF.md、STORE_GUIDE.md。
```

---

## 6. 文件改动与发布任务列表（有序，含依赖）

> 依赖用「→」表示；必须串行处注明。执行人：工程师。

1. **确认版本号**（依赖：用户/PM 拍板第 3.2 节 1.3.0 vs 2.0.0）→ 决定后续所有 `version` 填写值。
2. **改 `manifest.json`**（依赖 1）：
   - `name` → `雪哨`
   - `version` → 选定值（如 `1.3.0`）
   - `description` 可补「雪哨：…」（可选）
   - `author.url` → `https://github.com/JohnWish1590/xueqiu-watch`
3. **改 `options.html` 关于区块仓库链接**（依赖 1/2）：第 186 行旧 URL → 新 URL。
4. **重写 `README.md`**（依赖 2/3，使文档与新名/新链接一致）：套用第 2 节大纲，替换产品名与仓库 URL，新增安装/部署/徽章/仓库链接章。
5. **新增 `CHANGELOG.md`**（依赖 2：版本号确定）：按第 3 节补录历史 + 写首个规范条目。
6. **新增 `RELEASE.md`**（无前置强依赖，可并行于 5）：放入第 4 节模板。
7. **新增 `docs/QUICKSTART.md`**（依赖 4 的措辞对齐）：按第 5 节结构。
8. **新增 `CONTRIBUTING.md`（可选）**（无强依赖）：Issue/PR 规范、命名约定。
9. **更新 `PRIVACY.md` / `LICENSE` / `STORE_GUIDE.md` 产品名与仓库 URL**（依赖 1）：
   - `PRIVACY.md` 标题与「本扩展」指代 → 雪哨；联系处仓库链接更新。
   - `LICENSE` 第一行产品名 → 雪哨。
   - `STORE_GUIDE.md` 标题、字段建议名、第九节仓库 URL（第 82 行）→ 新地址。
10. **更新 `HANDOFF.md` 仓库引用**（依赖 1）：第 13/209/233/240/244/265 行旧 URL → 新地址（内部文档，随版同步即可，不阻塞发版）。
11. **打包 zip**（依赖 2–10 文件就位）：基名 `xueqiu-watch-v<version>.zip`，按第 7 节排除清单。
12. **用 GitHub Contents API 创建 Release + 上传 zip**（依赖 11）：标题 `v<version>`，描述用第 4.2 模板；**注意本地无 remote，走 API 而非 git push**（沿用 HANDOFF 第 12 节脚本，仅 `REPO` 常量改新名）。
13. **同步所有文件到仓库**（依赖 12 或并行）：把第 1–10 步改过的源文件 + 新增 md 通过 Contents API 推送至 `JohnWish1590/xueqiu-watch`（旧仓库已重定向，写新仓库）。
14. **回归验证**：本地解压 zip → 开发者模式加载 → 点测试提醒，确认通知/弹窗正常、设置页仓库链接指向新地址。

> 关键依赖链：`1 → 2 → 3 → 4 → 5/6/7 → 11 → 12 → 13 → 14`。步骤 6、8、10 可并行。

---

## 7. 共享约定

1. **版本号单一来源**：`manifest.json` 的 `version` 为唯一真相。README/CHANGELOG/Release/zip 基名均**手动同步**；发版前由工程师比对四处一致（可加一行清单核验：manifest == CHANGELOG 标题 == Release 标题 == zip 名）。
2. **仓库链接单一常量**：全仓库只认第 0 节那个 URL。静态文件（manifest/options.html/md）无法用真正「常量」，故约定：**改链接时全局搜索 `xueqiu-watch` 并全部替换**；HANDOFF 的发布脚本中 `REPO = "JohnWish1590/xueqiu-watch"` 为脚本内唯一常量。
3. **打包 zip 排除清单**（用户包不含以下内容）：
   - `.git/`
   - `test_harness.js`（测试脚手架，非运行所需）
   - `scale_icon.py`（图标生成脚本，开发期）
   - 所有 `*.md`（`README/CHANGELOG/RELEASE/PRIVACY/STORE_GUIDE/LICENSE/HANDOFF/docs/*`）——用户包只需运行文件；文档由 GitHub 仓库本身提供
   - `.gitignore`、临时文件（`*.log`、`.DS_Store`）、`create_repo.json`
   - 用户包仅保留：`manifest.json` + 各 `.js/.html` + `icon*.png`
4. **发布通道约定**：本地无 git remote，**一律用 GitHub Contents API 推送与建 Release**（见 HANDOFF 第 12 节），禁止 `git push`。
5. **命名约定**：zip 基名 `xueqiu-watch-v<version>.zip`；Release 标题 `v<version>`；分支默认 `main`。
6. **隐私政策托管**：`PRIVACY.md` 通过 GitHub Pages 或 Gist 托管为公开 URL，填入商店后台（见 STORE_GUIDE 第四节）——URL 同样遵循第 2 条单一常量。

---

## 8. 待明确事项（需用户 / 产品经理确认）

1. **首个规范版本号**：定为 `1.3.0`（架构师推荐，依 SemVer 无破坏性变更）还是 `2.0.0`（若按「换名即新起点」营销口径）？→ 影响步骤 1 及所有后续 `version` 填写。
2. **是否真上架 Web Store**：本期仅做「开发者模式 + GitHub 发布」，还是同步推进商店上架（需 $5 开发者费、截图素材、隐私政策托管 URL）？决定 QUICKSTART「方式二」与 STORE_GUIDE 的优先级。
3. **截图素材**：README/QUICKSTART/商店均需截图（设置页、磁吸弹窗、系统通知）。当前仓库无图，是否由产品/用户补充？影响第 2 节「截图」占位落实。
4. **CONTRIBUTING.md 是否要**：公开仓库建议有，但属可选；是否本期一并产出？
5. **徽章方案**：README 徽章用静态 shields.io 链接（无需 CI）即可，还是计划接入 CI 自动生成？建议先用静态，避免引入构建依赖。
6. **旧仓库流量**：旧仓库 `xueqiu-special-follow-notifier` 及曾用 `xue-watch` 均已重定向到 `xueqiu-watch`。确认新仓库名 `xueqiu-watch` 永久不变，避免再次迁移。

---

> 交付说明：本文件为架构设计稿，供工程师直接照第 6 节顺序落地；第 8 节确认项回收后，可立即执行发布。
</content>
</invoke>
