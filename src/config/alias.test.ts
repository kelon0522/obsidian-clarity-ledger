/**
 * @vitest-environment jsdom
 *
 * 回归测试的三个主题：
 *
 * 1. **模块绑定** —— `@` 指向本仓库的 src，各模块导出对不对
 * 2. **样式隔离** —— Obsidian 主题的 CSS 是**不分层**的，
 *    按 CSS 规范永远赢过分层的 Tailwind 工具类。隔离层必须留在 `@layer` 外面
 * 3. **存储配置** —— 设置项改了以后读取/写入路径必须跟着改，
 *    「改了一半」是最容易犯的错
 *
 * ## 早先这里还有两组测试，抽成独立仓库后删了
 *
 * - **别名顺序不能反**：原先和 Web 版共用一份源码，靠「先查插件的 src、
 *   查不到再落到 app/src」的顺序来隔离存储。现在只有一种来源，
 *   顺序这个概念不存在了。
 * - **React 单例锁**：原先两个目录各有一份 node_modules，esbuild 按**路径**去重
 *   → react 被打两份 → hook 找不到 dispatcher → `Cannot read properties of
 *   null (reading 'useRef')` → createRoot 卸载整棵树 → **真机白屏**。
 *   独立仓库只有一份 node_modules，前提消失，锁没有意义。
 *   回归防线换了个位置：`scripts/verify-build.mjs` 查产物里有没有重复打包。
 */
import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/* `import.meta.url` 在 vitest 转换后不是 file URL，fileURLToPath 会抛
   「The URL must be of scheme file」。用 cwd 推算更稳。 */
const here = resolve(process.cwd())

vi.stubGlobal(
  'localStorage',
  (() => {
    const m = new Map<string, string>()
    return {
      length: 0,
      clear: () => m.clear(),
      getItem: (k: string) => m.get(k) ?? null,
      key: () => null,
      removeItem: (k: string) => void m.delete(k),
      setItem: (k: string, v: string) => void m.set(k, String(v)),
    }
  })(),
)

const read = (p: string) => readFileSync(join(here, p), 'utf8')

/**
 * 去掉 JS/TS 注释，只留代码。
 *
 * **为什么必须去注释再断言「某字符串不存在」** ——
 * 断言里常有解释 bug 来龙去革的注释，注释里提到了正要断言「不该出现」
 * 的那个字面量，全文扫必然误报。
 *
 * 正则注释没有嵌套语义（字符串里的 `//` 不算注释），
 * 对「读自己项目源码」这个场景足够 —— 断言本来就该落在真实的代码上。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/**
 * CSS 专用的「去注释」：**只滤掉整行都是注释的行**，保留其余内容原样。
 *
 * ## 为什么不用正则块注释剥离
 *
 * `replace(块注释正则, '')` 在这个文件上是错的 ——
 * glob 里的第一处双星号会被当成注释结束符，
 * 路径被截成 `./components` 加一段尾巴，后面的信息全丢。
 * 通用版（还多一条双斜杠的行注释规则）错得更彻底，连递归通配一起吃掉。
 *
 * **块注释剥离器原理上处理不了含 `**` 的内容。**
 *
 * ## 改成滤行有什么代价
 *
 * 块注释内部跨行时，里面以 `*` 开头的那些行会被滤掉，
 * 块注释第一行 `/*...` 本身也会被滤掉（它不以 ` * ` 开头时要靠内容判断）。
 * 对这个文件够用：注释里没有裸花括号，花括号配对不受影响。
 * **花括号深度是这套断言的全部依赖 —— 一旦有人在注释里写了个 `{`，
 * 这套断言就开始胡说。** `cssBracesAreBalanced` 会守住这一点。
 */
function stripCssCommentLines(src: string): string {
  return src
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\*|\/\*|\/\/)/.test(l))
    .join('\n')
}

/**
 * 花括号必须配平 —— `stripCssCommentLines` 能用的前提。
 *
 * 注释里若出现裸花括号，深度计算就全错，而且错得很安静。
 * 所以这条要在依赖它的那几条**之前**断言。
 */
function cssBracesAreBalanced(src: string): boolean {
  let d = 0
  for (const c of src) {
    if (c === '{') d++
    else if (c === '}') {
      d--
      if (d < 0) return false
    }
  }
  return d === 0
}

/**
 * 只取 CSS 里**代码部分**的 `@source` 路径。
 *
 * 逐行取而不是正则全文扫：注释里的 `@source` 一定以 `*` 开头
 * （会被上面的行过滤掉），真正的指令行以 `@` 开头。
 * 这个区分是 CSS 的事实，不靠猜。
 */
function cssSourcePaths(src: string): string[] {
  return src
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith('@source'))
    .map((l) => l.match(/@source\s+['"]([^'"]+)['"]/)?.[1] ?? '')
    .filter(Boolean)
}

describe('模块绑定 · @ 指向本仓库 src', () => {
  it("import { useStore } from '@/store' 拿到的是带落盘能力的 store", async () => {
    const { useStore } = await import('@/store')
    expect(typeof (useStore as never as { getState: () => { saving: boolean } }).getState().saving).toBe(
      'boolean',
    )
  })

  it('store 有写 vault 的三个入口（bindVault / flushNow / hasPendingWrite）', async () => {
    const m = await import('@/store')
    expect(typeof m.bindVault).toBe('function')
    expect(typeof m.flushNow).toBe('function')
    expect(typeof m.hasPendingWrite).toBe('function')
  })

  it("import from '@/core/time' 的几何常量", async () => {
    const { ROWH, AXIS_PX, SLOT, fmt } = await import('@/core/time')
    expect(ROWH).toBe(40)
    expect(AXIS_PX).toBe(960)
    expect(SLOT).toBe(15)
    expect(fmt(480)).toBe('08:00')
  })

  /** `--spacing-row` 与 `ROWH` 不同步的话，时间块高度会和横格线错位 */
  it('CSS 里的 --spacing-row 等于 ROWH', async () => {
    const { ROWH } = await import('@/core/time')
    const css = read('src/index.css')
    const m = css.match(/--spacing-row:\s*(\d+)px/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(ROWH)
  })

  it("import from '@/core/logic' 是领域规则", async () => {
    const { finished, effDur, planDur } = await import('@/core/logic')
    const t = { id: 1, ti: 'x', est: 60, plan: 480, pd: 90, act: 600, ad: 90 }
    expect(finished(t)).toBe(true)
    expect(effDur(t)).toBe(90)
    expect(planDur(t)).toBe(90)
  })
})

describe('构建配置', () => {
  it('esbuild 的 jsx 走 automatic（否则真机报 React is not defined）', () => {
    /* 默认的transform 模式会产出 React.createElement(...)，
       而组件只 import 了 { useState }，作用域里没有 React 绑定。
       **构建退出码 0、产物大小正常，只在真机渲染时炸。***
       变异测试：删掉这行断言会红。 */
    expect(read('esbuild.config.mjs')).toMatch(/jsx:\s*'automatic'/)
    expect(read('vitest.config.ts')).toMatch(/jsx:\s*'automatic'/)
  })

  it('@ 只指向本仓库的 src（不再有回退到 app/src 的分支）', () => {
    const src = read('esbuild.config.mjs')
    expect(src).toContain("alias: { '@': path.join(here, 'src') }")
    expect(stripComments(src)).not.toContain('app/src')
  })

  it('tsconfig 的 paths 只有一条', () => {
    const t = readFileSync(join(here, 'tsconfig.json'), 'utf8')
    expect(t).toContain('"@/*": ["src/*"]')
    expect(t).not.toContain('@app/*')
  })
})

describe('CSS 扫描范围', () => {
  const css = readFileSync(join(here, 'src', 'index.css'), 'utf8')

  it('index.css 显式 @source 覆盖了组件与 ui 目录', () => {
    /* 少了这两行，被复用组件的类名扫不到，界面全裸。
       **必须用 glob 而非目录写法** —— 目录写法不递归，等于没扫。 */
    expect(css).toContain("@source './components/**/*.{ts,tsx}'")
    expect(css).toContain("@source './ui/**/*.{ts,tsx}'")
  })

  it('@source 全部指向本仓库内（指向 Vite root 之外会被静默忽略）', () => {
    /* 这是个**静默**失败：不报错不警告，产物从 31 KB 掉到 9 KB，
       只剩变量壳，界面完全没有样式。断言的是配置本身，不是产物 ——
       产物会被缓存掩盖。

       逐行取（cssSourcePaths），不要全文正则扫 ——
       那会把注释里解释这个坑的那段文字也算进来。 */
    const sources = cssSourcePaths(css)
    expect(sources.length).toBeGreaterThan(0)
    sources.forEach((path) => {
      // '..' 开头 = 出了 Vite root = 会被静默忽略
      expect(path).toMatch(/^\.\//)
      expect(path).not.toContain('..')
      // **必须用递归通配**：只写目录不递归，等于没扫
      expect(path).toContain('**')
    })
  })

  it('vite 的 root 没有被抬到仓库外', () => {
    expect(stripComments(read('vite.css.config.ts'))).not.toContain("path.join(here, '..')")
  })
})

describe('日历样式隔离（真机样式不对的根因）', () => {
  /**
   * 主理人截图对比，发现日期格有灰底 + 边框、宽度对不齐、
   * 「今天」不是实心玫红块。
   *
   * **根因不是「样式写错了」，是 CSS 层叠规则**：
   * Tailwind v4 把工具类放进 `@layer utilities`，
   * 而 Obsidian 主题的 CSS 是**不分层**的 ——
   * 按 CSS 规范，不分层的样式**永远赢过**分层的。
   * 于是主题的 `button { background: var(--interactive-normal); padding: ... }`
   * 直接压掉 `bg-ink` / `aspect-square` / `w-5`。
   *
   * **所以隔离层必须留在 @layer 外面。** 放进 layer 等于没写 ——
   * 变异测试：把这段挪进 @layer，这些断言会红。
   */
  it('隔离层不在 @layer 里（进了就被主题压掉，等于没写）', () => {
    const css = read('src/index.css')
    /* 前置条件：注释里不能有裸花括号，否则下面的深度计算全错。
       这条必须先跑 —— 它守着后面几条断言的正确性。 */
    expect(cssBracesAreBalanced(stripCssCommentLines(css))).toBe(true)

    /* 全文扫会误报注释里的 @layer —— 这个文件里有好几段注释正是在解释
       「为什么不能进 layer」，那些字面量必然出现。 */
    const code = stripCssCommentLines(css)
    const i = code.indexOf('.cl-cal button')
    expect(i).toBeGreaterThan(-1)

    /* 数花括号深度，隔离层处必须是 0 —— 也就是不在任何 @layer 里。
       变异测试踩过的坑：最早这版断言查的是「隔离层**之前**有没有 @layer」，
       但变异是把 `@layer foo {` 开在隔离层**前面**的，
       slice(0, i) 根本看不到 —— 19 条全绿，假通过。
       **只查前面的写法天然抓不到「把自己包起来」这个变异。** */
    let depth = 0
    for (let k = 0; k < i; k++) {
      if (code[k] === '{') depth++
      else if (code[k] === '}') depth--
    }
    expect(depth).toBe(0)

    /* 再反查一次：隔离层往后不该再开启任何 layer
       （设置面板的隔离层也是同一批 —— 它同样不能进 layer）。 */
    expect(code.slice(i).match(/@layer/g) ?? []).toHaveLength(0)
  })

  it('清掉了主题给 button 的四项默认外观', () => {
    const css = read('src/index.css')
    const seg = css.slice(css.indexOf('.cl-cal button'), css.indexOf('.cl-nav'))
    // 这四项是「灰底方块」的来源，少一个就会露出来
    expect(seg).toContain('appearance: none')
    expect(seg).toContain('background: transparent')
    expect(seg).toContain('border: 0')
    expect(seg).toContain('box-shadow: none')
    /* padding 是「7 列对不齐」的直接原因：
       aspect-ratio 算 content-box，主题给的 padding 把它撑成不等宽。 */
    expect(seg).toContain('padding: 0')
    expect(seg).toContain('min-width: 0')
    expect(seg).toContain('min-height: 0')
  })

  it('日期格用具名 class 而不是长串工具类', () => {
    const cal = readFileSync(join(here, 'src', 'components', 'Calendar.tsx'), 'utf8')
    expect(cal).toContain('cl-day')
    expect(cal).toContain('cl-nav')
    expect(cal).toContain('cl-dot')
    /* 旧的工具类写法不该还在。
       **只扫 className 那一行** —— 注释里提到 aspect-square 是正常的
       （那段注释正是在解释为什么不能用它）。全文扫会误报。 */
    const clsLines = cal.split('\n').filter((l) => l.includes('className='))
    expect(clsLines.length).toBeGreaterThan(0)
    clsLines.forEach((l) => {
      expect(l).not.toContain('aspect-square')
      expect(l).not.toContain('bg-ink text-white')
      expect(l).not.toContain('hover:bg-soft')
    })
  })

  it('cur 是实心玫红块 —— 用户最直观的对错信号', () => {
    const css = read('src/index.css')
    const i = css.indexOf('.cl-day.cur {')
    expect(i).toBeGreaterThan(-1)
    const seg = css.slice(i, i + 120)
    expect(seg).toContain('background: var(--color-ink)')
  })

  it('底色跟着 Obsidian 主题走（硬写纸面色会在暗色主题下刺眼）', () => {
    const code = stripCssCommentLines(read('src/index.css'))
    expect(code).not.toMatch(/body\s*\{[^}]*background:\s*#fefdf8/i)
  })
})

describe('存储位置可配置（不硬编码）', () => {
  /**
   * 设置面板让存储目录和文件名模板都能配。
   *
   * **最容易出的错是「改了一半」** —— 设置项加了，
   * 但读取那侧还硬编码着 `清晰力/` 和 `^\d{4}-\d{2}-\d{2}$`。
   * 症状是「设置改了没反应」或「切到自定义目录后一条数据都读不出来」。
   */

  it('vault.ts 不再硬编码目录与日期正则', () => {
    const code = stripComments(readFileSync(join(here, 'src', 'md', 'vault.ts'), 'utf8'))
    expect(code).not.toContain("'清晰力'")
    // 硬编码的日期正则会把 {Y}年{M}月{D}日 这类模板的文件全判成「不是数据」
    expect(code).not.toMatch(/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/)
    expect(code).toContain('parseName(this.cfg.nameTemplate')
  })

  it('VaultStore 的路径全部经由 pathOf（不各处拼字符串）', () => {
    const src = readFileSync(join(here, 'src', 'md', 'vault.ts'), 'utf8')
    // 三处写路径（writeDay / readDay / removeDay）都该走同一个入口
    const direct = src.match(/`\$\{FOLDER\}/g) ?? []
    expect(direct).toHaveLength(0)
    expect(src.match(/this\.pathOf\(/g)?.length ?? 0).toBeGreaterThanOrEqual(3)
  })

  it('main.tsx 有设置面板与配置读档', () => {
    const src = readFileSync(join(here, 'src', 'main.tsx'), 'utf8')
    expect(src).toContain('addSettingTab')
    expect(src).toContain('withDefaults(await this.loadData())')
    expect(src).toContain('saveSettings')
    // openAtStartup 的开关真的接上了，不是写死的
    expect(src).toContain('this.settings.openAtStartup')
  })

  it('视图不自己去 app.plugins 里翻配置（方向反了）', () => {
    const code = stripComments(readFileSync(join(here, 'src', 'main.tsx'), 'utf8'))
    /* 早先的写法是 `this.app.plugins.getPlugin('clarity-ledger')`——
       从插件对象往回找自己。而且 Obsidian 的 App 类型根本没有 plugins，
       编译就过不了。改成注册视图时闭包注入。 */
    expect(code).not.toContain('app.plugins.getPlugin')
    expect(code).toContain('createLedgerView(() => this.settings)')
  })

  it('改存储位置后会重开视图（否则界面还显示旧数据）', () => {
    const tab = readFileSync(join(here, 'src', 'config', 'SettingsTab.ts'), 'utf8')
    expect(tab).toContain('reopenView')
    expect(tab).toContain('flushNow()')
    /* 顺序不能反：先 flush 再重开。反了的话待写的数据会被写进旧目录。 */
    expect(tab.indexOf('flushNow()')).toBeLessThan(tab.indexOf('reopenView()'))
  })

  it('切目录前会提示那边已有文件（防「看起来数据没了」）', () => {
    const tab = readFileSync(join(here, 'src', 'config', 'SettingsTab.ts'), 'utf8')
    expect(tab).toContain('hasAnyFile')
  })

  /**
   * description 会被社区目录的 bot 校验，规则比看起来严：
   * 不能含 "Obsidian"/"This plugin"、**必须以 `.` `?` `!` 或 `)` 结尾**、≤250 字符。
   * 中文句号「。」不在允许列表里，会被判成「描述没写完」直接打回。
   * 所以文案里保留书名号没问题，结尾那个英文句点是硬要求。
   * 完整规则由 scripts/verify-build.mjs 断言，那边才是第一道门。
   */
  it('manifest 的 description 是主理人拍板的文案，且以英文标点收尾', () => {
    const m = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'))
    expect(m.description).toContain('《认知觉醒》')
    expect(m.description).toContain('工字格')
    expect(m.description).toContain('每日清晰力规划')
    expect(m.description).toMatch(/[.?!)]$/)
  })

  /**
   * `isDesktopOnly: true` 是**如实声明**，不是偷懒。
   *
   * 跨区拖拽走原生 HTML5 DnD，移动端 WebView 不触发 `dragstart`，
   * 触屏上根本拖不动；而时间轴整轴 960px，手机屏幕放不下。
   * 声明 false 会在审核实测时被要求改，不如直接标true。
   *
   * 移动端的路径是读vault 里的 Markdown —— Obsidian 原生就能渲染表格，
   * 查阅和轻改不需要插件。
   */
  it('isDesktopOnly 为 true（拖拽在触屏上不可用，如实声明）', () => {
    const m = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'))
    expect(m.isDesktopOnly).toBe(true)
  })
})
