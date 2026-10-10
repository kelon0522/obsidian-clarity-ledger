# Clarity Ledger

《认知觉醒》工字格笔记法的 Obsidian 实现。每天一个 Markdown 文件，
待办、计划、实际三栏联动 —— **数据存在你的 vault 里**，能被全文搜索、能 git、能跟着同步走。

![界面截图](screenshot.png)

**桌面端插件，手机装不了。** 手机上直接读 vault 里的 Markdown 就够了，
Obsidian 原生就能渲染那个表格。详见[桌面端 / 移动端](#桌面端--移动端)。

> English summary: A daily planner for Obsidian based on the "T-shaped notes"
> method from *Cognitive Awakening*. Todos are the master table; the plan and
> actual tracks are two projections of it. Everything is stored as plain
> Markdown in your vault — searchable, git-friendly, and synced by whatever
> sync setup you already use. Desktop only.

## 为什么数据是 Markdown 而不是数据库

插件把每天的规划写成一个普通的 md 文件，放在你指定的目录下（默认 `清晰力/`）：

```markdown
# 2026-10-10

| 待办 | 预估 | 计划 | 实际 |
|---|---|---|---|
| 改 GDD 第7章 <!--id:1--> | 1:00 | 8:00–9:00 | |
| 准备联机测试 <!--id:2--> | 0:45 | 10:30–11:15 | 10:35–11:35 |
| 还没排期的事 <!--id:3--> | 0:20 | | |

## 复盘

昨天把复习时间放太靠后……
```

这意味着：

- **可以在 Obsidian 里直接手改**。插件认得出来，写回前会比对mtime，
  判定为外部修改就以你的为准，不会覆盖。
- **可以全文搜索**。任务名、复盘内容都在普通 md 里，Ctrl+Shift+F 能搜到。
- **可以用 git 管起来**，也能跟着你的同步方案走。

## 三栏怎么联动

| 操作 | 结果 |
|---|---|
| 待办拖到计划轨的某个时刻 | 占住那个时间段，后续排期自动顺延 |
| 拖下沿手柄 | 改时长 |
| 计划轨点✓ | 挪到实际轨的**同一时间段**（不是「现在」） |
| 实际轨拖块 / 拖下沿 | 改实际开始时间与时长 |
| 双击待办标题 | 原地改名，三处同步 |
| 在实际轨删块 | 只清实际时间，排期保留 |

**待办是主表，计划与实际是它的两个投影** —— 三处渲染读的是同一份数据，
所以不存在「改了这里忘了同步那里」。

产品上刻意不做自动计时：把任务拖进「实际」这个动作本身就代表「做完了」，
所以没有「进行中」这个状态，实际时长默认等于计划时长。

## 安装

### 手动安装（当前可用）

1. 从 [Releases](https://github.com/kelon/obsidian-clarity-ledger/releases) 下载最新版里的
   `main.js`、`manifest.json`、`styles.css` 三个文件
2. 放进 `<你的 vault>/.obsidian/plugins/clarity-ledger/`（没有就自己建这个目录）
3. 重启 Obsidian，设置 → 第三方插件 → 关闭安全模式 → 启用 **Clarity Ledger**
4. 点左侧栏的日历图标，或者按 `Ctrl+P` 搜「打开今天的规划」

首次启用会提示创建今天的文件。

### 社区插件

提交社区目录审核通过后，这里会变成「设置 → 第三方插件 → 浏览，搜 `Clarity Ledger`」。
在那之前请用上面的手动安装。

## 改存储位置 / 文件名

设置里可以改两样东西：**存储目录**（支持多级）和**文件名模板**。

模板占位符：`{Y}` 四位年 · `{YY}` 两位年 · `{M}` 两位月 · `{D}` 两位日。
比如 `{Y}年{M}月{D}日` 会把 `2026-10-10` 命名为 `2026年10月10日.md`。

**改完离开输入框才生效**（按 Enter 也一样，按 Esc 撤销）。已有文件会**自动迁移**
到新位置、并按新规则改名。

迁移有三条硬规则：

| 规则 | 原因 |
|---|---|
| 只搬「文件名能反解出日期」的文件 | 你在同一目录里放的别的东西（会议纪要、附件）一个都不动 |
| 目标已有同名文件时**跳过，不覆盖** | 覆盖不可逆，跳过你能自己处理 |
| 全部搬失败时**配置不改动** | 否则界面指向空目录，看着像数据全没了 |

搬完会告诉你移了几个、跳过几个、失败几个。跳过的会点名是哪个文件。
旧目录空了就提示你可以手动删 —— 插件不替你删，那是你自己建的目录。

## 桌面端 / 移动端

插件声明 `isDesktopOnly: true`，**手机上装不了**。原因是拖拽走原生 HTML5 DnD，
触屏不触发 `dragstart`；而且时间轴整轴 960px，手机屏幕放不下。

移动端的用法是**直接读 vault 里的 Markdown** —— Obsidian 原生就能渲染那个表格，
查阅、改复盘、补实际时间都可以，不需要插件。数据本来就跟着同步走，
所以手机上看到的和电脑上完全一致。

插件版是主要方向，Web 版在另一个仓库维护，两边产品规则一致。

## 隐私

- 数据只写入你自己的 vault，**不发出任何网络请求**，没有遥测、没有统计。
- 不读 vault 以外的文件，不访问外部服务。

## 开发

```bash
npm install
npm run build       # 产出 main.js + styles.css，并自检
npm test            # 202 个用例
npm run mutation    # 变异测试：注入 15 个错误，确认断言还活着
```

`npm test` / `npm run mutation` 都是**跨平台**的：走 node 驱动，没装 Git Bash 的
Windows 机器也能跑（早先版本直接依赖 bash，等于把 Windows 贡献者挡在门外）。

想改代码的话看 [CONTRIBUTING.md](CONTRIBUTING.md)，里面讲了这个项目的代码约定。
开发时建议装 [Hot-Reload 插件](https://github.com/pjeby/hot-reload)，`Ctrl+R` 重新加载。

构建产物自检会**真的 `require` 一遍 main.js** ——「esbuild 退出码 0」不等于
「Obsidian 能加载」，引用错、循环依赖、CJS 包装坏了都要 require 一次才暴露。
自检里还包含了社区目录的机器校验规则（命名规范、description 的收尾标点等），
把审核会打回的问题提前到本地。

`npm run mutation` 是这个项目最有价值的一条命令：**「测试全绿」不等于「测试有效」**。
断言可能匹配到注释而不是代码（这个项目栽过），也可能被子串匹配绕过。
这个脚本逐个注入已知错误，确认对应断言会红 —— 改代码后跑一遍，能发现
「我以为在测的东西其实没在测」。

## 发版

```bash
npm version patch     # 自动同步 manifest.json 与 versions.json，打不带 v 前缀的 tag
git push --tags       # 触发 .github/workflows/release.yml，自动建 Release
```

Release 附件是 `main.js` + `manifest.json` + `styles.css` 三个文件。

三条踩过一次的规则：

- **tag 必须严格等于 manifest 的 `version` 且不带 `v` 前缀** ——
  Obsidian 按 version 找同名 tag，带 `v` 匹配不上，用户装不到更新。
- **Release 不能是 draft** —— Obsidian 通过 API 取**已发布**的 Release 附件，
  draft 对外不可见。流水线里已经写死 `draft: false`。
- **`package-lock.json` 必须提交** —— 流水线用 `npm ci`，没有 lock 直接失败。

上架到社区目录只需提交一次，之后的版本更新不用再提 PR。

## 许可

MIT，见 [LICENSE](LICENSE)。

方法论出处：《认知觉醒》周岭。

## 相关文件

| 文件 | 干什么用 |
|---|---|
| [CHANGELOG.md](CHANGELOG.md) | 用户能感知到的变化 |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 怎么参与开发、这个项目的代码约定 |
| [手测清单.md](手测清单.md) | 真机手动验证清单（35 项），改核心逻辑后过一遍 |
