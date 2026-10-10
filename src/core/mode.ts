/**
 * 测试模式。
 *
 * 需求是「试新功能别把日常数据搅乱」。方案选 URL 参数 `?test` 而不是构建模式：
 *  - 不用维护两套产物，也不用记住「测试版要重新 npm run build」
 *  - NAS 托管和单文件双击都能用，改个地址栏就行
 *  - 测试数据落在**独立 key** 里，物理上和日常数据隔开，误不误伤
 *
 * 隔离了三处：
 *  1. localStorage 键 →clarityledger.db.v3.test
 *  2. IndexedDB 里的文件句柄 → fh.test（否则会捡到正式绑定的那个 .json）
 *  3. 种子数据 → 换成演示数据，不塞真实的 GDD 任务
 *
 * 注意第2 条容易被忽略：localStorage 分了key，但文件句柄是存在 IndexedDB 里的，
 * 不改的话测试模式启动时会自动恢复正式数据的 .json 绑定，直接覆盖测试库。
 */

/** 读取一次就固定下来。运行中改地址栏不该让已有数据换库 */
const TEST_PARAM = 'test'

function detect(): boolean {
  try {
    return new URLSearchParams(window.location.search).has(TEST_PARAM)
  } catch {
    // SSR / 非浏览器环境。按正式模式走，别在测试里意外走测试分支
    return false
  }
}

export const isTestMode: boolean = detect()

/**
 * localStorage 键。测试模式用独立键，和日常数据物理隔离。
 * 注意 `core/types.ts` 里的 DB_KEY 是「正式模式」的键，别处导入的还得是常量。
 */
export const dbKey = (): string =>
  isTestMode ? 'clarityledger.db.v3.test' : 'clarityledger.db.v3'

/**
 * IndexedDB 里存文件句柄的键。
 * 测试模式必须换键 —— 不换的话启动时会捡到正式绑定的文件，
 * 而 FilePort 加载后会被 mergeByRecency 合进内存，测试库就废了。
 */
export const idbHandleKey = (): string => (isTestMode ? 'fh.test' : 'fh')

/** 新建文件的建议名。测试模式下带test 后缀，避免和正式文件混在一起 */
export const suggestFileName = (): string =>
  isTestMode ? 'clarity-ledger-test.json' : 'clarity-ledger.json'

/** 导出文件的默认名 */
export const exportFileName = (): string =>
  isTestMode ? 'clarity-ledger-测试数据.json' : 'clarity-ledger.json'