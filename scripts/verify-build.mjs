/**
 * 产物自检。
 *
 * ## 为什么必须真的 require 一遍
 *
 * 「esbuild 退出码 0」不等于「Obsidian 能加载」。
 * 插件是在 Obsidian 的 Electron 里被 require 的，任何一处引用错了、
 * 循环依赖炸了、CJS 包装坏了，**都要 require 一次才会暴露**。
 *
 * 真实故障：构建「成功」但 main.js 里是空的（入口没接上），
 * Obsidian 里表现为插件不加载、控制台报 undefined —— 极难定位。
 *
 * 这里 stub 掉 obsidian 模块（它的类型声明装了、运行时由 Obsidian 提供），
 * 然后检查导出形态对不对。
 */
import { existsSync, statSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Module from 'node:module'

const here = dirname(fileURLToPath(new URL('.', import.meta.url)))
const require = createRequire(import.meta.url)

const checks = []
const ok = (name, cond, detail = '') => checks.push([name, !!cond, detail])

/* ---------- 上架必需的文件 ---------- */
const MAIN = join(here, 'main.js')
const CSS = join(here, 'styles.css')
const MANIFEST = join(here, 'manifest.json')
const LICENSE = join(here, 'LICENSE')
const README = join(here, 'README.md')
const PKG = join(here, 'package.json')

ok('main.js 存在', existsSync(MAIN), MAIN)
ok('styles.css 存在', existsSync(CSS), CSS)
ok('manifest.json 存在', existsSync(MANIFEST), MANIFEST)

if (existsSync(MANIFEST)) {
  const m = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  /* Obsidian 对 manifest 的校验很严，缺一个字段插件就装不上 */
  for (const f of ['id', 'name', 'version', 'minAppVersion', 'description', 'author']) {
    ok(`manifest 有 ${f}`, !!m[f], String(m[f] ?? ''))
  }
  ok('id 是合法插件 id（只能小写字母数字连字符）', /^[a-z0-9-]+$/.test(m.id ?? ''), m.id)
  ok('version 是 semver', /^\d+\.\d+\.\d+$/.test(m.version ?? ''), m.version)

  /* ---------- 以下是社区目录的机器校验规则 ----------
     这些由 obsidian-releases 的 bot 检查，违规会直接打回，
     提前在本地断言，省得提了 PR 等审核才发现。
     规则来源：https://docs.obsidian.md/Plugins/Releasing/Submission+requirements+for+plugins */
  const id = m.id ?? ''
  const name = m.name ?? ''
  const desc = m.description ?? ''

  ok('id 不含 "obsidian"（bot 硬性拒绝）', !/obsidian/i.test(id), id)
  ok('id 不以 "plugin" 结尾', !/plugin$/.test(id), id)

  ok('name 不含 "Obsidian"', !/obsidian/i.test(name), name)
  ok('name 不以 "Plugin" 结尾', !/plugin$/i.test(name), name)
  /* 这两条针对 "Obsidian"/"Quotidian" 这类词 ——
     以 Obi 开头或 dian 结尾会被当成蹭官方名。*/
  ok('name 不以 "Obi" 开头', !/^obi/i.test(name), name)
  ok('name 不以 "dian" 结尾', !/dian$/i.test(name), name)

  /* **最容易踩的一条**：bot 只认这四个结尾标点。
     中文句号「。」不在列表里，会被判成「描述没写完」。 */
  ok(
    'description 以 . ? ! 或 ) 结尾（中文句号会被打回）',
    /[.?!)]$/.test(desc),
    `当前结尾是 ${JSON.stringify(desc.slice(-1))}`,
  )
  ok('description 不含 "Obsidian"', !/obsidian/i.test(desc))
  ok('description 不含 "This plugin"', !/this (is a )?plugin/i.test(desc))
  ok('description ≤ 250 字符', desc.length <= 250, `${desc.length} 字符`)

ok('LICENSE 文件存在（社区目录硬性要求）', existsSync(LICENSE), LICENSE)
ok('README.md 存在（社区列表会展示）', existsSync(README), README)

  /* install.bat 的两条硬约束。
     为什么在这里查而不在 CI 单独跑：这个脚本已经负责「上架资源齐不齐」，
     而 .bat 的行尾/编码问题**同样会导致上架后用户跑不起来** ——
     只是报错信息完全看不出跟插件有关（是 cmd 的语法错）。

     详细背景见 scripts/check-bat.mjs 的文件头注释。
     `npm run check:bat` 可以单独跑；这里顺手再拦一道，
     免得「本地没跑 check、CI 也没跑」就发出去了。 */
  {
    const batPath = join(here, 'install.bat')
    if (existsSync(batPath)) {
      const bat = readFileSync(batPath)
      let bareLf = 0
      for (let i = 0; i < bat.length; i++) {
        if (bat[i] === 0x0a && !(i > 0 && bat[i - 1] === 0x0d)) bareLf++
      }
      ok(
        'install.bat 是 CRLF（LF 会让 cmd 错位解析，报几十条无意义的错）',
        bareLf === 0,
        bareLf ? `${bareLf} 行是裸 LF` : ''
      )
      let nonAscii = 0
      for (let i = 0; i < bat.length; i++) if (bat[i] > 0x7f) nonAscii++
      ok(
        'install.bat 纯 ASCII（中文机器按 cp936 读，UTF-8 中文会变乱码）',
        nonAscii === 0,
        nonAscii ? `${nonAscii} 个非 ASCII 字节` : ''
      )
    } else {
      ok('install.bat 存在', false, '缺失')
    }
  }

  /* 提交后每次更新都要打同名 tag 的 Release，Obsidian 按version 找 tag。
     **tag 不带 v 前缀** —— 带了就匹配不上，用户装不到更新。 */
  ok(
    'package.json 的 version 与 manifest 一致（防手工改漏一处）',
    (() => {
      try {
        return JSON.parse(readFileSync(PKG, 'utf8')).version === m.version
      } catch {
        return false
      }
    })(),
    `${m.version}`,
  )
}

if (existsSync(MAIN)) {
  /* JSX 必须是 automatic。
     esbuild 默认 `transform` 模式，产物里是 `React.createElement(...)`，
     而组件只 import 了 { useState }，作用域里没有 React ->
     `ReferenceError: React is not defined`。
     真机白屏的第二层原因（第一层是两份 React 实例）。 */
  const raw = readFileSync(MAIN, 'utf8')
  ok('main.js 没有 React.createElement（说明 JSX 走的是 automatic）', !raw.includes('React.createElement'))
  ok('main.js 用了 jsx() 运行时', /\bjsx\(|jsx_runtime|jsxs/.test(raw))

  /* 社区目录审核会扫产物，而这条Error 只有在产物上才看得见：
   *   Code creates script elements at runtime / createElement('script')
   * 那是 **React 19 的「资源提升」**（Resource Hoisting）——
   * react-dom 内部为预加载创建 <script> 标签。
   * 官方论坛有两位开发者栽在同一处（各 3 处），降react 到 18 即解。
   *
   * **源码里一处都没有**，所以只在 `alias.test.ts` 里查源码是查不出来的
   * —— 必须查产物。
   *
   * 而它**不能**放在测试里：CI 是 npm ci → npm test → npm run build，
   * 测试跑的时候 main.js 是上一版遗留的。本机习惯先 build 再 test
   * 所以看不出来 —— 又是一次「本机绿、CI 红」。 */
  const scriptHits = [...raw.matchAll(/createElement\(\s*["']script["']/g)]
  ok(
    '产物里没有 createElement("script")',
    scriptHits.length === 0,
    scriptHits.length
      ? `有 ${scriptHits.length} 处 —— 社区目录会判「Code obfuscation」（Error，不过审）。` +
          `源码里没有的话就是 React 19 的资源提升，把 react 降到 18。`
      : ''
  )

  const kb = Math.round(statSync(MAIN).size / 1024)
  ok('main.js 体积合理（100–800 KB，含 React）', kb > 100 && kb < 800, `${kb} KB`)

  /* 真的 require 一遍 —— 引用错、循环依赖、CJS 包装坏了都会在这里现形 */
  const obsidianStub = {
    Plugin: class {},
    ItemView: class {},
    Notice: class {},
    WorkspaceLeaf: class {},
    PluginSettingTab: class {},
    Modal: class {},
    Setting: class {},
    TFile: class {},
  }
  const origLoad = Module._load
  Module._load = function (req, ...rest) {
    if (req === 'obsidian') return obsidianStub
    return origLoad.call(this, req, ...rest)
  }

  let m = null
  let err = null
  try {
    m = require(MAIN)
  } catch (e) {
    err = e
  } finally {
    Module._load = origLoad
  }

  ok('main.js 能被 require（不抛异常）', !err, err ? String(err.message) : '')

  if (m) {
    const P = m.default
    ok('有 default 导出（Obsidian 靠它实例化插件）', typeof P === 'function', typeof P)
    ok('default 是 Plugin 子类', typeof P === 'function' && P.prototype instanceof obsidianStub.Plugin)
    ok('实现了 onload', typeof P?.prototype?.onload === 'function')
    ok('实现了 onunload', typeof P?.prototype?.onunload === 'function')

    /* 视图类现在是 createLedgerView() 的返回值（闭包注入配置），
       不再是模块级的具名导出 —— 所以这里要**调用工厂**再验。
       验的还是原来那四条：必须是 ItemView 子类、onOpen/onClose/getViewType 都在。
       onClose 缺了会内存泄漏（Obsidian 官方文档明确要求 unmount）。*/
    const factory = m.createLedgerView
    ok('导出了 createLedgerView 工厂（配置靠它注入）', typeof factory === 'function', typeof factory)

    const View = typeof factory === 'function' ? factory(() => ({ folder: 'x', nameTemplate: '{Y}-{M}-{D}' })) : null
    ok('工厂产出的是 ItemView 子类', typeof View === 'function' && View.prototype instanceof obsidianStub.ItemView)
    ok('View 实现了 onOpen', typeof View?.prototype?.onOpen === 'function')
    ok('View 实现了 onClose（不 unmount 会内存泄漏）', typeof View?.prototype?.onClose === 'function')
    ok('View 实现了 getViewType', typeof View?.prototype?.getViewType === 'function')

    ok('导出了 VIEW_TYPE 常量', typeof m.VIEW_TYPE === 'string', m.VIEW_TYPE)

    /* 设置面板必须真的注册上了 —— 少一行addSettingTab
       插件照样能跑，用户只是找不到入口，属静默缺失。*/
    const src = readFileSync(join(here, 'src', 'main.tsx'), 'utf8')
    ok('main.tsx 注册了设置面板', src.includes('addSettingTab'))
    ok('main.tsx 读配置走 withDefaults', src.includes('withDefaults(await this.loadData())'))
  }
}

/* ---------- 重复打包检测（白屏的根因）---------- */
const META = join(here, '.meta.json')

if (existsSync(META)) {
  const meta = JSON.parse(readFileSync(META, 'utf8'))
  const inputs = Object.keys(meta.inputs ?? {})

  /* 查重复打包。
     早先源码分散在两个目录、node_modules 也有两份，
     esbuild 按**路径**去重 → react 被打两份 → hook 找不到 dispatcher →
     `Cannot read properties of null (reading 'useRef')` →
     createRoot 卸载整棵树 → **白屏，且控制台只在 dev 模式报错**。
     @dnd-kit 同理，症状是「拖拽完全不响应」。

     独立仓库后只有一份 node_modules，这个问题的前提消失了，
     但断言留着 —— 万一哪天又引入了第二份依赖，这里会响。*/
  const count = {}
  for (const p of inputs) {
    const seg = p.split('node_modules/').pop()
    if (seg) count[seg] = (count[seg] ?? 0) + 1
  }
  const dups = Object.entries(count).filter(([, n]) => n > 1)
  ok('没有重复打包的模块（重复 = 多份 React 实例 = 白屏）', dups.length === 0, dups.map(([k, n]) => `${k} x${n}`).join(', '))

  const reactMods = inputs.filter((p) => /node_modules[\\/]react(-dom)?[\\/]/.test(p) && !p.includes('@types'))
  ok('react 只打包了一份', reactMods.length > 0 && new Set(reactMods.map((p) => p.includes('react-dom') ? 'dom' : 'core')).size === 2, `${reactMods.length} 个文件`)
} else {
  ok('.meta.json 存在（构建时应产出）', false, '缺这个文件说明构建配置没开 metafile')
}

if (existsSync(CSS)) {
  const css = readFileSync(CSS, 'utf8')
  const kb = Math.round(statSync(CSS).size / 1024)
  /* 阈值 20 KB 不是随便定的。实测踩过的坑：
     Tailwind 的 @source 指向 Vite root 之外的目录会被**静默忽略** ——
     不报错、不警告，产物只剩 9 KB 的变量壳，界面完全没有样式。
     正常产物是 31 KB 左右（含 components 的类名）。
     这个断言就是那个静默失败的守门人。*/
  ok('styles.css 体积合理（> 20 KB，Tailwind 产物）', kb > 20, `${kb} KB`)
  ok('styles.css 含组件类名（扫到了 components 目录）', /\.bg-paper|\.text-ink|\.ruled/.test(css))
  /* 工字格的三样东西：纸面底色、玫红、横格线。缺一样视觉就散了 */
  ok('含纸面底色（--color-paper）', css.includes('--color-paper'))
  ok('含玫红主色（--color-ink）', css.includes('--color-ink'))
  ok('含横格线（.ruled 的 repeating-linear-gradient）', css.includes('repeating-linear-gradient'))
  /* 横格间距必须等于 ROWH(40px)，否则块高和格线错位 —— core/time.ts 里定义的 */
  ok('横格间距 = ROWH 40px', /40px/.test(css) || /--spacing-row:\s*40px/.test(css))
  ok('含手写体字体栈（KaiTi）', /KaiTi|KaiTi|楷体/i.test(css))

  /* ---------- 全局样式污染 ----------
     styles.css 是**整个 vault 全局加载**的：用户的日记、主题、别的插件
     全都吃这份 CSS。所以任何裸的全局选择器都会溢出到别人的界面上。

     这两条曾经真的写成了裸 `*` 和裸 `:focus-visible`：
     - 用户给整个 Obsidian 设了「减少动效」，装了这个插件之后
       **所有界面**（包括别的插件）的动效被压到 0.01ms
     - 键盘 Tab 一下，vault 里所有可聚焦元素都套上玫红描边

     两者都是「插件没做什么坏事，但用户就是觉得装了之后界面变了」，
     而且社区目录的 reviewer 会盯这一类注入全局样式的行为。

     ## 校验方式：断言「限定版存在，且裸版不存在」

     ⚠️ **早先那版是剥掉 `.cl-root ` 前缀再找裸选择器 —— 错的。**
     剥完之后前一条规则的 `}` 会紧贴 `:focus-visible{`，
     于是「上一条规则的收尾 + 我们的选择器」被当成了裸选择器，误报。
     早先更糟的一版把正则写成 `/(^|[;\s]):focus-visible/`，连 Tailwind 的
     转义工具类 `.focus-visible\\:opacity-100:focus-visible` 都没排除掉，
     永远红 —— **断言一直错而没人发现，因为没人跑过它。**

     现在直接查两件事，都不靠剥前缀：
       1. `.cl-root :focus-visible` / `.cl-root *` 必须存在
       2. `:focus-visible{` 前面不能是 `}` / `;`（那才是裸的），
          Tailwind 转义类名前面是 `.focus-visible\\:`，形状对不上。*/
  {
    /* 1) 限定版必须存在 —— 被Tailwind 剥掉作用域就是这条要抓的 */
    ok(
      'focus-visible 有 .cl-root 作用域',
      /\.cl-root\s+:focus-visible\s*\{/.test(css),
      '产物里找不到 .cl-root :focus-visible —— 前缀被剥掉了？'
    )
    ok(
      'prefers-reduced-motion 有 .cl-root 作用域',
      /\.cl-root\s+\*/.test(css),
      '产物里找不到 .cl-root * —— 前缀被剥掉了？'
    )

    /* 2) 裸版必须不存在。
       `}` / `;` 之后紧跟选择器 = 那条规则的第一条选择器是它 = 裸。 */
    ok(
      '没有未限定的裸 :focus-visible',
      !/(^|[;}])\s*:focus-visible\s*\{/.test(css),
      '裸 :focus-visible 会给用户所有可聚焦元素套描边'
    )
    ok(
      '没有未限定的裸 * 规则',
      !/(^|[;}])\s*\*\s*(,\s*\*::(before|after)\s*)?\{/.test(css),
      '裸 * 会影响用户整个 vault 的所有元素'
    )
  }
}

/* ---------- 输出 ---------- */
let failed = 0
for (const [name, pass, detail] of checks) {
  console.log(`${pass ? '✓' : '✗'} ${name}${detail ? `　${detail}` : ''}`)
  if (!pass) failed++
}

if (failed) {
  console.error(`\n${failed} 项未通过`)
  process.exit(1)
}
console.log(`\n全部通过：main.js 可被 Obsidian 加载，样式齐备`)
