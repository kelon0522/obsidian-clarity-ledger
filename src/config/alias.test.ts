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
