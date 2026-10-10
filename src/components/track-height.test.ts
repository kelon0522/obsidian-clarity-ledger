/**
 * 轨道高度分配的测试。
 *
 * **这个函数决定「每日回顾会不会被挤出视口」** ——
 * 算错了，用户打开就看不到回顾区，而回顾区是每天必填的东西。
 * 所以边界值必须钉死，不能靠真机看。
 *
 * @vitest-environment jsdom
 */
import { describe, expect, it } from 'vitest'
import { TRACK_MAX, TRACK_MIN, trackHeight } from '@/components/TimeGutter'

describe('轨道高度自适应', () => {
  it('常规窗口：视口减去固定开销（未触及上下限）', () => {
    // 1080 高屏，固定开销 420 → 剩 660，但封顶 620
    expect(trackHeight(1080, 420)).toBe(TRACK_MAX)
    // 900 高屏扣掉 420→ 480，在 [280, 620] 区间内，原样返回
    expect(trackHeight(900, 420)).toBe(480)
  })

  /**
   * **窗口矮时轨道要让位给回顾区。**
   * 主理人报的原始问题就是这个：935 高的窗口里回顾区被挤到视口外。
   * 1120 - 420 = 700 > 上限 620 → 被 clamp 住，正好保住回顾区。
   */
  it('窗口偏矮时压到上限（这是回顾区能被看到的关键）', () => {
    expect(trackHeight(935, 420)).toBe(515)
    expect(trackHeight(800, 420)).toBe(380)
  })

  it('窗口很高时不让轨道无限拉长', () => {
    // 1440 高屏，扣掉开销还剩 1200 —— 轨道封顶 620
    expect(trackHeight(1440, 420)).toBe(TRACK_MAX)
    expect(trackHeight(2000, 420)).toBe(TRACK_MAX)
  })

  it('窗口极矮时保底，轨道仍能看（剩下靠滚动）', () => {
    // 视口 600、固定开销 500 → 只剩 100，但不低于 TRACK_MIN
    expect(trackHeight(600, 500)).toBe(TRACK_MIN)
    expect(trackHeight(400, 380)).toBe(TRACK_MIN)
    expect(trackHeight(300, 290)).toBe(TRACK_MIN)
  })

  it('固定开销大于视口（异常情况）也不能返回负数', () => {
    expect(trackHeight(400, 500)).toBe(TRACK_MIN)
    expect(trackHeight(0, 0)).toBe(TRACK_MIN)
  })

  /**
   * **轨道容器不能高过 24 小时轴本身。**
   * 轴总高 960px（24 × ROWH 40）。容器比它还高时，
   * 底部会留一大片空白 —— 而且块是按 `yT(分钟)` 绝对定位的，
   * 容器高不会让块跟着下移，视觉上就是「时间对不上刻度」。
   */
  it('上限不超过轴高960', () => {
    expect(TRACK_MAX).toBeLessThanOrEqual(960)
  })

  it('上下限的顺序没写反', () => {
    expect(TRACK_MIN).toBeLessThan(TRACK_MAX)
  })

  it('结果是整数（避免小数像素导致模糊边）', () => {
    for (const [a, r] of [[1080, 420], [935, 421], [777, 333]] as const) {
      expect(Number.isInteger(trackHeight(a, r))).toBe(true)
    }
  })
})
