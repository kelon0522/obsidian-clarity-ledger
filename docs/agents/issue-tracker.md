# Issue tracker：GitHub

本仓库的 issue 与 spec 都存在 GitHub Issues（`kelon0522/obsidian-clarity-ledger`）里，所有操作走 `gh` CLI。

## 约定

- **新建 issue**：`gh issue create --title "..." --body "..."`。多行 body 用 heredoc。
- **读取 issue**：`gh issue view <number> --json number,title,body,labels,comments`。
- **列出 issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，按需加 `--label` / `--state` 过滤。
- **挂成父 issue 的子 issue**：`gh issue create --parent <parent> ...`，或事后 `gh issue edit <parent> --add-sub-issue <child>`（`gh` 2.94+）。老版本 `gh`：`gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`（用数据库 id，见下方 **阻塞**）。不支持子 issue 时，在子 issue body 顶部写 `Part of #<parent>`。
- **评论**：`gh issue comment <number> --body "..."`
- **打 / 删标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭**：`gh issue close <number> --comment "..."`

仓库由 `git remote -v` 推断；在 clone 里运行 `gh` 会自动识别。

## PR 作为 triage 入口

**PR 作为请求面：否。** _（若本仓库把外部 PR 当功能请求处理，改成 `是`；`/triage` 会读这个开关。）_

设为 `是` 时，PR 与 issue 走同一套标签和状态，用对应的 `gh pr` 命令：

- **读取 PR**：`gh pr view <number> --comments`；看 diff 用 `gh pr diff <number>`。
- **列出待 triage 的外部 PR**：`gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`。
- **评论 / 打标签 / 关闭**：`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub 的 issue 与 PR 共用一个编号空间，裸 `#42` 可能是两者之一：先 `gh pr view 42`，失败再 `gh issue view 42`。

## 当技能说「发布到 issue tracker」

新建一个 GitHub issue。

## 当技能说「取出对应工单」

按上面的 **读取 issue** 操作。

## Wayfinding 操作

供 `/wayfinder` 使用。**地图**是一个 issue，**子 issue** 是它的工单。

- **地图**：单个 issue，打 `wayfinder:map` 标签，body 承载 Notes / Decisions-so-far / Fog。`gh issue create --label wayfinder:map`。
- **子工单**：作为地图的 GitHub 子 issue 链接（见 **挂成父 issue 的子 issue**）。子 issue 未启用时，在地图 body 的 task list 里加一条，并在子 issue body 顶部写 `Part of #<map>`。标签：`wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。认领后分配给执行的开发者。
- **阻塞**：GitHub 原生 issue 依赖，这是规范且 UI 可见的表达。加边：`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`，`<blocker-db-id>` 是阻塞者的数字**数据库 id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，**不是** `#number`，也不是 `node_id`）。GitHub 用 `issue_dependencies_summary.blocked_by`（只算未关闭的阻塞者）作为实时闸门。依赖功能不可用时，退化为子 issue body 顶部的 `Blocked by: #<n>, #<n>` 行。所有阻塞者关闭后，工单才算解除阻塞。
- **前沿查询**：列出地图下未关闭的子 issue（`gh issue list --state open`，范围限定地图的子 issue / task list），剔除有未关闭阻塞者（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 行里有未关闭 issue）或已有 assignee 的，取地图顺序第一个。
- **认领**：`gh issue edit <n> --add-assignee @me`，这是本次会话的第一次写操作。
- **结案**：`gh issue comment <n> --body "<answer>"`，再 `gh issue close <n>`，最后把上下文指针（gist + 链接）追加到地图的 Decisions-so-far。
