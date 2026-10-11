# 更新日志

本文件记录用户能感知到的变化。只记用户看得见的东西 ——
内部重构、测试补充这类不写（git log 里有）。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

### 修复

- **install.bat 完全跑不起来**：行尾是 LF，cmd.exe 按 CRLF 切分命令，
  相邻行被错位拼接，于是刷出几十条「'larity' 不是内部或外部命令」这类无意义报错。
  这个 bug 本机复现不了（`core.autocrlf=true` 会自动转 CRLF），只有 clone 下来的人会炸。
- **install.bat 里混入非 ASCII 字符**：`.bat` 按系统 ANSI 代码页读，
  UTF-8 的中文在中文机器上是乱码。文件头原本就写了「刻意全 ASCII」的约定，
  上一版加了一行中文引用把它破坏了。
- **样式污染用户 vault**：`styles.css` 是整个 vault 全局加载的，
  而 `prefers-reduced-motion` 写的是裸 `*`、`:focus-visible` 也是裸的 ——
  用户给 Obsidian 设了「减少动效」之后，装了本插件，**所有界面**（含其他插件）
  的动效都会被压掉；键盘 Tab 也会给所有可聚焦元素套上玫红描边。
  两条都已限定到 `.cl-root`，并且移出 `@layer`（layer 内 Tailwind 会剥掉前缀）。
- **关闭 Obsidian 可能丢最后一次编辑**：写入是 250ms 防抖，
  窗口内直接关掉进程，那次修改就没了。现在在失焦/隐藏时立刻落盘。
- 「打开今天的规划」命令：修掉一处死代码和一处竞态
  （视图未就绪时切日期会被覆盖，表现为「命令点了但停在昨天」）。

### 其他

- 插件描述（manifest `description`）改为英文：社区目录以国际用户为主，
  中文描述会让英文用户在列表里看不懂这个插件做什么。
- README 改为英文并新增语言切换行（`English | 中文`），中文内容移到
  `README.zh-cn.md`。**Obsidian 详情页只读 `README.md`**，所以主文件必须是英文；
  那一行切换靠的是 Obsidian 会把 README 里的相对链接重写成 GitHub 地址，
  点「中文」跳到 GitHub 的中文版文件。做法参照 Remotely Save。
- 新增 `.gitattributes`：`*.bat` 强制 CRLF、`*.sh` 强制 LF，
  从根上锁住行尾（而不是靠每个人本机的 git 配置）。
- 新增 `npm run check:bat`：检查 install.bat 的行尾、编码、BOM 等五条，
  并入 `npm run build`。
- `npm test` / `npm run mutation` 改为node 驱动，不再依赖 bash。
- Release 流程：测试移到发版之前；Release 不再是 draft。
- 提交 `package-lock.json`，CI 与发版都用 `npm ci`。
- 新增 CI：PR 与 push 自动跑测试、构建、产物自检、上架资源检查。

## [0.1.0] - 2026-10-10

首个版本。

### 新增

- 每日规划视图：月历 + 待办、计划完成、实际完成三栏
- 三栏联动：待办拖到计划轨自动占时段、后续排期顺延；拖下沿改时长；
  计划轨点对勾挪到实际轨同一时间段；双击改名三处同步
- 数据以 Markdown 存在 vault（默认 `清晰力/`），可全文搜索、可 git
- 支持改存储目录与文件名模板，改完自动迁移已有文件（冲突一律跳过不覆盖）
- 尊重用户在 Obsidian 里的手改：写回前比对 mtime，改过就以用户的为准

[未发布]: https://github.com/kelon0522/obsidian-clarity-ledger/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/kelon0522/obsidian-clarity-ledger/releases/tag/0.1.0