# Clarity Ledger · 项目长期笔记

## 项目身份
- 名称：Clarity Ledger（仓库 `obsidian-clarity-ledger`，插件 id `clarity-ledger`）
- 定位：《认知觉醒》工字格笔记法的 Obsidian 桌面插件 —— 待办为主表，计划与实际是它的两个投影，写入 vault 的 Markdown（默认目录 `清晰力/`）。
- 数据完全落 vault，无网络请求，移动端只能读 md（`isDesktopOnly: true`）。
- 桌面/Web 双版本：Web 版规则一致，在另一仓库维护。

## 上架资源状态
- `icon.png`：100×100 PNG，已生成（靛蓝账本 + 工字格 + 橙色行动块）。
- `screenshot.png`：README 顶部仍占位，待补一张界面截图（16:9 宽）。
- README 顶部注释 `<!--上架前需要补两张图…-->` 还挂着，icon 已补，文案可等 screenshot 一并清。
- 源大图 `Square_app_icon_for_an_Obsidia_2026-10-10T13-22-54.png`（1024²），保留以便改版/再裁。

## 工具链速查
- 构建：`npm run build`（esbuild 出 `main.js`+`styles.css`，产物自检 `require` 一遍，防 CJS/循环依赖雷区）。
- 测试：`npm test`（150 用例）；`npm run mutation`（9 个注入错误，验证断言有效——这项目真的在这里栽过"断言匹配注释而不是代码"的坑）。
- 发版：`npm version patch` → `git push --tags`（tag 不带 `v`，且严格等于 `manifest.version`，否则 Obsidian 找不回更新）。
- 上架提交一次之后改版本不用再 PR。

## Python 资源
- Pillow 隔离 venv：`C:/Users/kelon/.workbuddy/binaries/python/envs/icon-resize`，需 `from PIL import Image` 用它即可。

## 设计系统倾向
- 图标：扁平 + 微妙渐变，粗笔触、对比强，避免小尺寸糊。
- 文案：偏好中文 + 结构化 Markdown，描述性小标题（不用一二三），拒过重 AI 味。
- 描述（manifest `description`）：句子收尾要带句号，社区目录机器校验会卡。
