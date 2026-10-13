/**
 * 变异测试：逐个注入错误，确认对应断言会红。
 *
 * ## 这脚本为什么存在
 *
 * **「测试全绿」不等于「测试有效」。**
 * fixture 里两个本该不同的值设成相同、断言落在表象而非根因上、
 * 或者断言用的工具本身有 bug —— 都会导致「跑通了」但 bug 抓不到。
 * 本项目栽过两次：CSS 的花括号深度断言因为剥离注释的方式有误，
 * 在**被截断的代码**上算出了正确结论，断言"通过"了两轮才发现。
 *
 * 所以把常见的几个变异固化成脚本，改代码后跑一遍，确认断言还活着。
 *
 * ## 为什么不在 node 里 spawn vitest
 *
 * **这个环境里从 node spawn 子进程拿不到 stdout/stderr**
 *（`spawnSync` 返回 `status: null`，即被信号杀掉，一个字节都收不到）。
 * 而从 shell 直接跑 `npx vitest run > log 2>&1` 完全正常。
 * 所以由 `mutation.sh` 负责「跑测试 + 重定向」，本模块只做
 * **改文件 → 读日志 → 用 git 还原 → 判断**。
 *
 * 文件还原走 `git checkout` —— 之前用「备份到 .mutation-bak.json」的方式，
 * 一旦某个变异没 collect 成功，下一个 apply 会把备份覆盖掉，
 * **污染会留在工作区**。实测就是这样把 vault.ts 和 index.css 改坏了两轮。
 * git 基线让还原变得无条件可靠。
 *
 * 用法：`npm run mutation`
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
export const LOG = join(root, '.vitest-mutation.log')

/** 每个变异：改哪个文件、正则怎么改、期待哪条断言红 */
export const MUTATIONS = [
  {
    name: 'esbuild 的 jsx 退回 transform 模式（真机报 React is not defined）',
    file: 'esbuild.config.mjs',
    from: /jsx: 'automatic',/,
    to: '',
    expectRed: ['jsx 走 automatic'],
  },
  {
    name: '@source 指回跨仓库路径（会被 Vite 静默忽略，产物只剩变量壳）',
    file: 'src/index.css',
    from: /@source '\.\/components\//,
    to: "@source '../app/src/components/",
    expectRed: ['CSS 扫描范围'],
  },
  {
    name: '--spacing-row 与 ROWH 脱钩（时间块和横格线会错位）',
    file: 'src/index.css',
    from: /--spacing-row: 40px;/,
    to: '--spacing-row: 23px;',
    expectRed: ['--spacing-row 等于 ROWH'],
  },
  {
    name: '日历隔离层挪进 @layer（主题的 button 样式会压掉工具类）',
    file: 'src/index.css',
    from: /\n\.cl-cal button \{/,
    to: '\n@layer cl-bad {\n.cl-cal button {',
    expectRed: ['隔离层不在'],
    after: (src) => src.replace(/(\n\.cl-day\.cur \.cl-dot \{[^}]*\})/, '$1\n}'),
  },
  {
    name: '清掉 button 的一项 reset（灰底方块会露出来）',
    file: 'src/index.css',
    // 只删**标准**那条，`-webkit-` 前缀的留着 ——
    // 这正是原断言 toContain 的盲区（子串匹配到前缀那条也算命中）
    from: /(\.cl-cal button \{[^}]*?)\n  appearance: none;/,
    to: '$1',
    expectRed: ['默认外观'],
  },
  {
    name: '日期格改回长串工具类（会被主题压掉）',
    file: 'src/components/Calendar.tsx',
    // className 是多行模板字符串，`cl-day` 后面还跟着别的类名 ——
    // 所以替换的是整个 className 值，不是单个词
    from: /className=\{`cl-day font-hw text-xs cursor-pointer/,
    to: "className={`aspect-square bg-ink text-white hover:bg-soft font-hw text-xs cursor-pointer",
    expectRed: ['日期格用具名 class'],
  },
  {
    name: 'manifest 的 isDesktopOnly 改回 false（触屏上拖不动）',
    file: 'manifest.json',
    from: /"isDesktopOnly": true/,
    to: '"isDesktopOnly": false',
    expectRed: ['isDesktopOnly'],
  },
  {
    /* description 已改为英文（社区目录以国际用户为主）。
       这条变异守的是**收尾标点**那条规则 —— bot 只认 . ? ! ) 四个，
       中文句号「。」不在列表里，会被判成「描述没写完」直接打回。

       变异把最后的 `.` 换成中文句号，锚点跟着description 一起改过：
       早先锚在中文的「可被全文搜索」上，description 换成英文后这条变异
       直接**匹配不上** → 报「这个变异是假的」→
       意味着「收尾标点」这条断言从未被验证过。

       变异测试的价值就在这儿：description 改个语言，断言就悄悄失效了，
       而所有测试依然全绿。 */
    name: 'description 改回中文句号收尾（社区 bot 会打回）',
    file: 'manifest.json',
    from: /so it is fully searchable\./,
    to: 'so it is fully searchable。',
    expectRed: ['英文标点收尾'],
  },
  {
    /* 第二条：description 里出现 "Obsidian" 也会被 bot 打回。
       规则见 scripts/verify-build.mjs —— 中文描述时这条很容易犯，
       改英文之后反而要小心别顺手写进去。*/
    name: 'description 里混入 "Obsidian"（bot 硬性拒绝）',
    file: 'manifest.json',
    from: /Daily clarity planner/,
    to: 'Obsidian clarity planner',
    expectRed: ['description 不含'],
  },
  {
    name: 'tsconfig 恢复双路径（又变回跨仓库引用）',
    file: 'tsconfig.json',
    from: /"@\/\*": \["src\/\*"\]/,
    to: '"@/*": ["src/*", "../app/src/*"]',
    expectRed: ['paths 只有一条'],
  },

  {
    name: '轨道高度改回 JS 自反馈计算（回顾区被挤出视口、底部拖不到）',
    file: 'src/view/LedgerView.tsx',
    // 只换 className 那一行 —— 标签是多行的，按整段匹配会失败。
    // flex-1 + min-h-0 → flex-none + 写死高度，等于退回上一版的错
    string: 'className="relative flex-1 min-h-0"',
    stringTo: 'className="relative flex-none" data-cl-main',
    expectRed: ['轨道高度交给 CSS flex', '不许用 ResizeObserver'],
  },
  {
    name: '样式配置改回 .ts（纯 ESM 的@tailwindcss/vite 加载失败）',
    file: 'package.json',
    string: '"build:css": "vite build --config vite.css.config.mts',
    stringTo: '"build:css": "vite build --config vite.css.config.ts',
    expectRed: ['样式配置是 .mts'],
  },

  /* ---------- 迁移规划（破坏性操作，必须有断言守着） ---------- */
  {
    name: '迁移：冲突初值改回same-day（全表被标成冲突，迁移静默全跳过）',
    file: 'src/md/migrate.ts',
    from: /let conflict: MigrationItem\['conflict'\] = null/,
    to: "let conflict: MigrationItem['conflict'] = 'same-day'",
    expectRed: ['不影响我们的文件迁移'],
  },
  {
    /* 用字符串精确替换而不是正则。
       正则里 `f.length + 1` 的 `+` 会被当量词，这条变异因为**正则没匹配上**
       被报成「变异是假的」—— 而那恰恰意味着这条断言从未被验证过。
       变异脚本里用正则的风险就在这里：没匹配上和「断言无效」
       长得很像，但含义完全相反。 */
    name: '迁移：目录判断用前缀匹配（子目录里的文件会被误搬）',
    file: 'src/md/migrate.ts',
    string: "  if (!path.startsWith(f + '/')) return false\n  const rest = path.slice(f.length + 1)\n  return !rest.includes('/')",
    stringTo: "  return path.startsWith(f + '/')",
    // 前缀匹配会让子目录里的文件也进迁移表，两条断言都该红
    expectRed: ['旧目录里不是清晰力数据', 'basename 取最后一段'],
  },
  {
    name: '迁移：不检查目标是否被占就执行（同一天的两份数据会被覆盖）',
    file: 'src/md/migrate.ts',
    // 只删「目标被占」那个分支，保留 name-clash 分支
    from: /\s*\} else if \(pathSet\.has\(toPath\) && !vacating\.has\(toPath\)\) \{[^}]*\}/,
    to: '\n    }',
    expectRed: ['目标已有同一天'],
  },

  /* ---------- 全局样式污染 ----------
     这三条要抓的是「注入用户整个 vault」的行为。
     社区目录的 reviewer 会盯这一类，而它们一旦回归是**静默的**：
     插件不报错、功能不坏，只是用户觉得「装了之后界面变了」。
     所以变异也必须有 —— 否则断言可能又变成永远绿的那种。

     变异改的是 `src/index.css`（源码侧断言在 `src/config/alias.test.ts`），
     expectRed 里的名字要与那里的 it() 描述对得上。

     **两条跨行的变异都用 `string` 而不是正则** ——
     正则里的 `\n` 碰上 CRLF 会匹配不上，报出来的是
     「这个变异是假的 / 从未被验证过」，而真实原因只是行尾符。
     （早先就踩了：两条新变异当场报「假的」，害我以为断言写错了。）
     `string` 分支会自己适配 CRLF，用它就没事。 */
  {
    name: 'focus-visible 退回裸选择器（给用户整个 vault 套玫红描边）',
    file: 'src/index.css',
    string: '.cl-root :focus-visible {',
    stringTo: ':focus-visible {',
    expectRed: ['focus-visible 限定在 .cl-root 内'],
  },
  {
    name: 'prefers-reduced-motion 退回裸 * （压掉用户所有插件的动效）',
    file: 'src/index.css',
    string: '  .cl-root *,\n  .cl-root *::before,\n  .cl-root *::after {',
    stringTo: '  *,\n  *::before,\n  *::after {',
    expectRed: ['prefers-reduced-motion 限定在 .cl-root 内'],
  },
  {
    /* 第二层事故：前缀写对了，但**留在 @layer 里** ——
       Tailwind v4 处理 layer 时重写选择器，产物里前缀被剥掉，
       源侧断言全绿、用户那边照样被污染。
       这条变异模拟的就是「以为改好了，其实在 layer 里」。

       注意 `to` 的结尾：**故意不补 `}`** —— 少一个右花括号会让
       整个 CSS 从这一行起解析失败，套件崩掉（verdict=crashed），
       那就算「变异改坏了文件」，不算数。要模拟的必须是
       「语法合法但位置错误」。*/
    name: 'focus-visible 的作用域规则挪进 @layer（Tailwind 会剥掉前缀，源侧看着还对）',
    file: 'src/index.css',
    string:
      '.cl-root :focus-visible {\n  outline: 2px solid var(--color-ink);\n  outline-offset: 2px;\n}',
    stringTo:
      '@layer base {\n.cl-root :focus-visible {\n  outline: 2px solid var(--color-ink);\n  outline-offset: 2px;\n}',
    expectRed: ['留在 @layer 之外'],
  },

  /* ---------- 待办拖拽规则（2026-10-13 新增） ----------
     两条产品规则 + 一条数据完整性规则。每条都配了变异 ——
     「拖了没反应」这类问题**不报错、不崩溃**，只有断言能守住。 */
  {
    name: '已完成待办恢复可拖（draggable 不再看 done）',
    file: 'src/components/TodoList.tsx',
    string: 'draggable={!done}',
    stringTo: 'draggable',
    expectRed: ['已完成的待办行 draggable=false'],
  },
  {
    // 双保险的第二道：浏览器万一照样派发 dragstart，也不能把 id 放进通道
    name: '去掉 dragstart 里的已完成拦截（第二道防线失效）',
    file: 'src/components/TodoList.tsx',
    string: '        if (done) {\n          e.preventDefault()\n          return\n        }\n',
    stringTo: '',
    expectRed: ['dragstart 也不建立拖拽通道'],
  },
  {
    name: 'moveTaskToDay 不再拒绝已完成的待办（act != null 也能搬走）',
    file: 'src/store/index.ts',
    string: 'if (!hit || hit.act != null) return',
    stringTo: 'if (!hit) return',
    expectRed: ['已完成的待办不能搬'],
  },
  {
    /* 少了这道，拖回当天会走完搬迁流程：先从当天移除、再追加到当天
       末尾 —— 顺序静默变化，用户什么都没点却看到待办换了位。 */
    name: 'moveTaskToDay 允许拖回当天（变成静默重排到末尾）',
    file: 'src/store/index.ts',
    string: 'if (toKey === cur) return',
    stringTo: '',
    expectRed: ['拖回当天'],
  },
  {
    /* 目标天不标脏 = 搬过去的内容只活在内存里，250ms 后刷新/重启就回去。
       源天写了（少一条）、目标天没写（不多这条）—— 数据搬了一半。 */
    name: 'moveTaskToDay 不把目标天标脏（搬过去的内容不落盘）',
    file: 'src/store/index.ts',
    string: 'markDirty(toKey)',
    stringTo: '',
    expectRed: ['两天都写脏'],
  },
]

/** 改文件，返回 { changed } —— changed=false 表示变异没生效（没匹配上） */
export function applyMutation(m) {
  const path = join(root, m.file)
  const original = readFileSync(path, 'utf8')

  let mutated
  if (typeof m.string === 'string') {
    /* 字符串精确替换。
       - 优先用这个而不是正则：`f.length + 1` 的 `+` 会被当量词，
         没匹配上时报「变异是假的」，而那恰恰意味着断言从未被验证过
       - **换行符必须两边都对齐** —— 这个仓库的文件在 Windows 上是 CRLF，
         而变异定义里写的是 LF。`includes` 直接比会永远为 false，
         而且报错会指向「正则没匹配上」，与真实原因无关 */
    const crlf = original.includes('\r\n')
    const needle = crlf ? m.string.replace(/\n/g, '\r\n') : m.string
    const repl = crlf ? m.stringTo.replace(/\n/g, '\r\n') : m.stringTo
    if (!original.includes(needle)) return { original, mutated: original, path, changed: false }
    mutated = original.replace(needle, repl)
  } else {
    /* 正则分支 —— **同样要处理 CRLF**。
       早先这里直接 `original.replace(m.from, m.to)`，而变异定义里
       的正则写的是 `\n`。这个仓库的文件在 Windows 上是 CRLF
       （git 检出时按 core.autocrlf 转成 CRLF），于是：

       ```
       /  \.cl-root \*,/   ← 定义里是 LF
       实际文件里是  \r\n
       ```

       正则不匹配 → `changed: false` → 报「这个变异是假的」。

       **症状极具误导性**：报的是「断言从未被验证过」，
       真实原因却是「行尾符不匹配」—— 而那条断言其实有效得很。
       这个项目在这类「报错指向A、原因在B」上栽过好几次了。

       修法：文件是 CRLF 时，把正则里的 `\n` 换成 `\r\n`。
       用 `source.replace(/\\n/g, '\\r\\n')` 只动反斜杠+n 这个两字符序列，
       不会误伤 `\n` 字面量以外的东西。*/
    let re = m.from
    if (original.includes('\r\n')) re = adaptCrlf(m.from)
    mutated = original.replace(re, m.to)
  }
  if (m.after) mutated = m.after(mutated)
  return { original, mutated, path, changed: mutated !== original }
}

/** 把正则源码里的 `\n` 转义换成 `\r\n` 转义（行尾符对齐用） */
function adaptCrlf(re) {
  return new RegExp(re.source.replace(/\\n/g, '\\r\\n'), re.flags)
}

/**
 * 剥掉 ANSI 转义序列。
 *
 * **vitest 的输出带颜色码**，且颜色码会插在断言名的中间：
 * `\x1b[31m   × \x1b[31m模块绑定\x1b[2m > \x1b[22mCSS里的...\x1b[90m 10\x1b[2mms`
 * 不剥的话 `\d+ms$` 锚点永远匹配不上，**所有变异都会误判成「全绿」**。
 * 这个坑的表现和「断言完全失效」一模一样 —— 但根因只是颜色码。
 */
export function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, '')
}

/** 解析 vitest 日志，取变红的断言名 */
export function parseFailures(log) {
  const clean = stripAnsi(log)
  const failed = []
  // 形如「   × describe > it  10ms」
  for (const m of clean.matchAll(/^\s*[×x]\s+(.+?)\s+\d+ms\s*$/gm)) failed.push(m[1].trim())
  return failed
}

/** 日志里有没有「套件整体崩了」的迹象（变异把文件改坏） */
export function suiteCrashed(log) {
  const clean = stripAnsi(log)
  return /Failed Suites|Transform failed|SyntaxError|Error: /.test(clean)
}

export { root, here, rmSync, readFileSync, writeFileSync, join }
