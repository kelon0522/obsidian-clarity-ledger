import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  fullPath,
  isValidKey,
  parseName,
  renderName,
  tokenOrder,
  validateSettings,
  withDefaults,
} from './settings'

const D = '{Y}-{M}-{D}'

describe('文件名模板 · 正推', () => {
  it('默认模板产出 ISO 日期名', () => {
    expect(renderName(D, '2026-10-10')).toBe('2026-10-10')
  })

  it('{YY} 用两位年', () => {
    expect(renderName('{YY}{M}{D}', '2026-10-10')).toBe('261010')
  })

  it('模板里可以有固定文字和分隔符', () => {
    expect(renderName('{Y}年{M}月{D}日', '2026-10-10')).toBe('2026年10月10日')
    expect(renderName('规划 {Y}-{M}-{D}', '2026-10-10')).toBe('规划 2026-10-10')
  })

  it('日期变短（1 月）也补齐两位，不会变成 2026-1-1', () => {
    expect(renderName(D, '2026-01-02')).toBe('2026-01-02')
  })

  it('三个占位符各出现一次时可以任意排序', () => {
    expect(renderName('{D}-{M}-{Y}', '2026-10-09')).toBe('09-10-2026')
  })
})

describe('文件名模板 · 反解', () => {
  it('默认模板能反解回日期', () => {
    expect(parseName(D, '2026-10-10')).toBe('2026-10-10')
  })

  it('带中文的名字也能反解', () => {
    expect(parseName('{Y}年{M}月{D}日', '2026年10月10日')).toBe('2026-10-10')
  })

  it('{YY} 反解时补回世纪（只可能是 20xx）', () => {
    expect(parseName('{YY}{M}{D}', '261010')).toBe('2026-10-10')
  })

  it('对不上返回 null，不抛异常', () => {
    expect(parseName(D, '随手写的笔记')).toBeNull()
    expect(parseName(D, '2026-1-10')).toBeNull() // 没补零
    expect(parseName(D, '2026-10-10 星期五')).toBeNull() // 多余文字
  })

  it('挡掉不存在的日期：2026-02-30、2026-13-01', () => {
    /* 模板对了但日期本身不合法 —— 这类文件名不该被当成数据，
       否则日历上会出现一个幽灵格子，点进去是空的。*/
    expect(parseName(D, '2026-02-30')).toBeNull()
    expect(parseName(D, '2026-13-01')).toBeNull()
    expect(parseName(D, '2026-00-10')).toBeNull()
  })
})

describe('正推与反解必须一致（往返）', () => {
  /* 这是整个配置的核心不变量。
     少一天键都可能导致「写进去读不出来」——
     用户会以为数据丢了，实际文件就在那儿但插件认不出。*/

  const keys = [
    '2026-01-01',
    '2026-01-02',
    '2026-01-12',
    '2026-02-28',
    '2026-03-05',
    '2026-10-10',
    '2026-12-31',
    '2027-01-01',
    '2099-12-31',
  ]
  const templates = [
    D,
    '{Y}{M}{D}',
    '{YY}-{M}-{D}',
    '{D}-{M}-{Y}',
    '规划 {Y}-{M}-{D}',
    '{Y}年{M}月{D}日',
    '{Y}/{M}/{D}', // 斜杠会在校验里被拒，但往返本身该成立
  ]

  it.each(templates)('%s：全部日期往返一致', (tpl) => {
    for (const k of keys) {
      expect(parseName(tpl, renderName(tpl, k))).toBe(k)
    }
  })

  it.each(templates)('%s：不同日期不生成同名文件', (tpl) => {
    const names = keys.map((k) => renderName(tpl, k))
    expect(new Set(names).size).toBe(names.length)
  })

  it('闰年边界：2024-02-29 有效、2026-02-29 无效', () => {
    expect(isValidKey('2024-02-29')).toBe(true)
    expect(isValidKey('2026-02-29')).toBe(false)
  })
})

describe('tokenOrder', () => {
  it('按出现顺序返回字段', () => {
    expect(tokenOrder('{D}-{M}-{Y}')).toEqual(['D', 'M', 'Y'])
    expect(tokenOrder('{YY}{M}{D}')).toEqual(['YY', 'M', 'D'])
  })

  it('无占位符时为空', () => {
    expect(tokenOrder('规划')).toEqual([])
  })
})

describe('校验', () => {
  it('默认设置合法', () => {
    expect(validateSettings(DEFAULT_SETTINGS.folder, DEFAULT_SETTINGS.nameTemplate).ok).toBe(true)
  })

  it('目录为空 / 前后带/ 被拒', () => {
    expect(validateSettings('', D).ok).toBe(false)
    expect(validateSettings('   ', D).ok).toBe(false)
    expect(validateSettings('/清晰力', D).ok).toBe(false)
    expect(validateSettings('清晰力/', D).ok).toBe(false)
  })

  it('目录里有空层级或 . / .. 被拒', () => {
    expect(validateSettings('a//b', D).ok).toBe(false)
    expect(validateSettings('../x', D).ok).toBe(false)
    expect(validateSettings('a/../b', D).ok).toBe(false)
  })

  it('多级目录合法', () => {
    expect(validateSettings('日记/清晰力', D).ok).toBe(true)
  })

  it('模板缺占位符被拒 —— 那样反解不出日期', () => {
    expect(validateSettings('清晰力', '规划').ok).toBe(false)
    expect(validateSettings('清晰力', '{Y}-{M}').ok).toBe(false)
    expect(validateSettings('清晰力', '{M}-{D}').ok).toBe(false)
    expect(validateSettings('清晰力', '{Y}-{D}').ok).toBe(false)
    expect(validateSettings('清晰力', '{YY}-{M}-{D}').ok).toBe(true)
  })

  it('模板含路径分隔符被拒', () => {
    expect(validateSettings('清晰力', '{Y}/{M}/{D}').ok).toBe(false)
    expect(validateSettings('清晰力', 'a:b').ok).toBe(false)
  })

  it('通过时给用户看的示例是真实产出的文件名', () => {
    const r = validateSettings('清晰力', D)
    expect(r.ok).toBe(true)
    expect(r.message).toBe('示例：2026-01-02.md')
  })
})

describe('fullPath', () => {
  it('拼出 vault 内路径', () => {
    expect(fullPath('清晰力', D, '2026-10-10')).toBe('清晰力/2026-10-10.md')
  })

  it('目录末尾多个 / 不会拼出空层级', () => {
    expect(fullPath('清晰力/', D, '2026-10-10')).toBe('清晰力/2026-10-10.md')
    expect(fullPath('清晰力///', D, '2026-10-10')).toBe('清晰力/2026-10-10.md')
  })

  it('多级目录', () => {
    expect(fullPath('日记/清晰力', D, '2026-10-10')).toBe('日记/清晰力/2026-10-10.md')
  })
})

describe('withDefaults（data.json 被手改过也要兜住）', () => {
  it('空配置给默认', () => {
    expect(withDefaults(null)).toEqual(DEFAULT_SETTINGS)
    expect(withDefaults({})).toEqual(DEFAULT_SETTINGS)
    expect(withDefaults('乱写')).toEqual(DEFAULT_SETTINGS)
  })

  it('合法值被保留', () => {
    expect(withDefaults({ folder: '日记/清晰力', nameTemplate: '{Y}年{M}月{D}日' })).toMatchObject({
      folder: '日记/清晰力',
      nameTemplate: '{Y}年{M}月{D}日',
    })
  })

  /* 不合法的模板必须回落默认，而不是带病运行。
     一个坏模板会让所有历史文件读不出来 —— 静默失效比报错更糟。*/
  it('非法模板回落默认，不带病运行', () => {
    expect(withDefaults({ nameTemplate: '规划' }).nameTemplate).toBe(DEFAULT_SETTINGS.nameTemplate)
    expect(withDefaults({ nameTemplate: '' }).nameTemplate).toBe(DEFAULT_SETTINGS.nameTemplate)
    expect(withDefaults({ nameTemplate: '{Y}/{M}/{D}' }).nameTemplate).toBe(DEFAULT_SETTINGS.nameTemplate)
  })

  it('空目录回落默认（否则 getAbstractFileByPath 收到空串会炸）', () => {
    expect(withDefaults({ folder: '   ' }).folder).toBe(DEFAULT_SETTINGS.folder)
  })

  it('openAtStartup 只认布尔 true', () => {
    expect(withDefaults({ openAtStartup: 'yes' }).openAtStartup).toBe(false)
    expect(withDefaults({ openAtStartup: true }).openAtStartup).toBe(true)
  })
})