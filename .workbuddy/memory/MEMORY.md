# Clarity Ledger · 项目长期笔记

## 项目身份
- 名称：Clarity Ledger（仓库 `kelon0522/obsidian-clarity-ledger`，插件 id `clarity-ledger`）
- 定位：《认知觉醒》工字格笔记法的 Obsidian 桌面插件 —— 待办为主表，计划与实际是它的两个投影，写入 vault 的 Markdown（默认目录 `清晰力/`）。
- 数据完全落 vault，无网络请求，移动端只能读 md（`isDesktopOnly: true`）。
- 桌面/Web 双版本：Web 版规则一致，在另一仓库维护。
- **远端已建好并推送**（2026-10-11）：public，默认分支 `main`，CI 连续绿。
  本地分支也已从 `master` 改名为 `main`。

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

## lock 的三类坏条目（`npm run lock:fix` 全都处理）
1. **连 `version` 都没有**（空壳）—— 22 个 esbuild 平台二进制。
   症状：`npm ci` 报 `TypeError: Invalid Version`。
2. **有 `version` 但缺 `resolved`/`integrity`** —— 如 `@csstools/css-tokenizer`
   （npm 要解析 peer 元数据才写得全）。症状：`npm ci` 报 `Missing: xxx from lock file`。
3. **缺整条平台条目**（条目根本不在 lock 里）—— 如 `lightningcss` 声明了 11 个平台，
   lock 里只有 `lightningcss-win32-x64-msvc`。**本机完全不可见**（装的是本机平台那份），
   CI 跑 Ubuntu 才炸：`Cannot find module '../lightningcss.linux-x64-gnu.node'`。

- 1 和 2 是「条目在但字段缺」，3 是「条目根本不在」——
  判据不能只看 `!v.version`，三类都要处理。
- 情况 2 必须**就地补字段**、不能整条替换 —— 条目身上有 `peer: true` 等字段。
- 本次累计补了 151 个条目（21 + 130）。
- **本地 `npm install` 会悄悄把 lock 补对** → 「本地好好的、CI 挂了」，
  所以要在干净目录单独验 `npm ci`。
- `scripts/alias.test.ts` 里有 3 条断言守着（平台齐全 / resolved 完整 / os+cpu 字段），
  且只对**按平台分发二进制**的包生效（esbuild / rollup / lightningcss /
  @tailwindcss/oxide）—— 普通可选依赖（fsevents 只在 mac）不能加进 lock。

## 审核报「lockfile is out of date」= npm 大版本不同（2026-10-11 真定论）
- **审核器就在明面上**：`obsidianmd/obsidian-workflows`（社区目录的扫描流程）。
  依赖安装逻辑在 `src/deps.ts`：按 lockfile 挑包管理器，npm → **`npm ci`**；
  「dependency installation failed」= `npm ci` 返回非 0。
  构建跑 `package.json` 里第一个存在的脚本：`build` → `build:plugin` → `compile`。
  **runner 默认 Node 24（= npm 11）**，最低 20。
- **真根因：npm 10 与 npm 11 写进 lock 的条目不一样。**
  同一份 package.json：npm 10 解析出 220 条，npm 11 解析出 **221** 条，
  多的是 `node_modules/@napi-rs/lzma-linux-x64-gnu`（`rollup` 在 Linux 上的
  brotli 依赖）。**npm 10 不写、npm 11 写。**
  → 扫描器跑 `npm install` 发现少这一条 = 「lock 过期」。
- **所以 lock 必须用与扫描器同版本的 npm 生成**：
  `npx -y npm@11 install --package-lock-only`。
- ⚠️ 这条在本机**完全隐身**：npm 10 + Windows、CI（Node 22 → npm 10）全都看不见。
  上一版去修「字段顺序」，方向本身就错了。
- **自检配方**（不依赖审核器，两步都要过）：
  ```
  npx -y npm@11 install --package-lock-only --ignore-scripts   # 再 cmp，必须逐字节一致
  npx -y npm@11 install --package-lock-only --ignore-scripts --os=linux --cpu=x64 --libc=glibc
  ```
- **验证构建也要换 Node 版本**：`npx -y node@24 -p process.execPath` 拿到 node24
  二进制，塞进 PATH 再 `npm run build` —— 审核 runner 是 24，本机是 22。
- 平台二进制条目的「齐全性」正则（`scripts/fix-lock-optional.mjs`、
  `src/config/alias.test.ts`）**必须把 `@napi-rs/lzma-` 也列进去**，
  否则这一整类缺失永远查不出来。

## 官方 lint 插件可以本地跑（别再靠猜）
- `eslint-plugin-obsidianmd`（Obsidian 官方，0.4.2）就是审核的那套规则。
  隔离目录装 `eslint@9 + 插件 + typescript-eslint@8`，
  在**项目目录内**用 `--config <外部配置>` 跑（配置放项目外 ESLint 会拒）。
- 两条**之前的误判**已纠正：
  - `prefer-create-el` 不是「把 `createEl` 认成 `document.createElement`」，
    规则原文是 `Use 'containerEl.createDiv(...)' instead of 'containerEl.createEl('div', ...)'`
    —— **要求用具体 helper**（createDiv / createSpan）。SettingsTab 里那段注释是错的。
  - `no-global-this` **连 `global` 一起报**（文案提示从 'globalThis' 变成 'global'），
    所以「`globalThis` 改写成 `global` 绕开规则」这招**无效**。
- 审核器似乎**跳过 `*.test.tsx`**（报告里从不出现测试文件的位置）。

## 工具链速查
- 构建：`npm run build`（esbuild 出 `main.js`+`styles.css`，产物自检 `require` 一遍，防CJS/循环依赖雷区）。
  - ⚠️ `npm test` **不做类型检查** —— `[...document.querySelectorAll(...)]` 这种
    TS2488（tsconfig 没开 `DOM.Iterable`）只有 build 里的 tsc 拍得到。
  - ⚠️ esbuild 默认把非 ASCII 转成**大写**十六进制 `\uXXXX` 转义 ——
    用 grep 搜中文字符串永远查不到产物里的东西，要用 node 读文件。
- 测试：`npm test`（263 用例）；`npm run mutation`（23 个注入错误，验证断言有效 —— 这项目真的栽过「断言匹配注释而不是代码」的坑）。
  - 新增 describe 必须自己带 `beforeEach`/`afterEach` —— 别的 describe 的清理管不到它，
    漏了的话旧 root 不卸载、host 越积越多，`querySelectorAll` 会数到别的用例的行。
  - 原生 DnD 的 DOM 级测试：伪造 DataTransfer（jsdom 不实现），派发
    **bubbling + cancelable** 的 Event 并挂 dataTransfer 属性（React 18 监听器在根容器）。
- `npm run check:bat`：install.bat 的行尾/编码/BOM 五条断言。
- **测试与变异测试已改为 node 驱动**（`scripts/test.mjs` / `scripts/mutation.mjs`），不再依赖 bash；
  `run-tests.sh` / `mutation.sh` 降级为回退路径，node 拿不到子进程输出时自动落到它们。
- `npm run lock:fix`：补 lock 的两类坏条目。
- 发版：`npm version patch` → `git push --tags`。
- CI：`.github/workflows/ci.yml`（PR/push 跑 测试→构建→产物自检→上架资源+图标尺寸检查）。
  **Node 22 + actions v5，两个 workflow 必须一致**（不一致就是「CI 绿的、Release 红的」）。


## 社区目录的搜索与元数据（2026-10-11 查证）
- **搜索只索引 name / author / description**（obsidian-releases README 原文），
  数据来自 `community-plugins.json`。README 只用于详情页，**不参与搜索**。
- `community-plugins.json` 是 **Obsidian Bot 每小时从目录数据库镜像**的，
  **别手改它提 PR**（会被覆盖）。旧文档让 PR 那个文件的做法已过期。
- 元数据（**short / long description**、图标、分类、截图）在
  **目录后台 → Plugins → 条目 → Edit listing → Save**。
  描述另一条来源是**仓库 HEAD 的 `manifest.json`**（提交表单里没有描述字段），
  两边写成同一份最省事。
- 后台的 `...` 菜单还有两个省事的入口：
  **Request review**（立刻重扫，不用发新版）、
  **Review branch**（发版前先试扫）。
- 描述硬规则：≤250 字符、以 `.!?` 收尾、**不得含 Obsidian**（error）、
  不以插件名开头、不出现 this plugin/the plugin。**不限语言**，中英混排可以。
  ⚠️ 现在是 243 字符，只剩 7 字符余量。

## description 的三条硬约定（2026-10-12 补）
- **`manifest.json` 的 description 一个汉字都不能有** —— 断言是纯计数
  （`alias.test.ts > description 是英文`），书名号里也不行。
  它面向国际用户，而且**不是搜索字段**。
- **搜索字段**只有 `community-plugins.json` 的 name / author / description，
  源头是目录后台 **Edit listing → short description**。要中文关键词就改那里。
- **中文专有名词**放 `README.md`（断言宽松：英文占多数即可）+ `README.zh-cn.md`。
  2026-10-11 往 manifest 里加「认知觉醒」→ CI 连红三条，白折腾一轮。

## 社区目录的显示机制（提 PR 前必看）
- **列表页与详情页顶部那段描述**：新版目录里它是**后台可编辑的**
  （Edit listing → short description），不再等于 `manifest.json` 的 description。
  manifest 那份仍是提交时的初始来源，且**必须是英文**（见上一节）。
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
- **git push 极不稳**：代理间歇性 502 / schannel 断连 / Empty reply。
  但 `gh` 的 API 通路稳定 → 推不上去时用 **Git API**
  （blobs → trees → commits → refs）绕过 git 传输层。
  ⚠️ API 写入的是 CRLF 而 git 期望 LF，之后要
  `git reset --soft origin/main` + `git checkout -- .` + 提交一次行尾规范化。
- `node -e "..."` 里写正则要小心：反斜杠会被 shell 吃掉
  （`\\s*(\\S+)` → `/s*(/S+)/`）。改含正则的代码别走脚本字符串替换。
- 用 heredoc 往 `.ts` 里追加注释时，**注释里不能出现块注释的结束符** ——
  会提前闭合，后面的代码被当代码解析，报一个位置完全对不上的错。

## 「本机绿的、CI 红的」——四道隐形门槛（都踩过）
1. **依赖没在 package.json 里声明**，只是某次 `npm install` 恰好装上了
   → **本机是唯一能跑通的环境**。
2. **依赖的 `engines`**：本机 Node 22 满足、CI 的 Node 20 不满足
   → 报错指向依赖内部，看不出是版本问题。已在两个 workflow 统一到 Node 22
   并给 package.json 补 `engines`。
3. **lock 缺平台二进制条目**：本机装的是本机平台那份，CI 跑 Ubuntu 就装不到
   → `Cannot find module '../xxx.linux-x64-gnu.node'`。见「lock 的三类坏条目」。
4. **workflow 的 `branches:` 写错分支名** → 不报错、不警告，**只是永远不触发**。

判断这类问题最快的办法是**先推上去让 CI 跑一遍** ——
本地再全绿也只有一台机器的信息量。

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
