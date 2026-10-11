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
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
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
 * CSS 的**纯块注释剥离** —— 只删成对的块注释标记，保留其他一切。
 *
 * **用途仅限「数花括号深度」。** 那种场景需要配平的代码，
 * 跨行块注释里的真实声明必须一起删掉，否则花括号配不平。
 *
 * **不能用来提取 `@source` 的路径** ——
 * glob 里的递归通配（两个星号紧跟一个斜杠）会被当成注释结束符，
 * 于是 `'./components/' + 通配` 被截成 `'./components' + 半个通配`，路径信息全丢。
 * 那件事要用 `cssSourcePaths`（逐行取，不剥注释）。
 *
 * 也不能替代 `stripComments` 读 TS —— 它的双斜杠规则会截断同样的通配。
 *
 * （这条注释本身也有个坑：上面那段描述里如果直接写出通配原文，
 * 会把**本注释**提前闭合。同一个坑在这个文件里踩了三次。）
 */
function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '')
}

/**
 * 取一段规则（从行首的选择器开始，到它自己的 `}` 结束）。
 *
 * ## 为什么必须锚定行首
 *
 * 早先用 `src.indexOf(selector)` —— 抓到的是**注释里提到的那次**，
 * 而不是规则本身。切片从注释中间开始，`appearance: none` 那些真实声明
 * 一条都没包含进去，提取数恒为 0。
 * **报错是「expected +0 to be 2」，看起来像「声明被删了」，
 * 实际是定位错了位置。**
 *
 * 行首锚定（`\n` 或字符串开头 + 选择器 + `{`）才是规则的定义处。
 *
 * 也因此这里用**原文**：规则内部可能有跨行注释，
 * 任何过滤都可能切掉声明。
 */
function cssRule(src: string, selector: string): string {
  const re = new RegExp(`(?:^|\\n)[ \\t]*${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`)
  const m = re.exec(src)
  if (!m) return ''
  const start = m.index + (m[0].startsWith('\n') ? 1 : 0)
  // 从选择器起的第一个 `}` 就是这条规则的结尾
  const end = src.indexOf('}', start)
  return end < 0 ? '' : src.slice(start, end + 1)
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

  /**
   * `--spacing-row` 与 `ROWH` 不同步的话，时间块高度会和横格线错位。
   *
   * **必须剥注释** —— CSS 头部那段注释里就写着「必须等于 ROWH（40px）」，
   * 不剥的话第一处匹配到的可能是注释里的 40px。
   * （这条现在被变异测试覆盖：把 40 改成 23 会红。）
   */
  it('CSS 里的 --spacing-row 等于 ROWH', async () => {
    const { ROWH } = await import('@/core/time')
    const css = stripCssCommentLines(read('src/index.css'))
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
    /* 默认的 transform 模式会产出 React.createElement(...)，
       而组件只 import 了 { useState }，作用域里没有 React 绑定。
       **构建退出码 0、产物大小正常，只在真机渲染时炸。**

       **必须先剥注释再断言** ——
       变异测试抓到过：删掉真配置那一行，这个断言仍然全绿，
       因为esbuild.config.mjs 的**注释里**也写着 `jsx: 'automatic'`
       （那段注释正是在解释为什么必须配）。断的是注释，不是代码。*/
    expect(stripComments(read('esbuild.config.mjs'))).toMatch(/jsx:\s*'automatic'/)
    expect(stripComments(read('vitest.config.ts'))).toMatch(/jsx:\s*'automatic'/)
  })

  it('@ 只指向本仓库的 src（不再有回退到 app/src 的分支）', () => {
    const src = read('esbuild.config.mjs')
    // 同样要剥注释 —— 配置项的**注释里**就在讲「早先怎么映射到 app/src」
    expect(stripComments(src)).toContain("alias: { '@': path.join(here, 'src') }")
    expect(stripComments(src)).not.toContain('app/src')
  })

  it('tsconfig 的 paths 只有一条', () => {
    const t = readFileSync(join(here, 'tsconfig.json'), 'utf8')
    expect(t).toContain('"@/*": ["src/*"]')
    expect(t).not.toContain('@app/*')
  })

  /**
   * vite 的样式配置**必须是 `.mts`**，不能是 `.ts`。
   *
   * ## 报过的错
   *
   * ```
   * The CJS build of Vite's Node API is deprecated.
   * failed to load config from vite.css.config.ts
   * ERR_REQUIRE_ESM: require() of ES Module
   *   node_modules/@tailwindcss/vite/dist/index.mjs not supported
   * ```
   *
   * ## 机制
   *
   * Vite 对 `.ts` 配置的做法是「**先用 esbuild 打包成 CJS，再 require 加载**」。
   * 而 `@tailwindcss/vite` 是**纯 ESM** 包（只有 `.mjs`）——
   * CJS 里 `require()` 一个 ESM，Node 直接抛 `ERR_REQUIRE_ESM`。
   *
   * `.mts` = ESM Module TypeScript，Vite 见到它会**直接用原生 ESM 加载**，
   * 不走「打包成 CJS」那条路，`import`也就合法了。
   *
   * ## 为什么要有这条断言
   *
   * 这个 bug 的特点是**改文件名就好了，代码一个字没动** ——
   * 没有任何代码层面的线索指向「文件名决定模块加载方式」。
   * 有人（包括我）把它改回 `.ts`，会得到一个「配置看起来完全正常」的仓库
   * 和一条谁都看不懂的报错。
   */
  it('样式配置是 .mts（.ts 会让纯 ESM 的 @tailwindcss/vite 加载失败）', () => {
    const pkg = JSON.parse(readFileSync(join(here, 'package.json'), 'utf8'))
    const cfg = pkg.scripts['build:css'] ?? ''
    const dev = pkg.scripts['dev:css'] ?? ''
    expect(cfg).toContain('vite.css.config.mts')
    expect(dev).toContain('vite.css.config.mts')
    // 文件确实存在（改名的漏一半是最容易发生的）
    expect(existsSync(join(here, 'vite.css.config.mts'))).toBe(true)
    // **旧的 .ts 不能再存在** —— 留着会让下一个人以为是备选方案
    expect(existsSync(join(here, 'vite.css.config.ts'))).toBe(false)
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
    expect(stripComments(read('vite.css.config.mts'))).not.toContain("path.join(here, '..')")
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

    /* 数花括号深度需要配平的前置条件。**这里的「剥注释」用的是
       完整块注释剥离**（`stripCssComments`），不是行过滤 ——
       跨行块注释里夹着真实的声明（说明文字后面紧跟 `appearance: none;`），
       行过滤只滤「整行是注释」的行，那些声明会以裸行残留，
       花括号就配不平了。
       「块注释剥离会不会误伤 glob」那个坑只影响 `@source` 的**路径文本**，
       而深度分析只关心花括号，两者互不干扰。 */
    const code = stripCssComments(css)
    expect(cssBracesAreBalanced(code)).toBe(true)

    /* 用**剥注释后**的代码定位 —— 注释里提到的那个 `.cl-cal button`
       已经被剥掉了，剩下的就是规则本身。
       （早先在原文里 indexOf，抓到的是注释中间那处，切片里一条声明都没有。）*/
    const i = code.search(/(?:^|\n)[ \t]*\.cl-cal button\s*\{/)
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

  /**
   * 这组断言的**陷阱**：段里有 `appearance: none` **两处** ——
   * 一处是标准属性，一处是 `-webkit-appearance: none`（Safari 旧版要）。
   * `toContain('appearance: none')` 删掉一处仍匹配另一处 ——
   * **变异测试抓到过这个假绿。**
   *
   * 做法：去掉前缀后，每条声明的**出现次数**要符合预期。
   * `appearance: none` 恰好 2 次（一标准 + 一前缀），其余各 1 次。
   * 变异删掉任一条，次数都会变 —— 抓得到。
   */
  it('清掉了主题给 button 的默认外观（按出现次数算，前缀变体已归并）', () => {
    const rule = cssRule(read('src/index.css'), '.cl-cal button')

    /* 提取「属性: 值」形式的声明 —— **正则里不要带分号**。
       带上的话提取结果全是 `appearance: none;`，而下面的 count 比的是
       `appearance: none`（无分号），恒为 0。
       **这个假绿我自己造了两轮**：先写成带分号的提取 + 不带分号的期望，
       报错是「expected +0 to be 2」，看起来像「声明被删了」，
       实际是**两边格式不一致**。

       前缀要去掉，这样「删了标准那条」和「删了前缀那条」都会让次数变化。 */
    const decls = (rule.match(/^[ \t]*(?:-webkit-|-moz-|-ms-)?[a-z-]+:\s*[^;]+/gm) ?? []).map((s) =>
      s.trim().replace(/^-(?:webkit|moz|ms)-/, ''),
    )
    const count = (decl: string) => decls.filter((d) => d === decl).length

    // 先确认提取本身有效 —— 否则 count 全是 0，报错会指向错误的根因
    expect(decls.length).toBeGreaterThan(5)
    expect(decls[0]).not.toMatch(/;$/) // 防回归：提取结果不该带分号

    // 标准 + -webkit- 两条都在，缺一条 Safari 旧版就会露出来
    expect(count('appearance: none')).toBe(2)

    // 这几项是「灰底方块」的来源，少一个就会露出来
    expect(count('background: transparent')).toBe(1)
    expect(count('border: 0')).toBe(1)
    expect(count('box-shadow: none')).toBe(1)

    /* padding 是「7 列对不齐」的直接原因：
       aspect-ratio 算 content-box，主题给的 padding 把它撑成不等宽。 */
    expect(count('padding: 0')).toBe(1)
    expect(count('min-width: 0')).toBe(1)
    expect(count('min-height: 0')).toBe(1)
  })

  /**
   * 上一条按「去前缀后计数」判断，这里单独数**带前缀的原文行数** ——
   * 上一条把前缀归并掉之后，就区分不出「删了标准那条」还是「删了前缀那条」了。
   * 两条配合才能把两种变异都抓住。
   */
  it('appearance 同时写了标准属性和 -webkit- 前缀（Safari 旧版要）', () => {
    const rule = cssRule(read('src/index.css'), '.cl-cal button')
    // 标准那条：行首就是 appearance，前面没有 -
    expect(rule).toMatch(/^[ \t]*appearance:\s*none;/m)
    // 前缀那条：明确写出 -webkit-
    expect(rule).toMatch(/^[ \t]*-webkit-appearance:\s*none;/m)
  })

  it('日期格用具名 class 而不是长串工具类', () => {
    const cal = readFileSync(join(here, 'src', 'components', 'Calendar.tsx'), 'utf8')
    expect(cal).toContain('cl-day')
    expect(cal).toContain('cl-nav')
    expect(cal).toContain('cl-dot')

    /* 旧的工具类写法不该还在。
       **必须先剥注释** —— 组件里有段注释正是在解释「为什么不能用
       aspect-square」（宿主主题会压掉工具类）。不剥的话全文扫必误报。

       也不能按行扫 `className=`：日期格的 className 是**多行模板字符串**，
       工具类写在续行里，按行扫会漏掉 —— 变异测试抓到过这个假绿。 */
    const code = stripComments(cal)
    for (const banned of ['aspect-square', 'bg-ink text-white', 'hover:bg-soft']) {
      expect(code).not.toContain(banned)
    }

    /* 反向锁住：具名 class 必须真的用在了 className 里。
       只断「日历类名在文件里出现过」不够 —— 它可能只在注释里。 */
    const clsNames = [...code.matchAll(/className=\{?[`"]([^`"{}]*)/g)].map((m) => m[1] ?? '')
    const all = clsNames.join(' ')
    expect(all).toContain('cl-day')
    expect(all).toContain('cl-nav')
    expect(all).toContain('cl-dot')
  })

  it('cur 是实心玫红块 —— 用户最直观的对错信号', () => {
    const css = read('src/index.css')
    const i = css.indexOf('.cl-day.cur {')
    expect(i).toBeGreaterThan(-1)
    const seg = css.slice(i, i + 120)
    expect(seg).toContain('background: var(--color-ink)')
  })

  /**
   * **视觉规范必须整段都在，不能只搬一部分。**
   *
   * 抽离独立仓库时，我把 CSS 头部手工重拼了一遍，
   * 结果 `@layer base` 里的 `.ruled` / `.blk` / `:focus-visible`
   * 和整个 `@layer components`（日历的 6 个类名）**全部丢失**。
   *
   * 表现是构建通过、测试全绿、产物 27 KB 看着正常 ——
   * **只有一个信号：产物里没有 `repeating-linear-gradient`**，
   * 而那正是 `verify-build.mjs` 最后一项报红的。
   *
   * 所以这条断言直接列出**必须存在的选择器清单**。
   * 少了任何一个都会红 —— 这类「搬代码时丢整段」的回归
   * 靠逐个断言视觉属性是抓不全的。
   */
  it('视觉规范的选择器一个都不能少', () => {
    const css = stripCssCommentLines(read('src/index.css'))
    const REQUIRED = [
      // 横格底 —— 工字格的灵魂
      '.ruled',
      // 拖动手型
      '.blk',
      // 键盘焦点可见性（可访问性底线）
      ':focus-visible',
      // 日历：箭头 / 日期格 / 有任务的日子的小点 + 5 个状态修饰
      '.cl-nav',
      '.cl-day',
      '.cl-day:hover',
      '.cl-day.has',
      '.cl-day.empty',
      '.cl-day.today',
      '.cl-day.cur',
      '.cl-dot',
      // 插件挂载点
      '.cl-root',
    ]
    const missing = REQUIRED.filter((sel) => !css.includes(sel))
    expect(missing).toEqual([])
  })

  it('横格线用的是 repeating-linear-gradient（不是纯色边框）', () => {
    const css = read('src/index.css')
    const i = css.indexOf('.ruled {')
    expect(i).toBeGreaterThan(-1)
    const seg = css.slice(i, css.indexOf('}', i))
    expect(seg).toContain('repeating-linear-gradient')
    /* 间距必须跟着 --spacing-row 走。硬编码 px 的话，
       ROWH 一改这里就错位，而且不会有任何报错。*/
    expect(seg).toContain('var(--spacing-row)')
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
    const code = stripComments(readFileSync(join(here, 'src', 'config', 'SettingsTab.ts'), 'utf8'))
    expect(code).toContain('reopenView')
    expect(code).toContain('flushNow()')
    /* 顺序不能反：先 flush 再重开。反了的话待写的数据会被写进旧目录，
       而迁移已经跑完了，没人再搬它 —— 那一天就静默留在旧目录里。 */
    expect(code.indexOf('flushNow()')).toBeLessThan(code.indexOf('reopenView()'))
  })

  /**
   * 迁移的三个顺序约束。反一个都是静默的数据问题，不是报错。
   *
   * 1. **flush 在迁移之前** —— 待写的数据要先落到旧位置，否则永远没人搬它
   * 2. **迁移用旧配置、探测用新配置** —— 前者要扫旧目录，后者要扫新目录
   * 3. **保存配置在迁移之后** —— 反过来的话「目标被占」时界面已经指向新目录，
   *    但文件没搬过去，看起来就是数据全没了
   */
  it('迁移的顺序：flush → 探测 → 迁移 → 存配置 → 重开', () => {
    const src = readFileSync(join(here, 'src', 'config', 'SettingsTab.ts'), 'utf8')
    const code = stripComments(src)
    /* **只看 apply 方法里 reloadData 分支之后的那一段。**
       两个坑叠在一起：
       1. `commitLocation` 里还有一次 saveSettings（校验不过时的提前返回），
          全文 indexOf 会抓到它
       2. `apply` 内部 `if (!reloadData)` 分支也有一次 saveSettings ——
          那是「改启动时打开」用的，不涉及迁移，天然排在 migrateTo 之前

       所以：从 `migrateTo` 的位置开始找 saveSettings，才是「迁移那次保存」。*/
    const start = code.indexOf('private async apply(')
    expect(start).toBeGreaterThan(-1)
    const seg = code.slice(start, code.indexOf('\n  private ', start + 10))

    const at = (s: string, from = 0) => {
      const i = seg.indexOf(s, from)
      expect(i, `apply 里找不到 ${s}`).toBeGreaterThan(-1)
      return i
    }

    const flush = at('flushNow()')
    const probe = at('hasAnyFile')
    const migrate = at('migrateTo')
    // 迁移那次的保存：从 migrateTo 往后找
    const save = at('saveSettings', migrate)
    const reopen = at('reopenView')

    expect(flush).toBeLessThan(probe)
    expect(probe).toBeLessThan(migrate)
    expect(migrate).toBeLessThan(save)
    expect(save).toBeLessThan(reopen)
  })

  it('迁移用的 store 用旧配置，探测用的用新配置', () => {
    const code = stripComments(readFileSync(join(here, 'src', 'config', 'SettingsTab.ts'), 'utf8'))
    // 探测目标目录 → 新配置
    expect(code).toMatch(/new VaultStore\(this\.app,\s*next\)/)
    // 扫旧目录做迁移 → 旧配置
    expect(code).toMatch(/new VaultStore\(this\.app,\s*prev\)/)
  })

  it('全部搬失败时不落盘（否则界面指向空目录，看着像数据没了）', () => {
    const src = readFileSync(join(here, 'src', 'config', 'SettingsTab.ts'), 'utf8')
    const guard = src.indexOf('allFailed')
    expect(guard).toBeGreaterThan(-1)
    /* 守门必须在 saveSettings 之前 —— 之后就是「已经指向新目录但没搬过去」 */
    expect(guard).toBeLessThan(src.indexOf('saveSettings', guard))
    expect(src).toMatch(/allFailed[\s\S]{0,400}return/)
  })

  it('跳过的和失败的文件要点名（只报「已移动 3 个」等于没报）', () => {
    const src = readFileSync(join(here, 'src', 'config', 'SettingsTab.ts'), 'utf8')
    const report = src.indexOf('private report(')
    expect(report).toBeGreaterThan(-1)
    const seg = src.slice(report, report + 1400)
    expect(seg).toContain('outcome.skipped')
    expect(seg).toContain('outcome.failed')
    expect(seg).toContain('fromPath')
  })

  it('空目录不自动删（那是用户自己建的）', () => {
    const code = stripComments(readFileSync(join(here, 'src', 'md', 'vault.ts'), 'utf8'))
    /* 只判断空不空、告诉用户可以删 —— 不调 vault.delete / trash */
    expect(code).toContain('isFolderEmpty')
    expect(code).not.toMatch(/isFolderEmpty[\s\S]{0,300}vault\.delete|vault\.trash/)
  })

  /**
   * description 会被社区目录的 bot 校验，规则比看起来严：
   * 不能含 "Obsidian"/"This plugin"、**必须以 `.` `?` `!` 或 `)` 结尾**、≤250 字符。
   * 中文句号「。」不在允许列表里，会被判成「描述没写完」直接打回。
   * 所以文案里保留书名号没问题，结尾那个英文句点是硬要求。
   * 完整规则由 scripts/verify-build.mjs 断言，那边才是第一道门。
   */
  /**
   * description 的**收尾标点**规则。
   *
   * 只断言「bot 认的四个标点之一」这一条机器规则，
   * **不断言具体文案** —— 文案会随语言、随措辞迭代，
   * 把中文关键词写死在这里，换个语言就会失败（2026-10-11 改英文时就撞上了）。
   *
   * 文案相关的断言在文件末尾「社区目录的多语言呈现」那一组里，
   * 那组守的是「该有哪几项信息」，而不是「必须出现哪几个字」。
   */
  it('manifest 的 description 以 bot 认的英文标点收尾', () => {
    const m = JSON.parse(readFileSync(join(here, 'manifest.json'), 'utf8'))
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

/**
 * 迁移确认弹框 —— **存在性与顺序**。
 *
 * 「立即写入 vault」「恢复默认路径」两个按钮已删（2026-10-10）。
 * 删按钮不等于解决危险：手动改文本框同样会搬文件，
 * 所以确认挂在 `commitLocation`（提交层）而不是某个入口上。
 */
describe('迁移确认（破坏性操作）', () => {
  const code = () => stripComments(readFileSync(join(here, 'src', 'config', 'SettingsTab.ts'), 'utf8'))

  it('两个按钮已删（一个与命令面板重复且会撒谎，一个语义是撤销行为是搬文件）', () => {
    const c = code()
    expect(c).not.toContain('恢复默认路径')
    /* 「立即写入 vault」在命令面板里还有一条，所以这里只查设置面板 */
    expect(c).not.toContain("setButtonText('立即写入 vault')")
    // 「维护」这一节整个没了
    expect(c).not.toContain("setName('维护')")
  })

  it('命令面板仍保留「立即写入 vault」（功能没删，只换了入口）', () => {
    const src = readFileSync(join(here, 'src', 'main.tsx'), 'utf8')
    expect(src).toContain('立即写入 vault')
  })

  it('确认挂在提交层（commitLocation），不是挂在某个入口', () => {
    const c = code()
    const i = c.indexOf('private async commitLocation(')
    expect(i).toBeGreaterThan(-1)
    /* 确认必须在 apply 之前 —— 之后文件已经搬完了 */
    const seg = c.slice(i, c.indexOf('\n  private ', i + 10))
    expect(seg).toContain('confirmMigration')
    expect(seg.indexOf('confirmMigration')).toBeLessThan(seg.indexOf('this.apply('))
  })

  it('用户取消时输入框要还原（不留下没生效的字）', () => {
    const c = code()
    const i = c.indexOf('private async commitLocation(')
    const seg = c.slice(i, c.indexOf('\n  private ', i + 10))
    expect(seg).toMatch(/if \(!\(await this\.confirmMigration\(next\)\)\)/)
    // 取消分支里要有 display() 把输入框刷回实际生效的值
    expect(seg.slice(seg.indexOf('confirmMigration'))).toContain('this.display()')
  })
})

/**
 * ConfirmModal 的答复顺序。
 *
 * **这个 bug 的形态最坏：点「确定」等于点「取消」，而界面上看不出任何异常** ——
 * 设置没变、没报错、Notice 也没弹。用户只会觉得「这插件有毛病」。
 */
describe('确认弹框的答复顺序', () => {
  const modal = () =>
    stripComments(readFileSync(join(here, 'src', 'config', 'ConfirmModal.ts'), 'utf8'))

  it('settle 必须在 close 之前（否则 close → onClose 会先答复 false）', () => {
    const m = modal()
    const i = m.indexOf('setButtonText(this.summary.cta)')
    expect(i).toBeGreaterThan(-1)
    const seg = m.slice(i, i + 200)
    expect(seg).toContain('settle(true)')
    expect(seg.indexOf('settle(true)')).toBeLessThan(seg.indexOf('this.close()'))
  })

  it('有 settled 标记（close 和 onClose 会两次调答复）', () => {
    const m = modal()
    expect(m).toContain('settled')
    expect(m).toMatch(/if \(this\.settled\) return/)
  })

  it('Esc / 点外面关闭也要答复（否则 Promise 永远挂着）', () => {
    const m = modal()
    expect(m).toMatch(/onClose\(\)[\s\S]{0,300}settle\(false\)/)
  })

  /* 警告行的样式**必须走 CSS class，不能是内联 style**。
     社区目录的自动审核有一条 `no-static-styles-assignment`（**Error 级别，
     不过审**）专门拦 `li.style.color = ...`。
     而且内联样式优先级高于任何 class —— 用户换主题时压不掉，
     class 跟着 CSS 变量走能自动适配。

     断言拆成两半：
     1. TS 侧用 addClass（不碰 style 属性）
     2. CSS 侧那条 class 规则存在，且用变量而非写死颜色值
     只查一边的话，另一边被改坏也发现不了。 */
  it('警告行（⚠）用 CSS class 标红，不写内联 style', () => {
    const m = modal()
    expect(m, '警告行应该加 cl-warn-line class').toContain("addClass('cl-warn-line')")
    /* 内联样式赋值是审核的Error 项，明确断掉。
       注意只查 `li` 这种元素上的 style 赋值 ——
       `el.style` 作为 CSS 变量定义出现是另一回事（那是 styles.css 里的事）。 */
    expect(m, '不该有 li.style.xxx = 这样的内联样式赋值').not.toMatch(/\.style\.\w+\s*=/)
  })

  it('.cl-warn-line 的颜色用 CSS 变量（跟着用户主题走，不写死）', () => {
    const css = read('src/index.css')
    const rule = cssRule(css, '.cl-warn-line')
    expect(rule, 'CSS 里没有 .cl-warn-line 规则').toContain('var(--text-error)')
    /* 写死颜色值会压不掉用户的主题配色 */
    expect(rule, '不该写死颜色，应该用 var(--text-error)').not.toMatch(/#[0-9a-f]{3,6}\b/i)
  })
})

/* ==================================================================
 * styles.css 的作用域隔离
 * ==================================================================
 *
 * ## 这组在防什么
 *
 * **styles.css 是整个 vault 全局加载的** —— 用户的日记、主题、
 * 别的插件全都吃这份 CSS。所以插件里任何裸的全局选择器都会溢出到
 * 别人的界面上，而且**它是静默的**：插件不报错、功能不坏，
 * 只是用户觉得「装了之后界面变了」。
 *
 * 两条真实的翻车记录：
 * - `prefers-reduced-motion` 里写的是裸 `*` → 用户给整个 Obsidian 设了
 *   「减少动效」之后，装了这个插件，**所有界面**（包括别的插件）的动效
 *   都被压到 0.01ms。
 * - 裸 `:focus-visible` → 键盘 Tab 一下，vault 里所有可聚焦元素都套玫红描边。
 *
 * 社区目录的 reviewer 会盯这一类注入全局样式的行为。
 *
 * ## 为什么源侧和产物侧都要断言
 *
 * - **这里（源码）**：抓「有人把 `.cl-root` 前缀删了」
 * - `scripts/verify-build.mjs`（产物）：抓「Tailwind 在构建时把前缀剥掉了」
 *
 * 后者真实发生过：先把 `.cl-root :focus-visible` 写对了，但**留在
 * `@layer base` 里** —— Tailwind v4 处理 layer 时会重写选择器，
 * 产物里前缀没了，又变回裸的。源码看着对，用户那边照样受影响。
 *
 * 与「日历隔离层必须在 @layer 外」是同一个病：**隔离层放进 layer 等于没写。**
 */
describe('全局样式不污染用户 vault', () => {
  const css = () => stripComments(read('src/index.css'))

  it('prefers-reduced-motion 限定在 .cl-root 内', () => {
    const c = css()

    /* 限定版必须存在 */
    expect(c).toMatch(/\.cl-root\s+\*/)

    /* 裸版必须不存在 —— `}` / `;` 之后紧跟 `*` 就是裸规则的第一条选择器。
       不能简单扫 `* {`：`background-image` 里那些合法用法会被误报。 */
    const bare = c.match(/(^|[;}])\s*\*\s*(,\s*\*::(before|after)\s*)?\{/g)
    expect(bare ?? []).toHaveLength(0)
  })

  it('focus-visible 限定在 .cl-root 内', () => {
    const c = css()

    expect(c).toMatch(/\.cl-root\s+:focus-visible\s*\{/)

    /* Tailwind 转义类名（.focus-visible\\:opacity-100:focus-visible）
       前面是 `.` 而不是 `}`，形状对不上，不会误报。 */
    const bare = c.match(/(^|[;}])\s*:focus-visible\s*\{/g)
    expect(bare ?? []).toHaveLength(0)
  })

  /* 这两条是「只加前缀还不够」的守门人。
     见上面注释里的真实事故：前缀写对了但留在 @layer base 里，
     Tailwind 构建时把它剥掉 —— 源侧断言全绿，用户那边照样被污染。

     **必须剥掉注释再判断位置** —— 规则上面的注释里会写
     「layer 内会被剥掉」这类说明，字面量里有 `@layer`，
     直接在原文里找位置会被注释里的字样带偏。
     （这正是本文件 stripComments 的存在理由：断言「某东西不该出现」
     时，全文扫必然被解释它的注释误报。）*/
  it('focus-visible 的作用域规则留在 @layer 之外（layer 内会被 Tailwind 剥掉前缀）', () => {
    expectOutsideLayer('.cl-root :focus-visible')
  })

  it('prefers-reduced-motion 也在 @layer 之外（同样会被 Tailwind 剥掉）', () => {
    expectOutsideLayer('prefers-reduced-motion')
  })

  /**
   * 断言某条规则不在任何 `@layer ... {` 块内部。
   *
   * 判据：从文件开头到该规则位置，**最后一个动作**是 `}`（关掉某个块）
   * 而不是 `@layer`（开一个新层）。剥过注释，不会被注释里的字样带偏。
   *
   * @param needle 规则里那段唯一的标记
   */
  function expectOutsideLayer(needle: string) {
    const c = stripComments(read('src/index.css'))
    const start = c.indexOf(needle)
    expect(start).toBeGreaterThan(-1)

    const before = c.slice(0, start)
    const lastLayerOpen = before.lastIndexOf('@layer')
    const lastClose = before.lastIndexOf('}')

    /* layer 开得比关得晚 ⇒ 规则在某个 @layer 块内（危险位置） */
    expect(lastClose).toBeGreaterThan(lastLayerOpen)
  }
})

/* ==================================================================
 * 社区目录的多语言呈现
 * ==================================================================
 *
 * ## 这组在防什么
 *
 * 插件详情页（设置 → 第三方插件 → 点插件名）里显示两样东西：
 *
 * 1. **description** —— 来自 `manifest.json`。社区列表和详情页顶部都显示它，
 *    **用户看到的每一个字都在这里**。所以它必须是目标用户读得懂的：
 *    社区目录以国际用户为主，中文描述会让英文用户看不懂这插件做什么。
 *
 * 2. **README** —— **Obsidian 只读 `README.md` 这一个文件**，
 *    渲染在详情页下方。相对链接（如 `./README.zh-cn.md`）会被 Obsidian
 *    重写成 GitHub 仓库地址，所以点「中文」是跳到 GitHub 看中文版文件。
 *    做法参照 Remotely Save 这个已上架插件。
 *
 * ## 为什么这些要断言
 *
 * 两条都是**改一次就永久生效、且不报错**的改动：
 * description 换了语言没有任何测试会红；README 的切换行被误删也不会有人发现
 * —— 直到社区审核之后才发现。
 */
describe('社区目录的多语言呈现', () => {
  const manifest = () => JSON.parse(read('manifest.json'))
  const en = () => read('README.md')
  const zh = () => read('README.zh-cn.md')

  /* ---------- description ---------- */

  it('description 是英文（社区列表面向国际用户）', () => {
    const d = manifest().description as string
    // 中文只应该出现在书名号里（《认知觉醒》），别的地方不该有汉字
    const han = d.match(/[\u4e00-\u9fff]/g) ?? []
    expect(han.length).toBe(0)
  })

  /* 这几条是社区目录的机器校验规则（obsidian-releases 的 bot 检查，
     违规直接打回）。verify-build.mjs 里也有一份，两边都要绿。*/
  it('description 不含 bot 硬性拒绝的词', () => {
    const d = manifest().description as string
    expect(d).not.toMatch(/obsidian/i)
    expect(d).not.toMatch(/this (is a )?plugin/i)
  })

  it('description 以 bot 认的四个标点之一收尾（中文句号会被打回）', () => {
    const d = manifest().description as string
    expect(d).toMatch(/[.?!)]$/)
  })

  it('description 不超过 250 字符', () => {
    const d = manifest().description as string
    expect(d.length).toBeLessThanOrEqual(250)
  })

  /* ---------- README 语言切换 ---------- */

  it('README.md 顶部有语言切换行，且指向中文版', () => {
    /* 必须是**相对路径** —— Obsidian 靠这个把它重写成 GitHub 地址。
       写成完整 GitHub URL 也能跳转，但失去了「仓库移动后链接仍然有效」这个好处。*/
    expect(en()).toMatch(/^English \| \[中文\]\(\.\/README\.zh-cn\.md\)$/m)
  })

  it('中文版存在，且顶部切回英文', () => {
    expect(existsSync(join(here, 'README.zh-cn.md'))).toBe(true)
    expect(zh()).toMatch(/^\[English\]\(\.\/README\.md\) \| 中文$/m)
  })

  /* Obsidian 详情页只读 README.md —— 主文件是中文就等于没做多语言。*/
  it('主 README 是英文（有中文版就够了，主文件必须面向 Obsidian 渲染的那份）', () => {
    const body = en().replace(/^[\s\S]*?\[中文\]\(\.\/README\.zh-cn\.md\)\n/m, '')
    /* 正文里的中文允许存在（书名名、文件名、命令名），
       所以只断言「英文单词量占优」这个粗判据 —— 目的不是精确统计，
       而是抓「整个文件还是中文」这种大方向搞反的情况。*/
    const han = (body.match(/[\u4e00-\u9fff]/g) ?? []).length
    const latin = (body.match(/[A-Za-z]/g) ?? []).length
    expect(latin).toBeGreaterThan(han)
  })

  /* 两份 README 必须各自带上截图 —— 社区列表那张图是从 README 里取的，
     中文版少了截图，中文用户点进 GitHub 就看不到界面了。*/
  it('两份 README 都引用了 screenshot.png', () => {
    expect(en()).toContain('screenshot.png')
    expect(zh()).toContain('screenshot.png')
  })

  it('两份 README 都有安装说明', () => {
    for (const [name, body] of [
      ['README.md', en()],
      ['README.zh-cn.md', zh()],
    ] as const) {
      expect(body, `${name} 缺少安装章节`).toMatch(/^##\s+Install(ation)?|^##\s+安装/m)
      expect(body, `${name} 缺少隐私说明`).toMatch(/^##\s+Privacy|^##\s+隐私/m)
    }
  })
})

/* ==================================================================
 * 依赖声明完整性
 * ==================================================================
 *
 * ## 这组在防什么
 *
 * **「本机跑得过」不等于「别人跑得过」。**
 *
 * 2026-10-11 首次推GitHub，CI 立刻红了：
 *
 * ```
 * Error: Cannot find package 'jsdom' imported from node_modules/vitest/...
 * Test Files  1 failed | 6 passed (7)
 *      Tests  120 passed (120)      ← 一条都没失败
 *        Errors  4 errors
 * ```
 *
 * 原因：`src/config/alias.test.ts` 顶部写着 `@vitest-environment jsdom`，
 * 但 **`jsdom` 从来没在 `package.json` 里声明过**。
 * 它之所以出现在 node_modules 里，是某次 `npm install` 顺手装的
 * —— 恰好装上了，于是本地 215 条用例全绿。
 *
 * 而任何人 clone 下来 `npm ci`，装不到它 → 测试直接崩。
 * **本机是唯一能跑通的环境**，这类bug 最晚在上架那天才暴露。
 *
 * ## 判据怎么设计的
 *
 * 不去逐个「该有哪些依赖」（那要维护一份清单），
 * 而是抓更本质的东西：**测试实际 import 到的包，必须在 package.json 里声明**。
 */
describe('依赖声明完整性', () => {
  it('package.json 声明了测试用到的 jsdom', () => {
    const p = JSON.parse(read('package.json'))
    /* 断言必须显式声明，而不是「在 node_modules 里存在」——
       后者在任何机器上都成立，抓不到「没声明」这个真正的病。*/
    expect(p.devDependencies?.jsdom, 'jsdom 没声明 → 别人 clone 下来跑不了测试').toBeTruthy()
  })

  /**
   * 源码里直接 import 的第三方包，必须在 package.json 里声明。
   *
   * 这条才是真正能抓到 bug 的判据 —— 「被别的包依赖」不等于「你声明了它」：
   * 上游哪天不再依赖它（或者换了实现），你的测试就突然崩了，
   * 而你一行代码都没改。jsdom 正是这种情形。
   */
  it('测试文件 import 的外部包都有声明', () => {
    const p = JSON.parse(read('package.json'))
    const declared = new Set([
      ...Object.keys(p.dependencies ?? {}),
      ...Object.keys(p.devDependencies ?? {}),
    ])

    /* 逐个源码文件扫 import，取包名（scoped 包的「@scope/name」第一段）。
     *
     * **只查测试文件** —— 那是被 CI 直接跑的代码，漏声明会让 CI 立刻红，
     * 正是这次踩的坑。
     *
     * 这段注释里刻意不写「块注释结束符」那三个字符：写进去会**提前闭合**
     * 下面的注释，后面的代码被当代码解析，报一个位置完全对不上的
     * 「Unexpected dot」。踩过一次。 */
    const testFiles = listTestFiles()
    const missing = new Map<string, string>()

    for (const file of testFiles) {
      const code = readFileSync(join(here, file), 'utf8')
      for (const m of code.matchAll(/from\s+'([^']+)'/g)) {
        const spec = m[1]
        // 只看裸包名：'./x' '../x' '@/x' 是本仓库的，跳过
        if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('@/')) continue
        // node: 内置模块
        if (spec.startsWith('node:')) continue
        const name = spec.startsWith('@')
          ? spec.split('/').slice(0, 2).join('/')
          : spec.split('/')[0]
        // 仓库内的 @config/ 之类别名（vite alias），已由 @/ 覆盖
        if (!declared.has(name) && !isNodeBuiltin(name)) {
          missing.set(name, `${missing.get(name) ?? ''} ${file}`.trim())
        }
      }
    }

    expect(
      [...missing.entries()].map(([n, where]) => `${n}（被 ${where} import，但没在 package.json 里声明）`),
      '这些包没在 package.json 里声明 —— 本机 node_modules 里有是巧合，别人 clone 下来会崩',
    ).toHaveLength(0)
  })

  it('package.json 里声明的依赖都真实存在（防手滑写错包名）', () => {
    const p = JSON.parse(read('package.json'))
    const lock = JSON.parse(read('package-lock.json'))
    /* 注意回调参数**不能也叫 `p`** —— 外层的 `p` 是 package.json，
       内层 shadow 掉之后 `p.packages` 会被当成字符串的 .packages，
       TS 报 `Unexpected "."`。
       这类错误的特点是**整个套件加载失败、一条用例都不跑** ——
       摘要里只显示「Tests 162 passed」，看起来像通过。 */
    const lockNames = new Set(
      Object.keys(lock.packages).map((path) => path.replace(/^.*node_modules\//, '')),
    )
    for (const name of Object.keys(p.devDependencies ?? {})) {
      expect(lockNames.has(name), `${name} 在 package.json 里声明了，但 lock 里没有`).toBe(true)
    }
  })
})

/** node 内置模块名单（够用即可，不追求完整） */
function isNodeBuiltin(name: string): boolean {
  return (
    /^(assert|buffer|child_process|crypto|events|fs|http|https|module|os|path|process|stream|string_decoder|timers|url|util|zlib|node:)/.test(
      name,
    )
  )
}

/** 列出所有测试文件（相对仓库根） */
function listTestFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(join(here, dir))) {
      const full = join(dir, name)
      const stat = statSync(join(here, full))
      if (stat.isDirectory()) walk(full)
      else if (/\.test\.(ts|tsx)$/.test(name)) out.push(full.replace(/\\/g, '/'))
    }
  }
  walk('src')
  return out
}

/* ==================================================================
 * Node 版本要求
 * ==================================================================
 *
 * ## 这组在防什么
 *
 * **「本机能跑」不等于「别人能跑」——尤其是换 Node 版本时。**
 *
 * 2026-10-11 首次推 GitHub，CI 连续红了两次：
 *
 * 1. `jsdom` 根本没在 package.json 里声明（本机恰好装上了）
 * 2. 声明之后仍然红：
 *    ```
 *    TypeError: webidl.util.markAsUncloneable is not a function
 *    ```
 *    jsdom 30 的 `engines` 是 `^22.22.2 || ^24.15.0 || >=26`，
 *    而 CI 配的是 Node 20。**本机是 22.22.2，一切正常。**
 *
 * 第二条尤其值得记：依赖的 `engines` 是一道**本机满足得了、
 * 换台机器/换个 CI 镜像就满足不了**的隐形门槛。
 * 它不会在开发时提示你，只在别人 clone 之后炸。 */

describe('Node 版本要求', () => {
  const p = () => JSON.parse(read('package.json'))

  it('package.json 声明了 node >= 22.22（jsdom 30 的硬要求）', () => {
    expect(
      p().engines?.node,
      '没有 engines.node → 别人用 Node 20 装完才发现跑不起来，报错还指向 jsdom 内部',
    ).toBeTruthy()
    expect(p().engines.node).toMatch(/>=\s*22/)
  })

  it('CI 与 release 的 node 版本一致（否则会出现「CI 绿的、Release 红的」）', () => {
    const ci = read('.github/workflows/ci.yml')
    const rel = read('.github/workflows/release.yml')
    const grab = (s: string) => s.match(/node-version:\s*(\S+)/)?.[1]
    expect(grab(ci), 'ci.yml 没配 node-version').toBeTruthy()
    expect(grab(rel), 'release.yml 没配 node-version').toBeTruthy()
    /* 两边不一致时，两边都不会说明原因 —— 只有某一次发版失败才会发现。 */
    expect(grab(ci), 'ci.yml 与 release.yml 的 node-version 不一致').toBe(grab(rel))
  })

  /* CI 配的版本必须**满足** package.json 声明的下限，
     否则等于「声明了要求但自己违反」。 */
  it('CI 的 node 版本满足 engines 下限', () => {
    const ci = read('.github/workflows/ci.yml')
    const ver = ci.match(/node-version:\s*(\d+)/)?.[1]
    const min = p().engines.node.match(/>=\s*(\d+)/)?.[1]
    expect(ver, 'ci.yml 的 node-version 不是数字').toBeTruthy()
    expect(
      Number(ver),
      `ci.yml 用Node ${ver}，但 package.json 要求 >= ${min}（jsdom 30 会报markAsUncloneable）`,
    ).toBeGreaterThanOrEqual(Number(min))
  })

  /* 两份 workflow 用的 action 版本要一致。
     不一致的后果同样是「CI 绿的、Release 红的」，而且更难察觉 ——
     因为 CI 只跑 CI 那份，release.yml 的问题要等真发版才暴露。 */
  it('CI 与 release 用的 action 版本一致', () => {
    const ci = read('.github/workflows/ci.yml')
    const rel = read('.github/workflows/release.yml')
    for (const act of ['actions/checkout', 'actions/setup-node']) {
      const a = ci.match(new RegExp(`${act}@(v\\d+)`))?.[1]
      const b = rel.match(new RegExp(`${act}@(v\\d+)`))?.[1]
      expect(a, `ci.yml 里找不到 ${act}`).toBeTruthy()
      expect(b, `release.yml 里找不到 ${act}`).toBeTruthy()
      expect(a, `${act} 版本不一致：ci=${a} release=${b}`).toBe(b)
    }
  })
})

/* ==================================================================
 * lock 文件的跨平台完整性
 * ==================================================================
 *
 * ## 这组在防什么
 *
 * **「本机绿的、CI 红的」里最难查的一种：平台二进制。**
 *
 * 2026-10-11 第三次 CI 失败：
 *
 * ```
 * Error: Cannot find module '../lightningcss.linux-x64-gnu.node'
 * ```
 *
 * 原因：`lightningcss` 声明了 11 个平台的 optionalDependencies，
 * 但 lock 里**只收录了 Windows 那一个**
 * （`lightningcss-win32-x64-msvc`）。
 *
 * 于是：
 * - **本机**（Windows）：`npm ci` 装到本机平台那份，一切正常
 * - **CI**（Ubuntu）：lock 里没有 linux-x64-gnu 那条 → 装不到 →
 *   vite 打 CSS 时报「找不到模块」
 *
 * 也就是说 **lock 缺平台条目这件事，在开发机上完全不可见**。
 * 只有当有人换操作系统、或者 CI 换镜像时才暴露 ——
 * 而那通常是「上架前最后一天」。
 *
 * ## 判据
 *
 * 声明了平台二进制的包，lock 里必须**每个平台都有条目**。
 * 不比较「装了几个」，只比较「该有几个、有几个」。
 */
describe('lock 的跨平台完整性', () => {
  const lock = () => JSON.parse(read('package-lock.json'))

  /* 只认这些前缀：它们是**按平台分发二进制**的包。
     普通的可选功能依赖（fsevents 只在 mac 上）不在此列 ——
     那些是故意不给某些平台装的，加进 lock 反而会让 npm ci 失败。*/
  const PLATFORM_PKG =
    /^(?:@(?:esbuild|rollup)\/rollup-|@esbuild\/|lightningcss-|esbuild-|rollup-|@tailwindcss\/oxide-)/

  it('声明了平台二进制的包，lock 里每个平台都有条目', () => {
    const l = lock()
    const missing: string[] = []

    for (const [path, entry] of Object.entries<Record<string, unknown>>(l.packages)) {
      const opts = entry?.optionalDependencies as Record<string, string> | undefined
      if (!opts) continue
      const parent = path.replace(/^.*node_modules\//, '')
      for (const [name, ver] of Object.entries(opts)) {
        if (typeof ver !== 'string' || !PLATFORM_PKG.test(name)) continue
        const inLock = l.packages[`node_modules/${name}`] || l.packages[`${path}/node_modules/${name}`]
        if (!inLock) missing.push(`${parent} 声明了 ${name}@${ver}，但 lock 里没有`)
      }
    }

    expect(
      missing,
      'lock 缺平台条目 → 本机（当前平台）正常，别的平台上构建失败。跑 npm run lock:fix 补齐',
    ).toHaveLength(0)
  })

  it('lock 里的每个条目都有 resolved 与 integrity（npm ci 靠它们下载）', () => {
    const l = lock()
    const bad: string[] = []
    for (const [path, entry] of Object.entries<Record<string, unknown>>(l.packages)) {
      if (path === '' || !entry || typeof entry !== 'object') continue
      if ((entry as { link?: boolean }).link) continue
      const e = entry as Record<string, unknown>
      if (!e.version) bad.push(`${path}：没有 version`)
      else if (!e.resolved) bad.push(`${path}@${e.version}：没有 resolved`)
    }
    expect(bad.slice(0, 10), `共${bad.length} 个条目不完整`).toHaveLength(0)
  })

  /* 平台条目必须带 os / cpu —— 靠这两个字段 npm 才知道「本机装不上就跳过」。
     少了它们，npm 会尝试安装所有平台，然后报
     `notsup Valid os: aix / Actual os: win32` 整个安装失败。 */
  it('平台二进制条目带 os / cpu 字段（否则 npm 会尝试安装所有平台）', () => {
    const l = lock()
    const bad: string[] = []
    for (const [path, entry] of Object.entries<Record<string, unknown>>(l.packages)) {
      const name = path.replace(/^.*node_modules\//, '')
      if (!PLATFORM_PKG.test(name)) continue
      const e = entry as Record<string, unknown>
      if (!e?.version) continue
      if (!e.optional) bad.push(`${name}：缺 optional（装不上时会中断整个 npm ci）`)
      // 部分包（如 esbuild）用 cpu/os，部分只标其一
      if (!e.os && !e.cpu) bad.push(`${name}：缺 os 与 cpu`)
    }
    expect(bad.slice(0, 10)).toHaveLength(0)
  })
})

/* ==================================================================
 * owner 一致性
 * ==================================================================
 *
 * ## 这组在防什么
 *
 * **改名/搬家时最容易漏的一类：仓库地址散落在好几个文件里。**
 * 2026-10-11 从 kelon 迁到 kelon0522，涉及 4 个文件 6 处：
 * manifest（社区目录真读的）、README 两个版本、CHANGELOG、LICENSE。
 *
 * 漏一处的后果分两种：
 * - manifest 漏了 → **社区列表点进去作者显示还是旧名**
 * - README 漏了 → 用户点 Releases 404
 *
 * 都不报错、不影响本地开发，只有上架后才看得见。
 */
describe('owner 与仓库地址一致', () => {
  const p = () => JSON.parse(read('manifest.json'))

  it('manifest 的 authorUrl 指向 GitHub 个人主页', () => {
    expect(p().authorUrl, 'authorUrl 缺失或格式不对').toMatch(
      /^https:////github/.com//[A-Za-z0-9-]+$/,
    )
  })

  it('manifest 的 author 与 authorUrl 的用户名一致', () => {
    const user = p().authorUrl.replace('https://github.com/', '')
    expect(p().author, `author（${p().author}）与 authorUrl 里的用户名（${user}）不一致`).toBe(user)
  })

  /** 全仓库扫「旧的 owner」——有残留就说明有文件忘了改。 */
  it('所有文件里的仓库地址与 authorUrl 指向同一个 owner', () => {
    const user = p().authorUrl.replace('https://github.com/', '')
    const repo = 'obsidian-clarity-ledger'

    /* 这些文件会被社区列表、社区审核、用户点链接时读到。 */
    const files = ['README.md', 'README.zh-cn.md', 'CHANGELOG.md', 'manifest.json']

    /* 只看**指向本仓库的**链接：`github.com/<user>/<repo>`。
       README 里还有指向第三方仓库的链接（Hot-Reload 的作者 pjeby、
       Remotely Save 等），那些当然不该等于我们的用户名 ——
       早先没做这个区分，断言把 pjeby 也当成「漏改的旧 owner」，
       误报了一次。判据：用户名后面必须紧跟本仓库名。 */
    const repoRe = new RegExp(`github\\.com/([A-Za-z0-9-]+)/${repo}(?![A-Za-z0-9-])`, 'g')

    for (const f of files) {
      const text = read(f)
      const owners = [...text.matchAll(repoRe)].map((m) => m[1])
      for (const o of new Set(owners)) {
        expect(o, `${f} 里的 github.com/${o}/${repo} 与 authorUrl 的 ${user} 不一致（漏改了？）`).toBe(
          user,
        )
      }
      /* 反向：authorUrl 自己必须指向一个存在的 owner 目录 ——
         至少确认它不是空串或占位符。 */
      if (user) expect(p().authorUrl).toMatch(new RegExp(`^https://github\\.com/${user}/?$`))
    }
  })

  it('LICENSE 的版权署名与 author 一致', () => {
    const lic = read('LICENSE')
    expect(lic, `LICENSE 里没有 ${p().author} 的署名`).toContain(`Copyright (c) 2026 ${p().author}`)
  })
})

/* ==================================================================
 * 社区目录的自动审核规则
 * ==================================================================
 *
 * ## 为什么这组必须存在
 *
 * Obsidian 社区目录的**自动审核**会扫源码和构建产物，
 * 报出的Error 级别问题**直接不过审**，而且**不给重试机会**。
 *
 * 2026-10-11 首次提交就撞上一批。这里固化成断言，
 * 改代码时本地就能发现 —— 不用等提交后被退回来。
 *
 * ## 每条对应的审核规则
 *
 * | 断言 | 对应的审核项 | 级别 |
 * |---|---|---|
 * | 不写内联 style 赋值 | `no-static-styles-assignment` | **Error** |
 * | 设置页标题用 setHeading() | 「统一 UI 风格」 | **Error** |
 * | 产物不含 createElement('script') | Code obfuscation | **Error** |
 * | 计时器带 window. 前缀 | popout 兼容性 | Warning |
 * | 不用 as TFile | `Avoid casting to 'TFile'` | Warning |
 * | 不用 globalThis（node 侧除外） | popout 兼容性 | Warning |
 * | 不用 builtin-modules 包 | 依赖审查 | Warning |
 */
describe('社区目录的自动审核规则', () => {
  /* ---------- Error 1：内联样式 ---------- */

  it('不写内联 style 赋值（审核 Error，不过审）', () => {
    /* 只扫 **TS/TSX 源码**，不扫构建产物 ——
       产物里有 React 内部的代码，扫它会误报。 */
    const offenders: string[] = []
    for (const file of listSourceFiles()) {
      const code = stripComments(readFileSync(join(here, file), 'utf8'))
      for (const [i, line] of code.split('\n').entries()) {
        /* `el.style.color = x` / `el.style.setProperty(...)`。
           注意排除 `styles.css` 里的 CSS 变量定义（那是另一种东西），
           所以只扫 .ts/.tsx。 */
        if (/\.style\s*\.\s*\w+\s*=/.test(line) || /\.style\s*\.\s*setProperty\s*\(/.test(line)) {
          offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 70)}`)
        }
      }
    }
    expect(
      offenders,
      `这些地方直接设了内联样式，改成 CSS class：\n${offenders.join('\n')}`,
    ).toHaveLength(0)
  })

  /* ---------- Error 2：设置页标题 ---------- */

  it('设置页标题用 setHeading() 而不是 createEl("h2")（审核 Error）', () => {
    const code = stripComments(read('src/config/SettingsTab.ts'))
    expect(code, '不该用 createEl("h2")，官方要求 setHeading()').not.toMatch(
      /createEl\(\s*['"]h[1-6]['"]/,
    )
    expect(code, '应该有 setHeading()').toContain('setHeading()')
  })

  /* ---------- Error 3：产物里不能有动态 script ---------- */

  it('构建产物不含 createElement("script")（审核 Error：代码混淆）', () => {
    /* ⚠️ 这条**一定会有命中** —— React 内部预加载资源时会
       `document.createElement('script')`，而 React 是打进产物里的。
       所以判据是「**源码**里没有」，产物里出现不算问题。
       审核器扫的是源码树，能定位到具体文件。

       这也是当初误判的根源：扫产物会把 React 内部代码算到插件头上。*/
    for (const file of listSourceFiles()) {
      const code = readFileSync(join(here, file), 'utf8')
      expect(
        code,
        `${file} 里有 createElement('script') —— 审核会判「动态注入脚本」（Error）`,
      ).not.toMatch(/createElement\(\s*['"]script['"]/)
      expect(code, `${file} 里有 addScriptTag`).not.toMatch(/addScriptTag/)
    }
  })

  /* ---------- Warning：计时器 ---------- */

  it('计时器用 window. 前缀（popout 兼容性）', () => {
    const offenders: string[] = []
    for (const file of listSourceFiles()) {
      const code = stripComments(readFileSync(join(here, file), 'utf8'))
      for (const [i, line] of code.split('\n').entries()) {
        /* 匹配裸调用：前面不是 `.`、不是 `window.`，也不是 `typeof` */
        if (/(?<![\w.])(?<!window\.)(setTimeout|clearTimeout|setInterval|clearInterval)\s*\(/.test(line)) {
          offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 70)}`)
        }
      }
    }
    expect(
      offenders,
      `这些计时器缺 window. 前缀：\n${offenders.join('\n')}`,
    ).toHaveLength(0)
  })

  /* ---------- Warning：as TFile ---------- */

  it('不用 as TFile 强行断言（审核会警告）', () => {
    const code = stripComments(read('src/md/vault.ts'))
    expect(code, 'as TFile 是强行断言，改用 instanceof 或类型守卫').not.toMatch(/\bas\s+TFile\b/)
  })

  /* ---------- Warning：globalThis ---------- */

  it('不直接用 globalThis（popout 兼容性），除了 store 那一处', () => {
    /* `globalThis` 只在 store/index.ts 里为了兼容 node 测试环境。
       别处用会让 popout 窗口的行为不一致。*/
    /* 两个例外，都有理由：
     * - store/index.ts：用它是为了让纯逻辑层在 node 测试环境里也能跑计时器
     * - test-setup.ts：给 node 测试环境补 ResizeObserver 等 stub，不进产物 */
    const allowed = new Set(['src/store/index.ts', 'src/test-setup.ts'])
    for (const file of listSourceFiles()) {
      if (allowed.has(file)) continue
      const code = stripComments(readFileSync(join(here, file), 'utf8'))
      expect(code, `${file} 用了 globalThis，改成 window 或 activeWindow`).not.toMatch(
        /\bglobalThis\b/,
      )
    }
  })

  /* ---------- Warning：builtin-modules ---------- */

  it('不用 builtin-modules 包（审核建议换掉，用 node 内置的）', () => {
    const p = JSON.parse(read('package.json'))
    expect(
      p.devDependencies?.['builtin-modules'] ?? p.dependencies?.['builtin-modules'],
      'builtin-modules 已被 node:module 的 builtinModules 取代',
    ).toBeFalsy()

    /* 构建配置里要用 node 内置的那份 */
    const cfg = read('esbuild.config.mjs')
    expect(cfg, '应该从 node:module 取 builtinModules').toContain('builtinModules')
  })
})

/**
 * 列出所有源码文件（.ts / .tsx / .mjs），相对仓库根、正斜杠分隔。
 *
 * 与 `listTestFiles` 的区别：那个只找 `*.test.ts(x)`，
 * 这个找全部源码 —— 审核规则要扫的是**所有**写代码的地方，
 * 不只是测试文件。
 *
 * 排除 `.test.` 文件本身：断言代码里出现 `createElement('script')`
 * 这样的字符串（我刚才就写了）是正常的，那是判据不是代码。
 */
function listSourceFiles(): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(join(here, dir))) {
      if (name === 'node_modules' || name.startsWith('.')) continue
      const full = join(dir, name)
      const stat = statSync(join(here, full))
      if (stat.isDirectory()) walk(full)
      else if (/\.(ts|tsx|mjs)$/.test(name) && !/\.test\./.test(name)) {
        out.push(full.replace(/\\/g, '/'))
      }
    }
  }
  walk('src')
  // 构建配置也在源码范围里（esbuild.config.mjs / vite.css.config.mts）
  for (const f of ['esbuild.config.mjs', 'vite.css.config.mts']) {
    if (existsSync(join(here, f))) out.push(f)
  }
  return out
}

/* ==================================================================
 * tag 命名（发版必踩的坑）
 * ==================================================================
 *
 * ## 为什么单独一组
 *
 * `npm version patch` 默认打**带 `v` 前缀**的 tag（`v0.1.1`），
 * 而 Obsidian 生态要求**不带 `v`**：
 *
 * - 社区目录按 `manifest.json` 的 version 找同名 tag，匹配不上
 * - `.github/workflows/release.yml` 的触发条件是正则
 *   `[0-9]+.[0-9]+.[0-9]+` —— **不含 `v`**，
 *   带前缀的 tag 推上去**根本不会触发发版**
 *
 * 2026-10-11 实际踩了：跑完 `npm version patch`，
 *紧接着 `git push origin 0.1.1` 就报
 *   error: src refspec 0.1.1 does not match any
 *
 * 修法：加`postversion` 钩子自动改名 ——
 * **让它自动发生，比让人记住更可靠。**
 */
describe('tag 命名', () => {
  /** release.yml 的 tag 触发正则（CRLF-safe） */
  function releaseTagPattern(): string {
    const yml = read('.github/workflows/release.yml')
    /* `\r?\n` 而不是 `\n` —— **这个文件在 Windows 上是 CRLF**。
       只写 `\n` 匹配不上，症状是「提取到 undefined」，
       而报错说的是「没找到 tags 触发条件」，与真实原因隔了很远。
       这个项目在行尾符上栽过好几次。 */
    return yml.match(/tags:\s*\r?\n\s*-\s*'([^']+)'/)?.[1] ?? ''
  }

  it('package.json 配了 postversion 钩子自动去掉 v 前缀', () => {
    const s = JSON.parse(read('package.json')).scripts
    expect(
      s.postversion,
      '没有 postversion 钩子 → npm version 会打 v0.1.1 这种 tag，推上去不触发发版',
    ).toBeTruthy()
    expect(s.postversion).toContain('fix-tag')
  })

  it('仓库里的 tag 都不带 v 前缀', () => {
    /* 断言**真实状态**而不是只看配置 ——
       钩子也可能没跑（脚本中断、手动 git tag、浅克隆）。
       直接扫 .git/refs/tags。*/
    const dir = join(here, '.git', 'refs', 'tags')
    if (!existsSync(dir)) return
    const withV = readdirSync(dir).filter((t) => t.startsWith('v'))
    expect(withV, `这些 tag 带 v 前缀，Obsidian 找不到：${withV.join(', ')}`).toHaveLength(0)
  })

  it('release.yml 的触发条件能匹配真实的 tag', () => {
    const pattern = releaseTagPattern()
    expect(pattern, 'release.yml 没找到 tags 触发条件').toBeTruthy()

    /* **拿真实 tag 去 match**，而不是「看正则里有没有数字」——
       后者只能证明字符串长什么样，证明不了它匹配得上。
       而这正是出问题的地方：`v0.1.1` 不匹配 `[0-9]+...` → 不发版。

       用 `^...$` 完整匹配 —— GitHub Actions 的 glob 也是全匹配，
       部分匹配会放过 `1.0.0-rc1` 这种前缀相同的。*/
    const re = new RegExp('^' + pattern + '$')
    const dir = join(here, '.git', 'refs', 'tags')
    if (!existsSync(dir)) return
    const tags = readdirSync(dir)
    const notMatched = tags.filter((t) => !re.test(t))
    expect(
      notMatched,
      `这些 tag 不触发 release.yml（推上去也不会建 Release）：\n` + notMatched.join('\n'),
    ).toHaveLength(0)
  })

  it('每个已存在的 tag 都在 versions.json 里有对应记录', () => {
    const dir = join(here, '.git', 'refs', 'tags')
    if (!existsSync(dir)) return
    const known = new Set(Object.keys(JSON.parse(read('versions.json'))))
    for (const t of readdirSync(dir)) {
      expect(known.has(t), `tag ${t} 在 versions.json 里没有记录 —— 发版时可能漏了`).toBe(true)
    }
  })

  it('fix-tag 脚本的四种情况都处理了', () => {
    const src = read('scripts/fix-tag.mjs')
    /* 四种：只有对的 / 只有带 v 的 / 两个都在 / 都没有 */
    expect(src, '缺「已就位」的分支').toContain('已就位')
    expect(src, '缺「改名」的分支').toContain('改名为')
    /* 「两个都在」时必须删带 v 的、保留对的 —— 反过来会毁掉能用的版本 */
    expect(src, '缺「重复 tag」的处理').toContain('多余的 tag')
    /* 都没有时要报错，不能静默通过 */
    expect(src, '缺「找不到 tag」的报错').toContain('process.exit(1)')
    /* packed-refs 场景必须报出来 —— 那个情况删文件不起作用 */
    expect(src, '没处理 packed-refs（tag 被 gc 合并进去的情况）').toContain('packed-refs')
  })
})

/* ==================================================================
 * lock 与 package.json 的一致性
 * ==================================================================
 *
 * ## 这组在防什么（今天又踩了一次同一个病的变种）
 *
 * 2026-10-11提交社区目录被拒，理由是
 *   `createElement('script')` — Code obfuscation（Error）
 * 那是 React 19 的「资源提升」功能，官方审核会拦。
 *
 * 查下来发现根因不是「用了 React 19」，而是**版本不一致**：
 *
 * | 位置 | react版本 |
 * |---|---|
 * | `package.json` 声明 | 18.3.1 |
 * | 本机 `node_modules` 实际装 | 18.3.1 |
 * | **`package-lock.json` 锁的** | **19.3.0** |
 * | 产物 `main.js`（CI 构建） | **19.3.0** |
 *
 * 本机跑 `npm install` → 按 package.json 装 18 → 一切正常；
 * CI 跑 `npm ci` → 按 lock 装 19 → 产物里有那 3 处 → 审核报错。
 *
 * **本机是唯一「React 是 18」的环境**，和今天早上那四道 CI 门槛
 * 是同一个病：**本机正常 ≠ CI 正常**。
 *
 * 所以判据不是「package.json 写了什么」，而是
 * **「lock 里锁的版本是否满足 package.json 声明的 range」**。
 */
describe('lock 与 package.json 的一致性', () => {
  const p = () => JSON.parse(read('package.json'))
  const lock = () => JSON.parse(read('package-lock.json'))

  /** 极简 semver 判定：只处理 ^ / ~ / 精确版本这几种写法 */
  function satisfies(version: string, range: string): boolean {
    const v = version.split('.').map(Number)
    const r = range.replace(/^[\^~]/, '')
    const target = r.split('.').map(Number)

    if (!version.startsWith(range.replace(/[\^~].*/, ''))) return false
    if (range.startsWith('^')) {
      // ^x.y.z：主版本相同即可（0.x 的话次版本也要同）
      if (target[0] > 0) return v[0] === target[0]
      if (target[1] > 0) return v[0] === 0 && v[1] === target[1]
      return v[0] === 0 && v[1] === 0 && v[2] === target[2]
    }
    if (range.startsWith('~')) {
      return v[0] === target[0] && v[1] === target[1]
    }
    return version === range
  }

  it('lock 里每个直接依赖的版本都满足 package.json 声明的 range', () => {
    const bad: string[] = []

    /* 显式标 Record<string, string>：`p()` 返回的是 `any`，
       不标注的话 `range` 会被推成 `Record<string,string>`，
       传给 satisfies 时报 TS2345。 */
    const declared: Record<string, string> = {
      ...(p().dependencies as Record<string, string>),
      ...(p().devDependencies as Record<string, string>),
    }

    for (const [name, range] of Object.entries(declared)) {
      const entry = lock().packages[`node_modules/${name}`]
      if (!entry?.version) continue
      if (!satisfies(entry.version, range)) {
        bad.push(
          `${name}：package.json 声明 ${range}，但 lock 锁的是 ${entry.version}\n` +
            `     → 本机 npm install 装前者，CI 的 npm ci 装后者（产物不一样！）`,
        )
      }
    }
    expect(bad, `lock 与 package.json 不一致：\n${bad.join('\n')}`).toHaveLength(0)
  })

  /* React 单独守一条：它是产物里唯一「版本会改变代码行为」的依赖。
     19 → 18 不是「差不多」，而是产物里会少掉 createElement('script')，
     而那正是社区目录会拦的 Error。*/
  it('react / react-dom 必须是 18.x（19 的资源提升会被审核判为代码混淆）', () => {
    const l = lock()
    for (const name of ['react', 'react-dom']) {
      const v = l.packages[`node_modules/${name}`]?.version
      expect(v, `lock 里没有 ${name}`).toBeTruthy()
      expect(
        v,
        `${name} 锁的是 ${v} —— React 19 会在产物里产生 ` +
          `createElement('script')，社区目录审核会判「Code obfuscation」（Error，不过审）。`,
      ).toMatch(/^18\./)
    }
  })

  /* ⚠️ **这里刻意不检查 `main.js`**。
     社区目录审核扫的是构建产物，所以「产物里有没有
     `createElement('script')`」是最直接的判据 ——
     但**这条断言不能放在测试里**：

     CI 的步骤是 `npm ci` → `npm test` → `npm run build`，
     跑测试的时候 `main.js` 是**上一版遗留的**（或压根没有）。
     本机之所以能过，只因为我习惯先 build 再 test ——
     **本机绿 ≠ CI 绿**，正是这个项目今天栽了五次的那类问题。

     产物检查归 `scripts/verify-build.mjs`（它本来就在 build 之后跑）。
     这里只守**输入**：lock 与 package.json 一致、react 是 18。
     输入对了，产物自然对。*/
})
