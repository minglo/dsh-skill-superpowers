# DSH RC2 子代理与 Agent Teams 文档重写设计

日期：2026-11-12
状态：待用户批准
目标文档：`references/dsh-tools.md`
目标上游版本：DeepSeek Harness `0.2.2-rc.2`

## 1. 意图与原因

当前工具映射把 Agent Teams 描述为一套独立的持久成员系统，把普通 `subagent` 描述为另一套临时执行系统，并围绕 `spawn_teammate`、独立名册、`maxMembers`、Team 版控制工具和盲后台子代理组织路由。

DSH `0.2.2-rc.2` 已改为统一模型：**每个根会话拥有一棵普通子代理树；Agent Teams 是在这棵树上按 Session 启用的共享任务板与协调提示。** Team 不再拥有独立的创建、成员名册、消息、等待或中断链路。

如果继续保留旧文档，模型会调用已移除的工具、使用错误参数、误解 Team 开关的作用，并错误地认为 Team 会话中的普通子代理无法发现或续聊。这次重写的目的，是让技能及其读者在 RC2 默认配置和 Team 开关两种状态下都能选择真实存在且可观察、可续作的工具链。

## 2. 证据基线

设计仅依据官方 `dsh-v0.2.2-rc.2` 标签，提交 `ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c`，不把旧版本行为写成当前行为。

已核查的主要事实来源：

- `packages/team/agent-team/README.md`、`src/index.ts`、`src/task-board.ts`
- `packages/team/tool-agent-team/README.md`、`src/index.ts`、`tests/tool-team.spec.ts`
- `packages/subagent/tool-subagent/README.md`、`src/index.ts`
- `packages/subagent/tool-subagent-control/README.md`、`src/index.ts`、`src/list-agents.ts`、`src/wait-agent.ts`
- `packages/subagent/subagent/README.md`
- `packages/bundle/base/cordis.patch.yml`
- `packages/bundle/web-app/presets/standard.patch.yml`
- `docs/upgrade-guide/v0.2.1-rc.2/`、`v0.2.1-rc.3/`、`v0.2.2-alpha.3/`、`v0.2.2-rc.1/` 中相关指南

已执行验证：

- Team 服务、Team 工具、普通子代理控制：112 项测试通过。
- `apps/cli/tests/agent-team-headless.e2e.ts`：真实 profile 中端到端创建两个 teammate、跨分支消息、依赖任务、等待与最终汇总通过。

旧迁移指南中的 `agent_id` 已被后续版本改为 `agent`，最终文档必须以 RC2 当前源码和工具 schema 为准，不能只复制较早迁移文本。

## 3. 目标

1. 用统一子代理树替换“临时子代理与持久 Team 成员”的双身份模型。
2. 完整说明普通子代理的创建、命名、发现、消息、等待、完成通知、续作、容量与深度边界。
3. 完整说明 Team 默认关闭、按根 Session 开启、整棵树共享、关闭后保留子代理与任务的行为。
4. 列出 Team 开关两种状态下的真实工具集，并明确默认配置中 `interrupt_agent` 不暴露。
5. 让 SDD 在 Team 开关两种状态下都保持 fresh-per-task、fresh-per-review 和既有修复轮语义。
6. 明确 Team 开启后 SDD 子代理就是 teammate，可被发现和续聊，不再是盲后台执行。
7. 保留原文其他有效章节和低成本编排指导，同时修正返回值、等待和工具可见性。
8. 用应用场景和独立审查验证文档，而不是只做术语替换。

## 4. 非目标

- 不修改 DSH 源码、profile、插件配置或用户会话。
- 不改变 Superpowers 的 SDD、并行派发或代码审查技能本身的流程。
- 不为旧版 DSH 编写兼容路由，也不把历史行为继续描述为当前能力。
- 不编写 DSH 插件迁移指南；本次只修改本仓库的工具映射参考文档。
- 不引入新的持久角色开发方法来替代 SDD。
- 不在本阶段更新 PR、提交、推送或修改生成副本；这些属于批准后的实施。
- 不把中文翻译作为新的仓库维护副本；中文完整翻译用于用户审阅，仓库仍以英文母本为唯一源。这是设计者的建议，不是用户另行提出的新要求。

## 5. 反目标与失败标准

即使文档能够生成，出现以下任一情况也视为失败：

- 继续把 Team 成员和普通子代理描述为两套成员身份或两套控制接口。
- 继续根据 `spawn_teammate` 是否可见路由工作。
- 继续写 `maxMembers`、累计 Team 名册、Team 版 `target` 或旧 `agent_id` 调用。
- 把 Team 开关描述为创建、停止、删除或隔离子代理的开关。
- 把 `wait_agent` 描述为 Team 专属等待或共享任务事件等待。
- 暗示内置配置默认提供 `interrupt_agent`。
- 为了共享任务板而要求 SDD 复用同一实现者或审查者，破坏全新上下文隔离。
- 把活跃子代理容量写成累计 Session 历史上限。

## 6. 已考虑的方案

### 方案 A：按统一子代理树重写（已选择）

根说明先定义普通子代理树，再说明 Team 是可选共享任务板。两个下级部分分别介绍普通子代理完整链路和 Team 增量能力，但不再代表两套身份。

优点是符合 RC2 真实架构，能自然保留 SDD 的临时工作者生命周期，并消除旧版所有盲后台与累计名册误导。代价是章节结构和措辞需要较大调整。

### 方案 B：保留原两章，仅更新事实

保留“Ordinary subagent mode”和“Agent Teams mode”作为两个模式，再逐条修正工具名和参数。

改动较小，但仍会暗示两种成员身份和两种工作生命周期，不利于解释“Team 开启时普通 SDD 子代理就是 teammate”这一核心事实，因此不采用。

## 7. 目标文档结构

保留文档标题、工具映射表、Skills、Task lists 和 Background work 的现有位置。重写 Subagents 整节，并只对其他章节做必要的一致性修改。

### 工具映射表

将“Dispatch a subagent”改为按上下文和任务需要选择：

- 全新独立上下文：`subagent`
- 需要继承当前会话：`subagent_fork`
- 大规模计划扇出：`workflow`
- 共享任务板：根会话启用 Team 后使用 `team_task_*`，不把它写成另一种创建入口

删除 `spawn_teammate`、持久 Team 角色专用路由和成员上限提示。

### `## Subagents and Agent Teams`

根说明采用一个核心定义：

> 普通子代理树负责创建、身份、发现、消息、等待与生命周期；Agent Teams 在这棵树上增加共享任务板。Team 开关不改变子代理的创建方式或成员身份。

工具可见性只用于判断当前可调用的能力，不再用于推断两套模式：

| 可见能力 | 应得出的结论 |
| --- | --- |
| `subagent` 或 `subagent_fork` | 可以直接创建子代理 |
| `team_task_create` 等四个任务工具 | 当前根会话已启用 Team，可使用共享任务板 |
| `interrupt_agent` | 当前组合允许中断后代；不可见时不能臆造该能力 |
| 直接创建工具均不可见 | 直接完成工作，或仅在 Workflow/Ralph 自身条件满足时使用它们 |

同时写明：不同部署可裁剪工具，读者必须看实际工具列表，不能根据 preset 名称或 Team UI 猜测。

### `### 1. Subagent tree`

#### 创建、上下文与名称

- `subagent`：全新上下文、自包含 prompt、立即返回名称。
- `subagent_fork`：继承已完成轮次，不含当前进行中轮次。
- 名称在同一创建者的 children 中唯一；根名称为 `lead`，嵌套名称形成 `reviewer/checker` 路径。
- 启动回执是 `started subagent <name>`，最终结果由完成通知交付。
- 保持异步并行派发、不忙碌轮询、完成通知唤醒的规则。

#### 发现、消息与续作

- `list_agents`：无 `scope`，列出整棵树的 `lead`、调用者和所有可达 continuable descendants。
- 行结构为 `name`、`status`、`description?`；不可读分支以状态报告。
- `send_message({ agent, message })`：同一棵树内任意其他成员都可寻址，名称或 Session ID 均可。
- 工作目标在最近步骤边界接收；inactive 目标启动或恢复；返回值是收件箱接受，不是答复。
- SDD 修复轮 1–3 优先续聊原实现者；无法控制时按既有技能规则使用新实现者、brief、report 和 open findings。

#### 等待与完成

- `wait_agent` 属于普通子代理控制工具，与 Team 开关无关。
- 它等待调用者自己的下一步收件箱，包括消息、完成通知和用户 steering。
- 它不等待其他代理状态、其他收件箱、下一回合消息或任务板变化。
- `timedOut: false` 只表示有待交付输入，不是任务完成证明。
- 任务更新后需要他人行动时，必须显式 `send_message`。
- 不把 `wait_agent` 变成忙碌轮询循环。

#### 中断、容量与深度

- `interrupt_agent` 使用 `agent`，只能由祖先中断后代。
- base 和 Web standard/cordis/ptc 默认 `interrupt: false`，因此默认工具集中没有它；只有实际可见才使用。
- 本地目标只停止当前轮次，保留排队输入与 descendants；外部执行永久停止。
- `maxActiveSubagents` 默认限制同一树中同时存活或实体化的 activation 为 8，cleanup 后释放，不限制累计 Session 历史。
- 委派深度限制与 Team 开关独立；编排器必须仍有创建实现者和审查者的深度余量。

#### 后端差异

保留本地 Spawn/Fork 可续作与外部后端一次性执行的差异，不把所有 backend 都写成支持冷恢复。

### `### 2. Agent Teams shared task board`

#### 开关与作用域

- Team 包随 base-backed profiles 提供，不再是独立实验插件安装模型。
- 新根 Session 默认关闭；根会话菜单保存选择并持久化，descendants 共享根的实时选择。
- `defaultEnabled` 可改变新根默认值，但标准 bundle 默认仍为 false。
- ordinary fork 形成独立根，默认不继承 Team 开启状态。
- 历史任务板在没有显式选择时保持启用的兼容行为只简要注明，不扩展成迁移教程。

#### 开启后的增量能力

只增加四个工具和 Team policy：

- `team_task_create`
- `team_task_list`
- `team_task_get`
- `team_task_update`

明确没有 `spawn_teammate`，也没有 Team 专属 `list_agents`、`send_message`、`wait_agent` 或 `interrupt_agent`。普通工具保持同一 schema 和身份体系。

#### 关闭后的行为

- 四个任务工具和 Team policy 在后续步骤隐藏。
- 子代理不停止，任务记录不删除，普通控制工具不变。
- 任务板操作在关闭状态下拒绝，重新开启后恢复。
- 已进入的任务操作可完成，排队操作在开始执行时检查当前模式。
- 不把 UI 关闭确认流程写成模型工具链的一部分。

#### 任务板能力与纪律

- 根代理 `lead` 与任意深度 continuable descendants 都可成为任务 owner。
- owner 参数接受 `lead`、完整名称路径或 Session ID；结果使用名称或 ID。
- root 可 reassign 到自己或任意 continuable descendant，其他成员只能按权限 claim ready tasks。
- 保留 list → get → 当前 revision claim → work → 最新 revision complete。
- 保留 DAG blockers、CAS、八种 update 动作、maxTasks 默认 256、deleted tombstone、分页与 owner/unowned 互斥过滤。
- write scopes 是提示而非锁；共享 cwd 不附带 worktree 隔离、自动合并或自动 owner 释放。
- 任务变化不会唤醒 `wait_agent`，需要行动时显式消息。

### Workflow、Ralph 与技能

- Workflow 仍用于大规模计划扇出，其内部运行不作为 Team 任务板的自动管理对象。
- Ralph 仅在用户明确要求 Ralph 或 fresh-agent 迭代执行时使用。
- SDD 在 Team 开关两种状态下都使用 fresh `subagent` 实现者、审查者、复审者和最终审查者。
- Team 开启只增加共享任务协调，不改变 SDD 的上下文隔离要求，也不要求开启 Team。
- 低成本编排继续使用普通 `subagent` orchestrator；补充 delegation-depth 条件。
- 保留 “Rulings I made” 原样转交要求。

### Background work

- 启动回执改为 `started subagent <name>`。
- `wait_agent` 写成普通收件箱等待，不再附加 Team 专属等待说明。
- 保留完成通知和后台 job 工具的不同收集方式。

## 8. 明确删除或替换的旧内容

| 旧内容 | 新处理 |
| --- | --- |
| `spawn_teammate` 创建团队成员 | 删除；创建统一使用 `subagent` / `subagent_fork` |
| 持久 Team 名册与 `maxMembers: 8` | 删除；只讲统一子代理树和活跃容量 |
| Team 版 `target`、旧版 `agent_id` | 统一为 `agent`，名称或 Session ID |
| Team 版遮蔽 legacy 控制工具 | 删除；同一控制工具与 Team 开关无关 |
| Team 中普通子代理是盲后台执行 | 删除；统一发现、消息和续作 |
| Team 默认九工具 | 改为普通工具不变，Team 只增加四个任务工具 |
| `wait_agent` 等待 Team 事件、`noProgress` | 改为普通收件箱等待，仅返回 `timedOut` |
| Team 默认 `interrupt_agent` | 改为默认配置不暴露，按实际工具可见性使用 |
| 持久角色 Team、临时执行 subagent | 改为子代理生命周期与 Team 开关彼此独立 |
| Team 只用于持久协作角色 | 删除该限制；fresh SDD workers 在 Team 开启时同样是 teammates |

## 9. 文件与生成关系

批准后只修改：

1. `references/dsh-tools.md`：英文权威母本。
2. `skills/using-superpowers/references/dsh-tools.md`：通过 `node scripts/generate-artifacts.mjs` 生成的同步副本。

设计文档本身只用于本次审阅，不进入运行时工具映射。中文完整翻译在回复中提供，不新增第二份需要同步维护的仓库文档。

当前 PR #4 已合并，工作区在 `main`。批准设计后另建文档分支和实施计划；不在 `main` 上直接提交或推送。

## 10. 验证设计

### 静态与生成校验

- 旧文档先对 RC2 必需场景检查失败，再在新文档通过，保留 RED/GREEN 证据。
- 母本与生成副本逐字一致。
- `node scripts/generate-artifacts.mjs --check` 通过。
- `git diff --check` 通过。
- 记录基线 `npm run verify`，再运行修改后的同一命令；若存在失败，必须区分基线失败与新增失败，不预先归因。

### 独立文档场景审查

让未参与写作的审查者只读新文档，逐项回答：

1. Team 关闭时执行六个任务的 SDD，如何创建实现者和审查者，是否存在累计 Team 名额墙？
2. Team 开启后，同样的 fresh workers 是否出现在 `list_agents`，如何续聊原实现者？
3. 根会话关闭 Team 后，子代理、任务、四个任务工具和 `wait_agent` 分别怎样变化？
4. 如何向 `reviewer/checker` 发消息，参数是什么，返回的是答复还是收件箱接受？
5. 任务完成后为什么 `wait_agent` 没有醒来，下一步应做什么？
6. 默认配置没有 `interrupt_agent` 时，文档是否避免要求调用它？
7. 活跃容量达到 8 与累计 Session 数量之间有什么区别？
8. 没有直接创建工具但 Workflow 可见时，何时仍可执行扇出？
9. orchestrator 何时可以下沉整个 SDD 循环？

### 合并前审查

- 一名 fresh-context 审查者对照 RC2 源码和本设计检查最终 diff。
- 阻塞项：任何已删除工具被写成可用、任何双身份/双控制链残留、任何 SDD 隔离语义被破坏、任何开关行为错误。
- 必须审查两个目标文件的一致性和非目标文件未受影响。

## 11. 留给实施者的决定

以下不会改变设计目标，实施者可在写作时决定：

- 各表格与段落的精确措辞和排序。
- 为控制总长度，将极少使用的配置细节压缩为一句提示。
- 是否将“历史任务板隐含启用”保留为一句兼容性说明。
- 新文档分支名称、提交信息和后续 PR 标题。

不需要实施者自行决定：统一身份模型、工具参数、开关语义、SDD 生命周期、验证场景或旧内容删除范围；这些已经在本设计中锁定。

## 12. 批准门槛

用户批准本设计后，才调用 `writing-plans` 制定具体实施计划。设计批准不授权直接改写工具映射、提交或推送；后续按批准后的计划和用户指令执行。
