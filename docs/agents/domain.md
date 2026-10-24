# 领域文档

工程技能在探查代码库时，按以下规则消费本仓库的领域文档。

## 探查前先读

- 仓库根目录的 **`GLOSSARY.md`**。
- **`docs/adr/`**：读与你即将改动的区域相关的 ADR。

这些文件不存在就**静默跳过**：不提示缺失，也不建议先补。
`/domain-modeling`（经由 `/grill-with-docs` 与 `/improve-codebase-architecture` 触达）会在术语或决策真正定下来时按需创建。

## 文件结构

本仓库是单上下文：

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-event-sourced-orders.md
│   └── 0002-postgres-for-write-model.md
└── src/
```

## 用词表里的词

输出里出现领域概念时（issue 标题、重构提案、假设、测试名），用 `GLOSSARY.md` 定义的词，不要漂到它明确避开的同义词。

需要的概念还不在用词表里，本身就是信号：要么你在发明项目不用的说法（重新考虑），要么是真实缺口（记下来交给 `/domain-modeling`）。

## 标出 ADR 冲突

若输出与既有 ADR 相悖，明确点出来，不要默默覆盖：

> _与 ADR-0007（事件溯源订单）冲突，但值得重开，因为……_
