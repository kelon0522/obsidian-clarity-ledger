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
    name: 'description 改回中文句号收尾（社区 bot 会打回）',
    file: 'manifest.json',
    from: /可被全文搜索\./,
    to: '可被全文搜索。',
    expectRed: ['英文标点收尾'],
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
    string: '<div className="relative flex-1 min-h-0">',
    stringTo: '<div className="relative flex-none" style={{ height: 520 }}>',
    expectRed: ['轨道高度交给 CSS flex', '轨道上下限用 CSS 声明'],
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
    mutated = original.replace(m.from, m.to)
  }
  if (m.after) mutated = m.after(mutated)
  return { original, mutated, path, changed: mutated !== original }
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
