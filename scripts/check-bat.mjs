/**
 * install.bat 的两条硬约束检查。
 *
 * ## 为什么一个 bat 要单独写个脚本验
 *
 * 因为这两个坑**都极其安静**：
 *
 * 1. **非 ASCII 字符**：`.bat` 按系统 ANSI 代码页（中文机器是 cp936）读。
 *    文件里有一个 UTF-8 的中文字，屏幕上就变成乱码。
 *    症状是「脚本跑出一堆看不懂的东西」，第一反应会以为脚本内容坏了 ——
 *    而内容一个字都没错。
 *    **这个项目真踩过**：注释里明明白白写了「Everything here is
 *    deliberately ASCII」，我后来加了一行「walk through 手测清单.md」，
 *    当场破了这条约定。
 *
 * 2. **行尾必须是 CRLF**：cmd.exe 按 CRLF 切分命令。遇到裸 LF 会把相邻行
 *    **错位拼接**，于是 `REM  Clarity Ledger` 被截成两半、分别当命令跑：
 *    ```
 *    'larity' 不是内部或外部命令
 *    'al' 不是内部或外部命令
 *    ```
 *    这个 bug 最恶劣的地方在于**本机复现不了** ——
 *    `core.autocrlf=true` 时 git 检出会把 LF 转成 CRLF，
 *    所以作者自己跑永远正常，只有 clone 下来的人才炸。
 *
 * 两条都不是「跑一次就知道」的问题，所以固化成本地断言。
 * 用法：node scripts/check-bat.mjs
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = join(root, 'install.bat')

const checks = []
/**
 * 记一条断言。
 *
 * `detail` 传**函数**而不是字符串 —— 这不是风格问题，是正确性问题：
 *
 * 早先 `detail` 是字符串，在调用点就求值。若那段拼接代码自己抛异常
 * （例如对 `Set` 直接调 `.map`），异常发生在 `ok()` **之前**，
 * 整个脚本带着 TypeError 崩掉 —— 而**崩掉的恰恰是那条最该抓乱码的断言**。
 * 现象是「检查脚本报了一行 JS 错误」，人很容易当成「脚本坏了」划走。
 *
 * 传函数则把构造推迟到输出阶段，且下面 `try/catch` 会把它变成
 * 「这条断言本身有 bug」的明确提示，而不是一堆栈。
 */
const ok = (name, pass, detailFn = () => '') => checks.push([name, !!pass, detailFn])

if (!existsSync(FILE)) {
  console.error('找不到 install.bat')
  process.exit(1)
}

const buf = readFileSync(FILE)

/* ---------- 1. 行尾必须是 CRLF ---------- */
let crlf = 0
let bareLf = 0
for (let i = 0; i < buf.length; i++) {
  if (buf[i] === 0x0a) {
    // 前一个字节是 0x0d 才是 CRLF，否则就是裸 LF
    if (i > 0 && buf[i - 1] === 0x0d) crlf++
    else bareLf++
  }
}
ok('install.bat 全部是 CRLF（cmd.exe 的硬要求）', bareLf === 0, () => `CRLF ${crlf} 行，裸 LF ${bareLf} 行`)

/* \r\r\n 是转换时手抖的产物（先normalize 再换行的常见 bug），
   同样会让 cmd 解析出错，顺手查掉。*/
ok(
  '没有 \\r\\r\\n（重复回车）',
  !buf.includes(Buffer.from('\r\r\n', 'binary')),
  () => '转换行尾时手抖的产物',
)

/* ---------- 2. 不得有非 ASCII ---------- */
const nonAscii = new Set()
for (let i = 0; i < buf.length; i++) {
  if (buf[i] > 0x7f) nonAscii.add(buf[i])
}
/* ⚠️ 这里必须先把 Set 转成数组再 `.map()`。
   `[...new Set(x)]` 才能展开；`new Set(x).map()` 不存在 ——
   Set 没有 map 方法，运行时会抛 TypeError。

   而这个 TypeError 出现在**构造 detail 字符串的表达式里** ——
   于是「非 ASCII 检查」这条断言自己先崩了，永远报不出结果。
   等于最该抓的那类问题（乱码）反而抓不到。

   变异测试抓到过这个：一个简单的 `{ ok }` 包装能包住断言，
   却不包得住构造错误消息的代码。**错误消息本身也要测。** */
const nonAsciiHex = [...nonAscii].map((b) => `0x${b.toString(16)}`).join(', ')

ok(
  '没有非 ASCII 字符（中文机器按 cp936 读，会变乱码）',
  nonAscii.size === 0,
  () => (nonAscii.size ? `这些字节处有非 ASCII：${nonAsciiHex}` : ''),
)

/* ---------- 3. 无 BOM ----------
   带 BOM 的 .bat 第一行会变成 `锘?@echo off`，于是 @echo off 失效、
   所有命令都打印一遍。 */
ok('没有 UTF-8 BOM', !(buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf))

/* ---------- 4. 首行必须是 @echo off ---------- */
const text = buf.toString('latin1')
ok('首行是 @echo off（否则每条命令都会打印一遍）', text.startsWith('@echo off'))

/* ---------- 输出 ---------- */
let failed = 0
for (const [name, pass, detailFn] of checks) {
  /* 错误消息本身也可能抛 —— 那说明这条断言写坏了，
     要明确报出来，不能让它变成一片栈让人猜。 */
  let detail = ''
  try {
    detail = detailFn() ?? ''
  } catch (e) {
    detail = `（构造错误消息时抛异常 —— 这条断言本身有 bug：${e.message}）`
    failed++
    console.log(`✗${name}　${detail}`)
    continue
  }
  console.log(`${pass ? '✓' : '✗'}${name}${detail ? `　${detail}` : ''}`)
  if (!pass) failed++
}

if (failed) {
  console.error(`\n${failed} 项未通过`)
  process.exit(1)
}
console.log(`\ninstall.bat 全部通过：${crlf} 行 CRLF，纯 ASCII，无 BOM`)