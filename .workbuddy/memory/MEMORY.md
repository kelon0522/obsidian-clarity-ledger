# Clarity Ledger · 项目长期笔记

## 项目身份
- 名称：Clarity Ledger（仓库 `obsidian-clarity-ledger`，插件 id `clarity-ledger`）
- 定位：《认知觉醒》工字格笔记法的 Obsidian 桌面插件 —— 待办为主表，计划与实际是它的两个投影，写入 vault 的 Markdown（默认目录 `清晰力/`）。
- 数据完全落 vault，无网络请求，移动端只能读 md（`isDesktopOnly: true`）。
- 桌面/Web 双版本：Web 版规则一致，在另一仓库维护。

## 上架资源状态（2026-10-10 已补齐）
- `icon.png`：100×100 PNG RGBA，17.6 KB（靛蓝账本 + 工字格 + 橙色行动块）。社区列表图标。
- `screenshot.png`：1988×1168 RGB PNG，84 KB。README 顶部。
- README 顶部占位注释已删，改为「桌面端插件，手机装不了」的显著提示 + 英文简介。
- 源大图 `Square_app_icon_for_an_Obsidia_2026-10-10T13-22-54.png`（1024²），保留以便改版/再裁。
- **仓库尚未建 GitHub remote** —— 推送、首个 Release、社区目录 PR 都要主理人自己做。

## 上架三条硬规则（踩过才知道）
- **tag 必须严格等于 `manifest.version` 且不带 `v` 前缀** —— Obsidian 按 version 找同名 tag。
- **Release 不能是 draft** —— Obsidian 走 API 取**已发布** Release 的附件，draft 对外不可见 → 「装了更新装不上」。workflow 已写死 `draft: false`。
- **`package-lock.json` 必须提交** —— release 与 CI 都用 `npm ci`，没 lock 直接失败。
- `description` 收尾必须是 `.`/`?`/`!`/`)`，中文句号 `。` 会被 bot 判成「描述没写完」。

## 工具链速查
- 构建：`npm run build`（esbuild 出 `main.js`+`styles.css`，产物自检 `require` 一遍，防 CJS/循环依赖雷区）。
- 测试：`npm test`（206 用例）；`npm run mutation`（17 个注入错误，验证断言有效 —— 这项目真的栽过「断言匹配注释而不是代码」的坑）。
- **测试与变异测试已改为 node 驱动**（`scripts/test.mjs` / `scripts/mutation.mjs`），不再依赖 bash；
  `run-tests.sh` / `mutation.sh` 降级为回退路径，node 拿不到子进程输出时自动落到它们。
- `npm run lock:fix`：补 lock 里optionalDependencies 的空壳条目（见下）。
- 发版：`npm version patch` → `git push --tags`。
- CI：`.github/workflows/ci.yml`（PR/push 跑 测试→构建→产物自检→上架资源+图标尺寸检查）。

## 这台机器的环境限制（会误导判断）
- **node 里的 `spawnSync` 拿不到子进程输出**：报 `EBUSY`，`status: null`、`stdout: undefined`。
  同一台机器上从 bash 直接跑完全正常。所以任何「node 里 spawn vitest/git」的写法在这台机器上
  **必然失败，但换台机器就正常** —— 别把它当成代码 bug。
- `npm install` 会挂在 esbuild 的 postinstall（同样是 spawn 问题）。
  要生成 lock 用 `npm install --package-lock-only`，再用 `npm run lock:fix` 补全
  （`--package-lock-only` 会给 22 个 esbuild 平台二进制留下空壳条目，
  缺 version 的条目会让 `npm ci` 报 `TypeError: Invalid Version`）。

## styles.css 的作用域纪律（v0.1.0 修过一次真事故）
- `styles.css` 是**整个 vault 全局加载**的 —— 用户日记、主题、其他插件都吃这份 CSS。
- 裸 `*` /裸 `:focus-visible` 会污染别人的界面，且**完全静默**（不报错、功能不坏）。
- **加了 `.cl-root` 前缀还不够**：留在 `@layer base` 里时 Tailwind v4 会重写选择器、把前缀剥掉，
  产物里又变回裸的。**作用域规则必须留在 `@layer` 之外**（与「日历隔离层」同一个病）。
- 两侧都有断言守：源码侧 `src/config/alias.test.ts`（含「必须在 @layer 外」），
  产物侧 `scripts/verify-build.mjs`。

## 丢数据的防线
- 写入是 250ms 防抖的 → 原来「改完直接关 Obsidian」会丢最后一次编辑。
- 现在 `main.tsx` 的 `flushOnBlur()` 拦在 window blur / visibilitychange，立刻落盘。
- `onunload` 是同步接口，救不了这个，只做兜底。

## Python 资源
- Pillow 隔离 venv：`C:/Users/kelon/.workbuddy/binaries/python/envs/icon-resize`，需 `from PIL import Image` 用它即可。

## 设计系统倾向
- 图标：扁平 + 微妙渐变，粗笔触、对比强，避免小尺寸糊。
- 文案：偏好中文 + 结构化 Markdown，描述性小标题（不用一二三），拒过重 AI 味。
- 描述（manifest `description`）：句子收尾要带句号，社区目录机器校验会卡。
