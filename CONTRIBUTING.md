# 参与开发

## 先跑起来

```bash
npm install
npm test        # 202 个用例
npm run build   # 产出 main.js + styles.css
```

把产物拷进自己的 vault 就能看到效果：

```bash
# Linux / macOS
cp main.js manifest.json styles.css ~/.config/obsidian/plugins/clarity-ledger/
# Windows（Git Bash）
cp main.js manifest.json styles.css "$APPDATA/obsidian/plugins/clarity-ledger/"
```

`Ctrl+R` 重载 Obsidian即可。开发时建议装 [Hot-Reload 插件](https://github.com/pjeby/hot-reload)。

Windows 上也可以直接跑 `install.bat`（会问你的 vault 在哪）。

## 这个项目的代码风格有点特别，先读这几条

不是「建议」，是**踩过坑之后定下来的**，改代码时绕过去：

- **注释写「为什么」，不写「做了什么」。** 这个项目里大量注释在解释
  「为什么不能那么写」—— 因为每一条都对应一个真实故障（白屏、假绿、
  写入队列卡死）。顺着这些注释能避开大部分坑。
- **关键约束必须双向断言。** 比如 `--spacing-row: 40px` 和 `core/time.ts` 里的
  `ROWH` 必须相等；改一个必须改另一个，`scripts/verify-build.mjs` 会拦。
- **构建产物要真的 require 一遍。** 「esbuild 退出码 0」不等于
  「Obsidian 能加载」—— 见 `scripts/verify-build.mjs` 开头的注释。

## 测试

```bash
npm test                # 全量用例
npm run mutation        # 变异测试（见下）
npm run test:watch      # 监听模式
```

**Windows / macOS / Linux 都能跑**，脚本是纯 node 驱动。

### 为什么有mutation 这一条命令

**「测试全绿」不等于「测试有效」。**

这个项目栽过一次：断言里写了要测的函数名，但匹配到的是**注释里那句话**——
把函数改坏了测试照样绿。

`npm run mutation` 逐个注入已知错误（改一个常量、删一段隔离层），
确认对应断言会红。它回答的是「我以为在测的东西，其实有没有在测」。

> 跑之前要求工作区干净 —— 还原步骤用 `git checkout`，脏工作区会丢改动。

**改了核心逻辑（`core/`、`md/`、`store/`）之后请跑一遍。**

## 提 PR 之前

CI 会自动跑：测试 → 类型检查 → 构建 → 产物自检 → 上架资源检查。
本地跑一遍更快，失败信息也更完整。

有一件事 CI 验不了：**改存储位置 / 文件名模板会真的搬用户的文件**。
碰 `src/md/migrate.ts` 或 `src/config/SettingsTab.ts` 时，
按 [`手测清单.md`](手测清单.md) 第六节在真机跑一遍再提。

## 问题反馈

提issue 时带上这几样，能省一轮往返：

- 你的 Obsidian版本 + 系统
- 操作步骤（哪一步点的什么）
- `Ctrl+Shift+I` 打开开发者工具 → Console 的**完整报错**（截图最好）
- 如果和读数据有关，附上那个 `.md` 文件的片段

## 许可

MIT，见 [LICENSE](LICENSE)。方法论出处：《认知觉醒》周岭。