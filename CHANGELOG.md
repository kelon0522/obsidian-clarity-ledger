# 更新日志

本文件记录用户能感知到的变化。只记用户看得见的东西 ——
内部重构、测试补充这类不写（git log 里有）。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [未发布]

还没有提交到社区目录的第一个版本。

## [0.1.0] - 2026-10-10

首个版本。

### 新增

- 每日规划视图：月历 + 待办、计划完成、实际完成三栏
- 三栏联动：待办拖到计划轨自动占时段、后续排期顺延；拖下沿改时长；
  计划轨点对勾挪到实际轨同一时间段；双击改名三处同步
- 数据以 Markdown 存在 vault（默认 `清晰力/`），可全文搜索、可 git
- 支持改存储目录与文件名模板，改完自动迁移已有文件（冲突一律跳过不覆盖）
- 尊重用户在 Obsidian 里的手改：写回前比对 mtime，改过就以用户的为准

[未发布]: https://github.com/kelon/obsidian-clarity-ledger/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/kelon/obsidian-clarity-ledger/releases/tag/0.1.0