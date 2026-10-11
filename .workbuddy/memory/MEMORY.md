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

## 行尾符：两个方向的硬要求
- **`.bat` 必须 CRLF** —— cmd.exe 按 CRLF 切分命令，LF 会让它**错位拼接相邻行**，
  把 `REM  Clarity` 截成 `'larity'` + `'al'` 两条命令，刷几十条无意义报错。
  **脚本一个字都没错，症状却完全看不出原因。**
- **`.sh` 必须 LF** —— CRLF 会让 sh 报 `syntax error near unexpected token $'\r'`。
- **`.bat` 还得纯 ASCII** —— 按系统 ANSI 代码页（中文机器 cp936）读，UTF-8 中文变乱码。
  原作者在文件头写了这条约定，我上一版加了一行中文引用把它破坏了。
- 已由 `.gitattributes` 锁死（`*.bat eol=crlf`、`*.sh eol=lf`）+ `npm run check:bat`（已并入 build）。
- **这个 bug 本机复现不了**（`core.autocrlf=true` 自动转换），只有 clone 下来的人会炸。
- ⚠️ **别给 `package-lock.json` 加 `-text`** —— 加了再跑 `--renormalize` 会丢条目，
  连带把 node_modules 的包删掉。教训已写进 `.gitattributes` 注释。

## lock 的两类坏条目（`npm run lock:fix`）
1. **连 `version` 都没有**（空壳）—— 22 个 esbuild 平台二进制。
   症状：`npm ci` 报 `TypeError: Invalid Version`。
2. **有 `version` 但缺 `resolved`/`integrity`** —— 如 `@csstools/css-tokenizer`
   （npm 要解析 peer 元数据才写得全）。症状：`npm ci` 报 `Missing: xxx from lock file`。

- 判据不能只看 `!v.version`，**两类都要处理**。
- 情况 B 必须**就地补字段**、不能整条替换 —— 条目身上有 `peer: true` 等字段。
- 本次补了 130 个条目。
- **本地 `npm install` 会悄悄把 lock 补对** → 「本地好好的、CI 挂了」，
  所以要在干净目录单独验 `npm ci`。

## 工具链速查
- 构建：`npm run build`（esbuild 出 `main.js`+`styles.css`，产物自检 `require` 一遍，防CJS/循环依赖雷区）。
- 测试：`npm test`（215 用例）；`npm run mutation`（18 个注入错误，验证断言有效 —— 这项目真的栽过「断言匹配注释而不是代码」的坑）。
- `npm run check:bat`：install.bat 的行尾/编码/BOM 五条断言。
- **测试与变异测试已改为 node 驱动**（`scripts/test.mjs` / `scripts/mutation.mjs`），不再依赖 bash；
  `run-tests.sh` / `mutation.sh` 降级为回退路径，node 拿不到子进程输出时自动落到它们。
- `npm run lock:fix`：补 lock 的两类坏条目。
- 发版：`npm version patch` → `git push --tags`。
- CI：`.github/workflows/ci.yml`（PR/push 跑 测试→构建→产物自检→上架资源+图标尺寸检查）。

## 社区目录的显示机制（提 PR 前必看）
- **列表页与详情页顶部那段描述 = `manifest.json` 的 `description`**。
  社区目录以国际用户为主，**必须是英文**。
  bot 机器规则：不含 `Obsidian`/`This plugin`、以 `.`/`?`/`!`/`)` 收尾、≤250 字符。
- **详情页只渲染 `README.md` 这一个文件**，没有「加载第二个 md」的能力。
  多语言做法（参照已上架的 Remotely Save）：
  - `README.md` 放**英文**（Obsidian 渲染的就是它）
  - 另建 `README.zh-cn.md`
  - 顶部一行 `English | [中文](./README.zh-cn.md)`
  - **靠 Obsidian 把 README 的相对链接重写成 GitHub 地址**，所以点「中文」跳 GitHub。
    必须写相对路径 —— 完整 URL 虽然也能跳，但仓库搬家后失效。

## 写断言时的两条纪律（都栽过）
- **断言的 `detail` 要惰性求值**（传函数而不是字符串）。构造消息的代码本身会抛，
  而异常发生在包装之外 —— 于是那条最该抓问题的断言自己先崩了、永远绿。
  `check-bat.mjs` 第一版就栽了：对 `Set` 直接调 `.map` 抛 TypeError。
  **错误消息本身也要测。**
- **别把「文案内容」写死进断言。** 断言里 `toContain('《认知觉醒》')` 这种，
  改文案/换语言就失败。拆成两层：
  **机器规则**（不随内容变：标点、长度、敏感词）+ **信息完整性**（该有哪几项，不写具体字）。
  改了 `manifest.description` 就撞上了这条。
- **「测试报错但一条用例都没失败」通常是 `node_modules` 缺包**，不是测试坏了。
  npm 中途被中断会留下「旧包删了、新的没装完」的半成品，
  vitest 把它记成 unhandled error、用例计数不受影响。
  修：`npm install --no-save --ignore-scripts <缺失包名>`。
- **改文案后一定要跑 `npm run mutation`** —— 变异常锚在文案的具体文字上，
  换文案后匹配不上 → 报「这个变异是假的」→ 那条断言**从未被验证过**，
  而所有测试依然全绿。

## 这台机器的环境限制（会误导判断）
- **node 里的 `spawnSync` 拿不到子进程输出**：报 `EBUSY`，`status: null`、`stdout: undefined`。
  同一台机器上从 bash 直接跑完全正常。所以任何「node 里 spawn vitest/git」的写法在这台机器上
  **必然失败，但换台机器就正常** —— 别把它当成代码 bug。
- `npm install` 会挂在 esbuild 的 postinstall（同样是 spawn 问题），而且很慢（7 分钟起）。
  要生成 lock 用 `npm install --package-lock-only`，再用 `npm run lock:fix` 补全。
- `grep -c $'\r$'` 在 Git Bash 下会误报行尾（自动转换）—— **验行尾必须用字节级检查**。

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
