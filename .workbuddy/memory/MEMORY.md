# Clarity Ledger · 项目长期笔记

> 本文件是长期层。过程与教训的原文在 `.workbuddy/memory/YYYY-MM-DD.md`（按日期查）。
> 最近整合：2026-10-16（0.1.9 发版当天）。

## 项目身份
- 名称：Clarity Ledger（仓库 `kelon0522/obsidian-clarity-ledger`，插件 id `clarity-ledger`）。
- 定位：《认知觉醒》工字格笔记法的 Obsidian 桌面插件 —— 待办为主表，计划/实际是它的两个投影，
  写 vault 的 Markdown（默认 `清晰力/`）。无网络请求；`isDesktopOnly: true`；Web 版在另一仓库（规则一致）。
- 远端 public、默认分支 `main`、CI 连续绿；已上架社区目录、按版本迭代（2026-10-16：**0.1.9**）。
- 日常发版走仓库根 **`发布流程.md`**（四道闸 → push → CI 绿 → version → 推 tag → 查 Release）。
  首次上架记录在 `上架清单.md`；改 migrate.ts / SettingsTab.ts 要按 `手测清单.md` 真机手测。
- 上架资源：`icon.png`（100² 靛蓝账本）、`screenshot.png`（1988×1168）；源大图 1024² 保留以便改版。

## 上架三条硬规则 + 目录元数据机制
- **tag 严格等于 `manifest.version`、不带 `v`**（Obsidian 按 version 找同名 tag）；
  **Release 不能是 draft**（API 只取已发布）；**lock 必须提交**（CI/release 用 `npm ci`）。
- 描述硬规则：≤250 字符、以 `.`/`?`/`!`/`)` 收尾、不含 `Obsidian`、不以插件名开头、
  **manifest 的 description 一个汉字都不能有**（断言是纯计数，书名号里也不行）。
- **搜索只索引 `community-plugins.json` 的 name/author/description** —— 源头是目录后台
  **Edit listing → short description**；要中文关键词改那里，别改 manifest。
- **`README.md` 必须英文**（详情页只渲染它、不参与搜索）；中文放 `README.zh-cn.md`，
  顶部相对链接 `English | [中文](./README.zh-cn.md)`（靠 Obsidian 重写成 GitHub 地址）。
- 后台入口（community.obsidian.md → Plugins → 条目 → `...`）：**Request review**（立刻重扫，不发新版）/
  **Review branch**（发版前试扫）/ Edit listing。`community-plugins.json` 是 bot 每小时镜像，**别手改**。
- **公开诊断途径**：`curl https://community.obsidian.md/plugins/clarity-ledger` 的 HTML 里嵌了
  "Current version / Last updated"（SPA，但数据在 HTML 里）。
- 审核器 `obsidianmd/obsidian-workflows`：硬失败只有 build / 依赖安装 / manifest / 缺 Release 资产 /
  attestation；lint/policy findings 默认 advisory（警告，不挡发布）。

## 行尾符：两个方向的硬要求
- **`.bat` 必须 CRLF** —— cmd.exe 按 CRLF 切分命令，LF 会让它**错位拼接相邻行**，
  把 `REM  Clarity` 截成 `'larity'` + `'al'`，刷几十条无意义报错。**脚本一个字都没错，症状却完全看不出原因。**
- **`.bat` 还得纯 ASCII** —— 按系统 ANSI 代码页（中文机 cp936）读，UTF-8 中文变乱码。
- **`.sh` 必须 LF** —— CRLF 报 `syntax error near unexpected token $'\r'`。
- 已由 `.gitattributes` 锁死（`*.bat eol=crlf`、`*.sh eol=lf`）+ `npm run check:bat`（并入了 build）。
- **这个 bug 本机复现不了**（`core.autocrlf=true` 自动转换），只有 clone 下来的人会炸。
- ⚠️ **别给 `package-lock.json` 加 `-text`**，也别对它 `--renormalize` ——
  会丢条目、连带删 node_modules 的包（详见 .gitattributes 注释）。

## lock 的两个大坑（都踩过）
### 一、「lockfile is out of date」= npm 大版本不同
- 审核 runner = **Node 24 → npm 11**（本机 npm 10、CI npm 10 都看不见差异）。
  同一 package.json：npm 10 解析 220 条、npm 11 写 221 条
  （多 `@napi-rs/lzma-linux-x64-gnu`，rollup 的 Linux brotli 依赖）。
- **lock 必须用扫描器同版本 npm 生成**：
  `npx -y npm@11 install --package-lock-only --ignore-scripts` → `git diff` 必须为空。
- 再验换平台不多要条目：同上命令加 `--os=linux --cpu=x64 --libc=glibc` → 同样为空。
- `lock:fix` 是就地补字段、字段顺序非 npm 规范 → **跑完必须让 npm 完整重写一次**才算完。

### 二、本机 CRLF 伪差异的善后（2026-10-16 补）
- `--package-lock-only` 在这台 Windows 上把工作区 lock **写成 CRLF**；
  `git status` 显示 ` M`，`git diff` 却为空（`text=auto` 归一化），
  `git update-index --refresh` **刷不掉** → 用 `git checkout -- package-lock.json` 恢复。
- 判差异用**归一化 hash**（去掉 `\r` 后 sha1，与 `git show HEAD:…` 比），别信行尾敏感比对。
- **`npm version` 要求工作区干净** —— bump 前必须先恢复，否则直接拒绝。
- 提交时 git 自动归一化回 LF，blob 不受影响（blob 始终是 LF）。

## lock 的三类坏条目（`npm run lock:fix` 全处理）
1. 连 `version` 都没有（空壳，22 个 esbuild 平台二进制）→ `npm ci` 报 `TypeError: Invalid Version`。
2. 有 `version` 缺 `resolved`/`integrity` → 报 `Missing: xxx from lock file`。
   **必须就地补字段**（条目身上有 `peer: true` 等），不能整条替换。
3. 缺整条平台条目（如 `lightningcss` 11 个平台只有 win 那份）→
   **本机不可见**，CI 跑 Ubuntu 才炸 `Cannot find module '../lightningcss.linux-x64-gnu.node'`。
- 齐全性正则（`fix-lock-optional.mjs`、`alias.test.ts`）必须含 `@napi-rs/lzma-`；
  只对按平台分发的包生效（esbuild/rollup/lightningcss/@tailwindcss/oxide），fsevents 这类不能加。
- 本地 `npm install` 会悄悄给 lock 补对 →「本地好好的、CI 挂了」，要在干净目录单验 `npm ci`。

## 官方 lint 可以本地跑（别再靠猜）
- `eslint-plugin-obsidianmd`（0.4.2）就是审核那套规则；隔离目录装
  `eslint@9 + 插件 + typescript-eslint@8`，在项目目录内用 `--config <外部配置>` 跑。
- 已纠正的误判：`prefer-create-el` 是**要求用具体 helper**（createDiv/createSpan）；
  `no-global-this` **连 `global` 一起报**（改写成 global 绕不过）。
- 审核器**跳过 `*.test.tsx`**（报告里从不出现测试文件）。
- 刻意留着 `settings-tab/prefer-setting-definitions` 一条警告（要声明式设置 API，牵动 minAppVersion）。

## 工具链速查
- 构建 `npm run build`：vite CSS → tsc → esbuild → 产物自检（真 `require` main.js）。
  **`npm test` 不做类型检查**（TS2488 这类只有 build 拍得到）。
- esbuild 把非 ASCII 转成**大写** `\uXXXX` —— 搜产物用 node 读文件，别 grep 中文。
- 测试 `npm test`；变异 `npm run mutation`（**`~` 不计入失败**、末尾照样打印「全抓到」，
  要单独 `grep ~`；`expectRed` 要列全所有该红的关键词，否则被判 `~`）。
- 变异日志不能重定向进仓库根（脏检查拒启动）；新增 describe 自带 beforeEach/afterEach
  （漏了旧 root 不卸载、会数到别的用例的行）。
- 原生 DnD 的 DOM 测试：伪造 DataTransfer，派发 **bubbling + cancelable** Event。
- `npm run check:bat`：install.bat 行尾/编码/BOM 五条；测试与变异由 node 驱动（bash 为回退）。
- 发版：`npm version patch`（两个提交 + fix-tag 改名）→ `git push origin main && git push origin <版本>`
  （**git push 不带 tag，必须单独推**）。
- CI 与 Release 两个 workflow 的 Node 版本必须一致（不一致 = 「CI 绿、Release 红」）。

## 写断言的两条纪律（都栽过）
- `detail` 要**惰性求值**（传函数）——构造消息的代码自己会抛，异常发生在包装之外，
  那条断言反而永远绿（check-bat 第一版对 Set 直接调 .map）。
- **别把文案内容写死进断言** —— 拆成「机器规则」（标点/长度/敏感词）+「信息完整性」。
  改文案后必跑变异（变异常锚在具体文字上，换文案后对不上=该断言从未被验证过）。
- 「测试报错但零用例失败」通常是 node_modules 缺包 → `npm install --no-save --ignore-scripts <包名>`。

## 这台机器的环境限制（会误导判断）
- node 里 `spawnSync` 拿不到子进程输出（EBUSY，status: null）——
  「node 里 spawn vitest/git」在这台机器必然失败，换机器正常，别当代码 bug。
- `npm install` 挂 esbuild postinstall（同样 spawn 问题）且慢（7 分钟起）→
  用 `--package-lock-only` + `lock:fix`。
- 验行尾必须**字节级**（Git Bash 的 `grep \r` 会误报）。
- **git push 极不稳**（代理 502 / schannel / Empty reply）→ 用 `gh` 的 API 通路
  （Git API：blobs → trees → commits → refs）；API 写入是 CRLF，之后要
  `git reset --soft origin/main` + `git checkout -- .` + 提交一次行尾规范化。
- `node -e "..."` 里的正则反斜杠会被 shell 吃掉；heredoc 追加注释时注释里不能出现块注释结束符。
- Node 24 直跑构建：npx node@24 的 node.exe 覆盖不过系统 node（shell 解析优先级），
  PATH/cygpath 前置都无效 —— 别再折腾，目录能扫过 0.1.8 就说明兼容性没问题。

## 「本机绿的、CI 红的」四道隐形门槛
1. 依赖没在 package.json 里声明（某次 install 恰好装上）→ 本机是唯一能跑的环境。
2. 依赖的 `engines`（Node 20 vs 22）→ 报错指向依赖内部，看不出是版本问题。已统一 Node 22。
3. lock 缺平台二进制条目 → 见上面「三类坏条目」。
4. workflow 的 `branches:` 写错分支名 → 不报错、不警告、只是永远不触发。
- 最快的判断办法：**先推上去让 CI 跑一遍**。

## styles.css 的作用域纪律（修过一次真事故）
- `styles.css` 是**整个 vault 全局加载**的，裸 `*`/裸 `:focus-visible` 静默污染别人的界面。
- **加 `.cl-root` 前缀还不够** —— 留在 `@layer` 里时 Tailwind v4 会剥掉前缀。
  **作用域规则必须留在 `@layer` 之外**。
- 两侧断言：源码 `src/config/alias.test.ts` + 产物 `scripts/verify-build.mjs`。

## 丢数据的防线
- 写入 250ms 防抖 → `main.tsx` 的 `flushOnBlur()` 拦 window blur / visibilitychange 立刻落盘；
  `onunload` 是同步接口，只做兜底。

## 拖拽的瞬时状态：只留一个来源
- 跨天搬运在 drop 瞬间卸载源行 → dragend 到不了根容器 → 靠 onDragEnd 清理的模块级状态会卡住。
  真事故：TodoList 的 draggingId 卡住，移过来的待办带 `opacity-40` 渲染 = 主理人看到的灰字。
- 修法：高亮直接从 `dnd/shared` 的 payload 推导（dragstart 建、dragend / 各 drop 里清）。
- 诊断线索：`text-dim`（真完成：灰 + ✓ + 删除线）vs `opacity-40`（残留半透明：灰但圈号是数字）。

## 设计倾向 / 杂项
- 文案：中文 + 结构化 Markdown，描述性小标题（不用一二三），拒过重 AI 味。
- Pillow 隔离 venv：`C:/Users/kelon/.workbuddy/binaries/python/envs/icon-resize`。
