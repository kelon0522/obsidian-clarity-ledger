/**
 * 插件 store 的规则测试。
 *
 * 这些用例和 Web 版 `store.test.ts` 是**同一批断言**——
 * 目的正是验证「共用 core 之后，两边的产品行为不会漂」。
 * 如果哪天改了 core 让某个规则变形，这里和 Web 版会同时红。
 *
 * 写 vault 的部分单独测（mock vault），规则部分不需要。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '@/core/types'

const DAY = '2026-10-10'
const OTHER = '2026-10-11'

/* mock vault：规则测试不关心落盘，只需要 writeDay 可观察。
   不再mock FOLDER —— 存储位置改成配置项了，vault.ts 里已没有这个常量。*/
const writeDay = vi.fn(async (_key: string, _day: { tasks: Task[] }) => {})
vi.mock('@/md/vault', () => ({
  VaultStore: class {
    writeDay = writeDay
  },
}))

const { useStore, flushNow, bindVault, hasPendingWrite } = await import('./index')
const { VaultStore } = await import('@/md/vault')

function seed() {
  useStore.setState({
    db: {
      [DAY]: {
        // est 与 pd 故意不同：45/60、30/90。相等的话「取哪个」测不出来
        tasks: [
          { id: 1, ti: 'A', est: 45, plan: 480, pd: 60, act: null, ad: 0 },
          { id: 2, ti: 'B', est: 30, plan: 540, pd: 90, act: null, ad: 0 },
          { id: 3, ti: 'C', est: 30, plan: null, pd: 0, act: null, ad: 0 },
        ],
        note: '',
        created: DAY,
      },
    },
    cur: DAY,
    toast: null,
    undo: null,
    saving: false,
    ready: true,
  })
}

const T = (id: number): Task => useStore.getState().db[DAY]!.tasks.find((t) => t.id === id)!
const ids = () => useStore.getState().db[DAY]!.tasks.map((t) => t.id)

beforeEach(async () => {
  bindVault(new VaultStore({} as never) as never, () => {})
  seed()
  // 先把上一个用例遗留的防抖定时器和脏数据清掉，再 spy。
  // 顺序反了的话：addTodo 挂上 250ms 定时器 → 测试结束 → 定时器在下一个
  // beforeEach 之前触发 → 写到了旧实例上，spy 断不到。
  await flushNow()
  writeDay.mockClear()
})

/* ================= 规则一：落位即完成 ================= */
describe('落位即完成（无自动计时）', () => {
  it('complete 设 act，完成判定立刻为真', () => {
    useStore.getState().complete(1, 600)
    expect(T(1).act).toBe(600)
  })

  it('时长沿用计划时长，不看当前时间', () => {
    // pd=60（不是 est=45）—— 变异成取 est 就会红
    useStore.getState().complete(1, 600)
    expect(T(1).ad).toBe(60)
  })

  it('uncomplete 清 act 和 ad，保留排期', () => {
    useStore.getState().complete(1, 600)
    useStore.getState().uncomplete(1)
    expect(T(1).act).toBeNull()
    expect(T(1).ad).toBe(0)
    expect(T(1).plan).toBe(480)
  })
})

/* ================= 规则二：实际时长恒等于计划时长 ================= */
describe('实际轨时长 = 计划时长', () => {
  it('est 与 pd 不等时取 pd', () => {
    useStore.getState().complete(2, 600)
    expect(T(2).ad).toBe(90)
    expect(T(2).est).toBe(30)
  })

  it('没有 pd 时回落 est', () => {
    useStore.setState((s) => ({
      db: { ...s.db, [DAY]: { ...s.db[DAY]!, tasks: [{ id: 9, ti: 'X', est: 45, plan: 480, pd: 0, act: null, ad: 0 }] } },
    }))
    useStore.getState().complete(9, 600)
    expect(T(9).ad).toBe(45)
  })

  it('resizeAct 改时间不改时长口径', () => {
    useStore.getState().complete(1, 600)
    useStore.getState().resizeAct(1, 720, 60)
    expect(T(1).act).toBe(720)
    expect(T(1).ad).toBe(60)
  })

  it('resizeAct 不碰 plan', () => {
    useStore.getState().complete(1, 600)
    useStore.getState().resizeAct(1, 720, 90)
    expect(T(1).plan).toBe(480)
  })
})

/* ================= 规则三：计划列顺延 ================= */
describe('计划列顺延', () => {
  it('压到后续任务时把它往后推', () => {
    useStore.getState().schedule(3, 480, 120)
    // C 塞进 A 的区间（480–540）→ 应被推到 540
    expect(T(3).plan).toBe(540)
  })

  it('顺延是链式的 —— 被推后的继续推它后面的', () => {
    useStore.setState((s) => ({
      db: {
        ...s.db,
        [DAY]: {
          ...s.db[DAY]!,
          tasks: [
            { id: 1, ti: 'A', est: 60, plan: 480, pd: 60, act: null, ad: 0 },
            { id: 2, ti: 'B', est: 60, plan: 540, pd: 60, act: null, ad: 0 },
            { id: 3, ti: 'C', est: 60, plan: 540, pd: 60, act: null, ad: 0 },
          ],
        },
      },
    }))
    useStore.getState().schedule(1, 480, 180)
    expect(T(2).plan).toBe(660)
    expect(T(3).plan).toBe(720)
  })

  it('实际列不参与顺延', () => {
    useStore.getState().complete(2, 480)
    useStore.getState().schedule(1, 480, 30)
    // B 在实际轨的 480 不该被推
    expect(T(2).act).toBe(480)
  })
})

/* ================= 待办 ================= */
describe('待办', () => {
  it('addTodo 追加到末尾', () => {
    useStore.getState().addTodo('新任务')
    expect(ids()).toEqual([1, 2, 3, expect.any(Number)])
    expect(useStore.getState().db[DAY]!.tasks[3]!.ti).toBe('新任务')
  })

  it('addTodo 生成不重复的 id（连加 200 条）', () => {
    for (let i = 0; i < 200; i++) useStore.getState().addTodo(`t${i}`)
    const got = useStore.getState().db[DAY]!.tasks.map((t) => t.id)
    expect(new Set(got).size).toBe(got.length)
  })

  it('removeTodo 删掉指定项', () => {
    useStore.getState().removeTodo(2)
    expect(ids()).toEqual([1, 3])
  })

  it('renameTodo 改标题', () => {
    useStore.getState().renameTodo(1, '改过的名字')
    expect(T(1).ti).toBe('改过的名字')
  })

  it('renameTodo 空串视为取消，不删任务', () => {
    useStore.getState().renameTodo(1, '   ')
    expect(T(1).ti).toBe('A')
    expect(ids()).toHaveLength(3)
  })

  it('renameTodo 不影响排期', () => {
    useStore.getState().renameTodo(1, '改名')
    expect(T(1).plan).toBe(480)
    expect(T(1).pd).toBe(60)
  })

  it('moveTo 收位置，reorder 收 id —— 混用会静默失效', () => {
    // moveTo(id, 位置)
    useStore.getState().moveTo(3, 0)
    expect(ids()).toEqual([3, 1, 2])
    // reorder(id, id)
    useStore.getState().reorder(3, 1)
    expect(ids()).toEqual([1, 3, 2])
  })

  it('moveTo 下标越界会被钳位，不静默失效', () => {
    useStore.getState().moveTo(1, 99)
    expect(ids()).toEqual([2, 3, 1])
  })
})

/* ================= 待办跨日期移动（拖到月历） ================= */
describe('待办拖到月历（跨日期移动）', () => {
  it('整条搬到目标天：源天消失，目标天末尾出现', () => {
    useStore.getState().moveTaskToDay(3, OTHER)
    expect(ids()).toEqual([1, 2])
    const other = useStore.getState().db[OTHER]!.tasks
    expect(other).toHaveLength(1)
    expect(other[0]!.ti).toBe('C')
  })

  it('字段原样搬过去（含排期与预估）', () => {
    // Task 1 有计划排期（plan 480 / pd 60 / est 45）—— 搬过去一个字段都不能丢
    useStore.getState().moveTaskToDay(1, OTHER)
    const t = useStore.getState().db[OTHER]!.tasks[0]!
    expect(t).toMatchObject({ id: 1, ti: 'A', est: 45, plan: 480, pd: 60, act: null, ad: 0 })
  })

  it('目标天不存在时自动建档', () => {
    useStore.getState().moveTaskToDay(3, '2026-10-20')
    const d = useStore.getState().db['2026-10-20']!
    expect(d.tasks.map((t) => t.id)).toEqual([3])
    expect(d.created).toBe('2026-10-20')
  })

  it('已完成的待办不能搬（act != null 即完成）', () => {
    useStore.getState().complete(1, 600)
    useStore.getState().moveTaskToDay(1, OTHER)
    expect(ids()).toEqual([1, 2, 3])
    // 目标天不该被创建出来 —— 拒绝了就是什么都没发生
    expect(useStore.getState().db[OTHER]).toBeUndefined()
  })

  it('拖回当天 = 原地不动（不会变成「移到末尾」的静默重排）', () => {
    useStore.getState().moveTaskToDay(3, DAY)
    expect(ids()).toEqual([1, 2, 3])
  })

  it('不存在的 id 不崩也不搬', () => {
    expect(() => useStore.getState().moveTaskToDay(999, OTHER)).not.toThrow()
    expect(ids()).toEqual([1, 2, 3])
    expect(useStore.getState().db[OTHER]).toBeUndefined()
  })

  it('搬完后目标天守「计划列顺延」', () => {
    // OTHER 天已占了 8:00–9:00；A 也是 8:00 搬过去 → 应被推到 9:00
    useStore.setState((s) => ({
      db: {
        ...s.db,
        [OTHER]: {
          tasks: [{ id: 50, ti: '已有', est: 60, plan: 480, pd: 60, act: null, ad: 0 }],
          note: '',
          created: OTHER,
        },
      },
    }))
    useStore.getState().moveTaskToDay(1, OTHER)
    const [first, second] = useStore.getState().db[OTHER]!.tasks
    expect(first!.plan).toBe(480)
    expect(second!.plan).toBe(540)
  })

  it('源天其余任务的顺序不变', () => {
    useStore.getState().moveTaskToDay(2, OTHER)
    expect(ids()).toEqual([1, 3])
  })

  it('两天都写脏 —— 少写任何一天都会丢一半数据', async () => {
    writeDay.mockClear()
    useStore.getState().moveTaskToDay(3, OTHER)
    await flushNow()
    const days = writeDay.mock.calls.map((c) => c[0])
    expect(days).toContain(DAY)
    expect(days).toContain(OTHER)
    expect(writeDay).toHaveBeenCalledTimes(2)
  })

  it('弹提示告诉用户搬到哪了，且不带撤销按钮', () => {
    // 撤销快照是单天的，跨天移动给不了撤销 —— 别放一个按了没反应的按钮
    useStore.getState().moveTaskToDay(3, OTHER)
    const t = useStore.getState().toast
    expect(t).not.toBeNull()
    expect(t!.msg).toContain('C')
    expect(t!.msg).toContain('10-11')
    expect(t!.undoable).toBe(false)
  })
})

/* ================= 删除待办的撤销 ================= */
describe('删除待办 · 可撤销', () => {
  it('删除会弹提示且带撤销按钮', () => {
    useStore.getState().removeTodo(2)
    const t = useStore.getState().toast
    expect(t).not.toBeNull()
    expect(t!.undoable).toBe(true)
  })

  it('撤销把整条装回来（静默失效的老bug）', () => {
    useStore.getState().removeTodo(2)
    expect(ids()).toEqual([1, 3])
    useStore.getState().doUndo()
    expect(ids()).toEqual([1, 2, 3])
  })

  it('撤销回到原来的位置 —— 顺序即优先级', () => {
    useStore.getState().removeTodo(2)
    useStore.getState().doUndo()
    expect(ids()).toEqual([1, 2, 3])
  })

  it('撤销后字段全回来', () => {
    useStore.getState().complete(2, 600)
    const before = { ...T(2) }
    useStore.getState().removeTodo(2)
    useStore.getState().doUndo()
    expect(T(2)).toEqual(before)
  })

  it('只有一步撤销栈', () => {
    useStore.getState().removeTodo(1)
    useStore.getState().removeTodo(2)
    expect(ids()).toEqual([3])
    useStore.getState().doUndo()
    expect(ids()).toEqual([2, 3])
  })

  it('撤销后快照清空', () => {
    useStore.getState().removeTodo(2)
    useStore.getState().doUndo()
    expect(useStore.getState().undo).toBeNull()
  })

  it('没有快照时撤销不崩', () => {
    useStore.setState({ undo: null })
    expect(() => useStore.getState().doUndo()).not.toThrow()
  })
})

/* ================= 移除块与撤销 ================= */
describe('移除块', () => {
  it('在计划轨移除：清排期，任务保留', () => {
    useStore.getState().removeBlock(1)
    expect(T(1).plan).toBeNull()
    expect(T(1).pd).toBe(0)
    expect(ids()).toContain(1)
  })

  it('在实际轨移除：只清 act，plan 保留', () => {
    useStore.getState().complete(1, 600)
    useStore.getState().removeBlock(1)
    expect(T(1).act).toBeNull()
    expect(T(1).plan).toBe(480)
  })

  it('撤销恢复字段', () => {
    useStore.getState().complete(1, 600)
    useStore.getState().removeBlock(1)
    useStore.getState().doUndo()
    expect(T(1).act).toBe(600)
  })

  it('撤销后 toast 关闭', () => {
    useStore.getState().removeBlock(1)
    expect(useStore.getState().toast).not.toBeNull()
    useStore.getState().doUndo()
    expect(useStore.getState().toast).toBeNull()
  })
})

/* ================= 备注 ================= */
describe('复盘备注', () => {
  it('setNote 写入当天', () => {
    useStore.getState().setNote('今天状态不错')
    expect(useStore.getState().db[DAY]!.note).toBe('今天状态不错')
  })

  it('切日期后各写各的', () => {
    useStore.getState().setNote('第一天')
    useStore.getState().setCur(OTHER)
    useStore.getState().setNote('第二天')
    expect(useStore.getState().db[DAY]!.note).toBe('第一天')
    expect(useStore.getState().db[OTHER]!.note).toBe('第二天')
  })
})

/* ================= 落盘 ================= */
describe('写入 vault', () => {
  it('改了就写，且只写脏了的那天', async () => {
    writeDay.mockClear()
    useStore.getState().addTodo('要落盘')
    await flushNow()
    expect(writeDay).toHaveBeenCalledTimes(1)
    expect(writeDay.mock.calls[0]![0]).toBe(DAY)
  })

  it('写到的是改完后的内容', async () => {
    writeDay.mockClear()
    useStore.getState().addTodo('新任务名')
    await flushNow()
    const passed = writeDay.mock.calls[0]![1] as { tasks: Task[] }
    expect(passed.tasks.map((t) => t.ti)).toContain('新任务名')
  })

  it('没改就不写', async () => {
    await flushNow()
    writeDay.mockClear()
    await flushNow()
    expect(writeDay).not.toHaveBeenCalled()
  })

  it('单天写失败不崩，且不影响其它天', async () => {
    writeDay.mockClear()
    writeDay.mockRejectedValueOnce(new Error('磁盘满了'))
    useStore.getState().setCur(DAY)
    useStore.getState().addTodo('a')
    useStore.getState().setCur(OTHER)
    useStore.getState().addTodo('b')
    await expect(flushNow()).resolves.toBeUndefined()
    // 第二天那次仍然写了
    expect(writeDay.mock.calls.map((c) => c[0])).toContain(OTHER)
  })

  /**
   * 回归测试：早先 flush 里写的是
   *   const d = s.db[day]; if (!d) continue      ← continue 绕过了 finally
   *   try { write } finally { writing.delete(day) }
   * 于是那一天永远留在 writing 里，之后每次 flush 都在 `writing.size`
   * 处提前 return —— **整个写入队列永久卡死**。
   *
   * 症状极难定位：改了没反应、关页面也存不上，但没有任何报错。
   */
  it('某天从库里消失时不卡死队列（continue 绕过 finally 的坑）', async () => {
    writeDay.mockClear()
    // 标脏一天，然后把它从 db 里拿掉 —— 模拟「这天被删了」
    useStore.getState().addTodo('x')
    useStore.setState((s) => {
      const db = { ...s.db }
      delete db[OTHER]
      return { db }
    })
    await flushNow()
    expect(hasPendingWrite()).toBe(false)

    // 队列还能继续用：后面改了照写
    writeDay.mockClear()
    useStore.getState().setCur(DAY)
    useStore.getState().addTodo('y')
    await flushNow()
    expect(writeDay).toHaveBeenCalled()
  })

  it('连着多次改都写得出去，不会被上一批卡住', async () => {
    for (let i = 0; i < 5; i++) {
      useStore.getState().addTodo(`第${i}条`)
      await flushNow()
    }
    expect(hasPendingWrite()).toBe(false)
  })
})

afterEach(() => {
  writeDay.mockClear()
})

/* ================= 计划轨点对勾 = 挪到同一时间段 ================= */
describe('markDoneNow：点对勾落在计划的同一时间段', () => {
  /* 真机事故（2026-10-10）：主理人点计划轨的对勾，实际轨什么都没出现。
     根因：搬 store 时 markDoneNow 只调了 complete(id, nowMin())，
     丢掉了 Web 版 2026-10-09 加的「act = plan」——
     于是实际块被放到**当前时刻**（15 点左右），而计划在 8:00，
     视觉上像是「没出现」。

     这条断言锁的是产品决策：**就照计划做完了**，
     不是「现在做完了」。两者的区别是实际块的落位时间。*/

  it('已排期的任务：act = plan，不是当前时刻', () => {
    /* 固定 nowMin，避免测试跑在跨 8 点的时候。Task 1 的 plan 是 480（8:00），
       当前时刻随便多少，只要不等于 480 就能区分开。*/
    useStore.getState().markDoneNow(1)
    const t = T(1)
    expect(t.act).toBe(480)
    expect(t.act).toBe(t.plan)
    // 时长沿用计划口径（est=45 / pd=60，取 pd）
    expect(t.ad).toBe(60)
  })

  it('两个任务各自落在自己的计划时段，不会都堆到同一处', () => {
    useStore.getState().markDoneNow(1)
    useStore.getState().markDoneNow(2)
    expect(T(1).act).toBe(480)
    expect(T(2).act).toBe(540)
    // 第二条不能被第一条覆盖
    expect(T(1).act).not.toBe(T(2).act)
  })

  it('没排期的才回落到「当前时刻往前推一个时长」', () => {
    // Task 3 是未排期，est=30 / pd=0
    useStore.getState().markDoneNow(3)
    const t = T(3)
    expect(t.act).not.toBeNull()
    // 回落后同时补上 plan —— 实际轨和计划轨不该指向不同起点
    expect(t.plan).toBe(t.act)
    expect(t.ad).toBe(30)
  })

  it('不改动其它任务的字段', () => {
    useStore.getState().markDoneNow(1)
    expect(T(2).act).toBeNull()
    expect(T(2).plan).toBe(540)
    expect(T(3).act).toBeNull()
  })

  it('重复点对勾不会漂移（幂等）', () => {
    useStore.getState().markDoneNow(1)
    const first = T(1).act
    useStore.getState().markDoneNow(1)
    expect(T(1).act).toBe(first)
  })

  it('落盘写到的是当前天', async () => {
    writeDay.mockClear()
    useStore.getState().markDoneNow(1)
    await flushNow()
    expect(writeDay).toHaveBeenCalled()
    expect(writeDay.mock.calls[0]![0]).toBe(DAY)
  })
})
