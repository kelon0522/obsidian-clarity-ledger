/**
 * 插件设置：存储目录 + 文件名模板。
 *
 * ## 为什么文件名是「模板」而不是普通字符串
 *
 * 数据是**一天一个文件**，所以文件名必须满足两个方向：
 *
 *  1. **正推**：给定日期键 `2026-10-10`，算出文件叫什么
 *  2. **反解**：扫目录时看到 `2026-10-10 星期五.md`，认出它属于哪一天
 *
 * 固定名字（比如永远叫「规划.md」）两条都做不到 —— 一天一个文件就意味着
 * 文件名里必须带日期。所以做成模板，用占位符表达「哪部分是日期」。
 *
 * 语法刻意保持极简（三个 + 一个缩写），因为每个占位符都是一份
 * 「反解时的歧义」：
 *
 *   {Y}  四位年 2026      {YY} 两位年 26
 *   {M}  两位月 10        {D}  两位日 10
 *
 * **刻意不提供**不补零的变体（`{MM}` 那种）。「1 月」和「01 月」
 * 两种文件名会映射到同一天，反解时无法判断该走哪条 —— 宁可少一个功能，
 * 也不要一个静默出错的。
 */

export interface PluginSettings {
  /** 存储目录（vault 内相对路径）。支持多级：`日记/清晰力` */
  folder: string
  /**
   * 文件名模板，不含 `.md`。
   * 默认 `{Y}-{M}-{D}` → `2026-10-10.md`
   */
  nameTemplate: string
  /** 首次打开时是否自动恢复视图 */
  openAtStartup: boolean
}

export const DEFAULT_SETTINGS: PluginSettings = {
  folder: '清晰力',
  nameTemplate: '{Y}-{M}-{D}',
  openAtStartup: false,
}

/* ---------- 模板 → 正则（反解用） ---------- */

/**
 * 每个占位符 → 它的正则形态与语义。
 *
 * **key 就是 token 名**（不是归一化后的字段）—— 早先这里存的是
 * 归一化字段 `Y`，而 token 名有 `Y` 和 `YY` 两种，`find` 按字段找
 * 会拿不到 `{YY}`，直接抛undefined。
 */
const TOKEN_SPEC: Record<string, { re: string; field: 'Y' | 'YY' | 'M' | 'D' }> = {
  Y: { re: '\\d{4}', field: 'Y' },
  YY: { re: '\\d{2}', field: 'YY' },
  M: { re: '\\d{2}', field: 'M' },
  D: { re: '\\d{2}', field: 'D' },
}

const TOKEN_NAMES = ['Y', 'YY', 'M', 'D'] as const

const TOKEN_RE = /\{(YY|Y|M|D)\}/g

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 模板 → 用于匹配**文件名（不含 `.md`）**的正则。
 *
 * 刻意不锚 `\.md$` —— `parseName` 收到的是 `TFile.basename`（Obsidian
 * 已经剥掉扩展名）。早先锚了扩展名，而调用方传的是裸名，
 * 结果永远匹配不上、**每个文件都读不出来**，且不报错只表现为「没有数据」。
 *
 * 占位符各占一个捕获组，顺序与 `tokenOrder` 一致 —— 反解时靠这个对应关系取值。
 */
export function templateToRegExp(tpl: string): RegExp {
  let out = ''
  let last = 0
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(tpl)) !== null) {
    out += escapeRe(tpl.slice(last, m.index))
    const spec = TOKEN_SPEC[m[1]!]
    out += '(' + spec.re + ')'
    last = m.index + m[0].length
  }
  out += escapeRe(tpl.slice(last))
  return new RegExp('^' + out + '$')
}

/** 模板里占位符的出现顺序，反解时按这个位置取捕获组 */
export function tokenOrder(tpl: string): Array<'Y' | 'YY' | 'M' | 'D'> {
  const out: Array<'Y' | 'YY' | 'M' | 'D'> = []
  TOKEN_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TOKEN_RE.exec(tpl)) !== null) {
    const name = m[1] as 'Y' | 'YY' | 'M' | 'D'
    if (TOKEN_NAMES.includes(name)) out.push(name)
  }
  return out
}

/* ---------- 正推 ---------- */

/**
 * 日期键（`2026-10-10`）→ 文件名（不含 `.md`）。
 *
 * **不补零**：日期键本身就是补零过的（`2026-01-02`），拆开直接用。
 * 早先这里有个 `pad()`，但 `renderName` 拿不到「几月」——
 * 补零是**校验层**的事（`isValidKey` 会拒绝 `2026-1-2`），
 * 正推层只负责按模板拼字符串。
 */
export function renderName(tpl: string, key: string): string {
  const [y, m, d] = key.split('-')
  return tpl.replace(TOKEN_RE, (_all, tok: string) => {
    switch (tok) {
      case 'Y':
        return y
      case 'YY':
        return y.slice(2)
      case 'M':
        return m
      case 'D':
        return d
      default:
        return tok
    }
  })
}

/* ---------- 反解 ---------- */

/**
 * 文件名（**不含 `.md`**，即 Obsidian 的 `TFile.basename`）→ 日期键。
 * 对不上返回 null。
 *
 * 参数是不含扩展名的裸名 —— `listFiles` 拿到的就是那样。
 */
export function parseName(tpl: string, basename: string): string | null {
  const m = templateToRegExp(tpl).exec(basename)
  if (!m) return null
  const fields = tokenOrder(tpl)
  let Y = ''
  let YY = ''
  let M = ''
  let D = ''
  fields.forEach((f, i) => {
    const v = m[i + 1]!
    if (f === 'Y') Y = v
    else if (f === 'YY') YY = v
    else if (f === 'M') M = v
    else D = v
  })
  const year = Y || (YY ? '20' + YY : '')
  if (!year || !M || !D) return null
  const key = `${year}-${M}-${D}`
  // 挡掉 `2026-13-45` 这类：模板对了但日期本身不合法
  return isValidKey(key) ? key : null
}

export function isValidKey(key: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (!m) return false
  const mo = Number(m[2])
  const d = Number(m[3])
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false
  // 真校验：排除 2 月 30 号这类
  const dt = new Date(Number(m[1]), mo - 1, d)
  return dt.getFullYear() === Number(m[1]) && dt.getMonth() === mo - 1 && dt.getDate() === d
}

/* ---------- 校验（设置面板用） ---------- */

export interface ValidationResult {
  ok: boolean
  /** 出错时的说明；ok 为 true 时是给用户看的示例 */
  message: string
}

/** vault 里非法的文件名字符（跨平台保守取交集） */
const ILLEGAL = /[\\/:*?"<>|]/

export function validateSettings(folder: string, tpl: string): ValidationResult {
  // 目录
  const f = folder.trim()
  if (!f) return { ok: false, message: '存储目录不能为空' }
  if (f.startsWith('/') || f.endsWith('/'))
    return { ok: false, message: '存储目录不能以 / 开头或结尾' }
  if (f.split('/').some((seg) => !seg || seg === '.' || seg === '..'))
    return { ok: false, message: '存储目录里有空的层级或 . / ..' }

  // 文件名模板
  const t = tpl.trim()
  if (!t) return { ok: false, message: '文件名模板不能为空' }
  if (ILLEGAL.test(t)) return { ok: false, message: '文件名不能含 / \\ : * ? " < > |' }
  const fields = tokenOrder(t)
  const hasMonth = fields.includes('M')
  const hasDay = fields.includes('D')
  const hasYear = fields.some((f) => f === 'Y' || f === 'YY')
  if (!hasYear || !hasMonth || !hasDay)
    return { ok: false, message: '文件名模板必须包含 {Y}（或 {YY}）、{M}、{D} 三个占位符' }

  // 往返验一次：能正推也能反解，且不同日期不撞名
  const k1 = '2026-01-02'
  const k2 = '2026-01-12'
  const n1 = renderName(t, k1)
  const n2 = renderName(t, k2)
  if (n1 === n2) return { ok: false, message: `${k1} 与 ${k2} 生成了同样的文件名，会互相覆盖` }
  if (parseName(t, n1) !== k1) return { ok: false, message: '文件名无法反解回日期，数据会读不出来' }

  return { ok: true, message: `示例：${n1}.md` }
}

/** 目录 + 文件名 → vault 内完整路径 */
export function fullPath(folder: string, tpl: string, key: string): string {
  return `${folder.trim().replace(/\/+$/, '')}/${renderName(tpl, key)}.md`
}

/** 归一化设置（读data.json 时用，缺字段或被手改过都要兜住） */
export function withDefaults(raw: unknown): PluginSettings {
  const o = (raw ?? {}) as Partial<PluginSettings>
  return {
    folder: typeof o.folder === 'string' && o.folder.trim() ? o.folder.trim() : DEFAULT_SETTINGS.folder,
    nameTemplate:
      typeof o.nameTemplate === 'string' && validateSettings(DEFAULT_SETTINGS.folder, o.nameTemplate).ok
        ? o.nameTemplate.trim()
        : DEFAULT_SETTINGS.nameTemplate,
    openAtStartup: o.openAtStartup === true,
  }
}