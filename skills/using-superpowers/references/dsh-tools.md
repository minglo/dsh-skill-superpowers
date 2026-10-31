# DeepSeek Harness (dsh) Tool Mapping

Skills speak in actions ("dispatch a subagent", "create a todo", "read a file").
On the DeepSeek Harness these resolve to the tools below. The same mapping is
inlined into the bootstrap the plugin injects each session — this file is the
source for both.

| Action skills request | dsh equivalent |
| --- | --- |
| Invoke a skill | The `skill` tool, with the exact kebab-case name (`brainstorming`, `test-driven-development`) |
| Create a todo / mark complete (`TodoWrite`) | `todo_write` |
| Read a file | `read` |
| Create a file | `write` |
| Edit a file | `edit` |
| Run a shell command (`Bash`) | `bash` on Unix, `pwsh` on Windows; `run_in_background: true` for long commands, then `job_output` / `job_kill` |
| Search file contents (`Grep`) | `grep` |
| Find files by name (`Glob`) | `glob` |
| Fetch a URL (`WebFetch`) / search the web | `web_search`, then `web_fetch` for one specific page |
| Dispatch a subagent (`Task`, `Subagent`) | Choose by work lifecycle. Use `subagent` for fresh, short-lived implementers, reviewers, and other one-shot work, even when Team tools are visible. Use `spawn_teammate` for durable Team roles that need ongoing coordination. Use `subagent_fork` when the child must inherit this conversation, and `workflow` for large planned fan-outs. See “Subagents” for the Team visibility and member-limit boundaries. |
| Ask your human partner a question | `ask_user_question` |
| Present a plan for approval | dsh plan mode — `exit_plan_mode` hands the plan to your human partner |
| Track a long-running objective | `create_goal`, `get_goal`, `update_goal` |

## Skills

dsh has a native skill system: this plugin registers Superpowers' `skills/`
directory into the skill registry, so the skill catalog the session receives
lists every Superpowers skill and the `skill` tool loads one by name.
Names carry no `superpowers:` prefix on dsh — `superpowers:brainstorming` in
older prose is simply `brainstorming` here.

Loading a skill's `SKILL.md` with `read` is **not** the mechanism on dsh. Use the
`skill` tool; it returns the same body plus the base directory that the skill's
relative resources (`scripts/…`, `references/…`, `*-prompt.md`) resolve against.

The `using-superpowers` skill is injected as the session's bootstrap and is
already active — do not spend a `skill` call re-loading it.

## Subagents

Read your actual tool list, then route by both **tool availability** and **work
lifecycle**. Tool availability determines which schemas and control chains you
can use. Work lifecycle determines whether the task should create a durable
teammate or a short-lived ordinary subagent.

Do not infer the delegation mode from a session title, a preset name, or the
presence of `list_agents`, `send_message`, or `interrupt_agent`: those control
names have different schemas and semantics in the ordinary-subagent and Team
surfaces.

| What you see | Available routing |
| --- | --- |
| `spawn_teammate` is visible | Team is available, but is not mandatory for every delegation. Use `spawn_teammate` for durable, ongoing Team roles. If `subagent` is also visible, continue to use it for fresh, short-lived implementers, reviewers, and other one-shot work. Team controls manage only Team members, not ordinary subagent children. |
| `spawn_teammate` is absent, and `subagent` or `subagent_fork` is visible | Use the ordinary subagent chain. Where the legacy controls are visible, use `agent_id` session ids. |
| Neither `spawn_teammate` nor `subagent`/`subagent_fork` is visible | There is no direct child/teammate creation tool. Carry out the work directly, or use an independently visible execution surface such as `workflow` or `ralph` only when its own usage conditions are met. Do not invent delegation or control tools. |

**The central rule is: durable roles use Team; temporary execution units use
ordinary subagents.** Do not convert a fresh-per-task or fresh-per-review worker
into a durable teammate merely to make it visible in the Team roster.

Agent Teams replaces host-level ordinary direct-delegation and global-control
tool registrations. It does not semantically replace every ordinary-subagent
use case. Its durable, cumulative roster is designed for ongoing collaboration,
not for an unbounded sequence of temporary workers.

The Agent Teams profile disables four host-level plugin rows that would
otherwise expose five tool names: `subagent`, `subagent_fork`, and the legacy
global `list_agents`, `send_message`, and `interrupt_agent`. This disables
model-facing registrations at that layer; it does not remove the underlying
subagent service or the Spawn and Fork providers.

The shipped Web/Desktop `standard` preset separately registers the ordinary
subagent delegation and control tools in preset scope. Desktop uses the Web
profile template, so this is not limited to a browser-only or user-customized
preset. Consequently, when Agent Teams is enabled with that preset,
`spawn_teammate`, `subagent`, and `subagent_fork` can all be visible without any
customization.

Team tools are installed in each Team member's exact Agent scope. The Team
versions of `list_agents`, `send_message`, and `interrupt_agent` shadow the
inherited legacy definitions for that member:

- Team `list_agents` takes no `scope` and lists only the Lead and durable
  teammates.
- Team `send_message` takes `target`, not `agent_id`, and addresses Team members.
- Team `interrupt_agent` takes `target`, not `agent_id`, and is Lead-only.

An ordinary child created with `subagent` inside a Team-capable session does not
thereby become a teammate. It has no Team membership, receives no Team-scoped
tools, and does not appear in the Team roster. The Lead's Team `list_agents`,
`send_message`, `wait_agent`, and `interrupt_agent` cannot discover, steer,
wait for, or interrupt that ordinary child through Team identity.

`workflow` and `ralph` are independent execution surfaces, not mode selectors.
Use `workflow` for large planned fan-outs and `ralph` only for an explicit Ralph
or fresh-agent iterative-execution request. Their presence neither proves nor
removes either direct delegation mode. Always use only the tools actually
visible in the current request.

### 1. Ordinary subagent mode and temporary work

Use the ordinary subagent chain when `spawn_teammate` is absent and `subagent`
or `subagent_fork` is visible. Also keep using `subagent` for fresh, temporary
work when Team tools are visible; Team availability does not change the
lifecycle requirements of the task.

The baseline chain is:

**start a managed child → continue other work → receive its completion notice.**

Continuable local children additionally support discovery, follow-up messages,
and interruption when the caller can see the legacy controls. The ordinary
subagent surface has no `wait_agent` and no shared Team task board. In a
Team-capable session, the Lead's visible same-name controls are Team versions
and cannot manage an ordinary child.

| Tool | Capability |
| --- | --- |
| `subagent` | Starts a fresh child through its configured provider. The child works in its own context and needs a complete, self-contained prompt. An optional `cwd` selects its initial working directory; later directory changes in parent and child are independent. Use this for fresh, short-lived implementers, reviewers, and other one-shot work, including when Team tools are visible. |
| `subagent_fork` | Starts a child seeded with all completed turns of the current conversation, excluding the current in-flight turn. Use it for follow-up analysis, review, or continuation that builds on this conversation without consuming the parent's context with the work itself. It is not the default for a skill that requires a fresh, isolated worker context. |
| `list_agents` | Legacy ordinary-subagent discovery, when not shadowed by a Team definition. `children` is the default and lists direct children; `descendants` lists the reachable tree with each entry's direct-parent session id and depth. Only continuable children appear as normal child rows, with durable ids, labels, and `running` or `inactive` status. One-shot and external entries are omitted from those rows. Descendant traversal can pass through readable non-external catalogs; external entries are leaves, and unknown or unreadable branches can produce diagnostics. Direct children accept `send_message`; entries deeper than one accept only `interrupt_agent`. |
| `send_message` | Legacy ordinary-subagent messaging, when not shadowed by a Team definition. Sends to a direct continuable child by `agent_id`, or to the direct parent when the caller is a resident continuable child. A working target receives the message at its nearest step boundary; an inactive target starts or resumes a turn. It returns inbox acceptance and a `messageId`, never the target's answer. Siblings and deeper descendants are not valid message targets. |
| `interrupt_agent` | Legacy ordinary-subagent interruption, when not shadowed by a Team definition. Requests interruption of a direct child or deeper descendant created under the caller by `agent_id`. For a local child, it stops only the current turn, preserves queued input and descendants, and leaves the child available for later follow-up. An external execution stops permanently and cannot receive follow-ups. Acceptance does not mean the target has already become quiet. |
| `list_subagent_models` | Conditional, not part of the default set. When subagent model selection is enabled, it discovers allowed child provider/model routes and their reasoning efforts. The same policy can add `provider`, `model`, and `reasoning_effort` fields to delegation calls. |

#### Delegation and result delivery

`subagent` and `subagent_fork` start independently managed activations and
return a child id immediately. The start acknowledgement is not the child's
result. The runtime owns execution, outcome reporting, and resource cleanup;
you receive the final answer through a completion notice, not through the start
tool's return value and not by watching the child's intermediate steps.

Start independent delegations together in one assistant message and continue
useful work while they run. A busy parent receives a completion notice at its
next step; an idle parent is woken by it. Never busy-poll a child and never sleep
to re-check one. When nothing but a child's result remains, end the turn and let
the notice start the next one.

In-process Spawn and Fork children are continuable when their controls are
visible: they can report with `send_message`, accept follow-up work while
active, and resume after settling. External backends such as Codex, Claude Code,
ACP, and DSH SDK executions are one-shot from the parent's control perspective:
their completion notice carries the final answer, and they do not accept
follow-up messages.

Ordinary subagent capacity is not a cumulative Session-history limit. The
default `maxActiveSubagents` value is eight simultaneous live or materializing
activations in an activation tree. Cleanup releases those slots, so completed
work does not permanently consume the capacity for later children.

A configured delegation-depth cap remains enforced even when the creation tool
is visible. At the cap, do the work directly instead of attempting another
delegation. Optional child presets and model-route fields are available only
when the deployment exposes them; otherwise, use the configured or inherited
child composition and route.

#### Temporary work inside a Team-capable session

When you deliberately use `subagent` for temporary work in a Team-capable
session, treat it as **blind background execution from the Lead's Team
controls**. Continue other work and rely on the completion notice. Do not try to
list, message, wait for, or interrupt that child through Team tools, and do not
assume that it shares the Lead's Team task board.

This is a visibility and continuation tradeoff, not a reason to turn every
temporary worker into a teammate. If the original worker cannot receive a
follow-up through the Lead's visible controls, continue the work through a fresh
ordinary child and persistent task artifacts rather than through Team identity.

For `subagent-driven-development` fix rounds 1–3, resume the original
implementer when the available controls permit it. If the harness cannot send
another message to that worker, dispatch a fresh implementer with the task brief
path, the report-file path, and the open findings. The report file is the
persistent memory either way. Rounds 4–5 continue to use a fresh implementer on
a more capable model according to the skill. Scoped re-reviews remain fresh,
independent review tasks.

#### Skill-driven delegation

Superpowers' `subagent-driven-development`, `dispatching-parallel-agents`, and
`requesting-code-review` skills work with either `subagent` or `subagent_fork`,
selected according to their context requirements.

For `subagent-driven-development`, preserve the fresh-worker lifecycle even when
Team tools are visible:

- Dispatch a fresh ordinary `subagent` implementer per task.
- Dispatch a fresh ordinary `subagent` reviewer for each task review and scoped
  re-review.
- Use fresh ordinary children for fix dispatches when the original implementer
  cannot be resumed through the available controls.
- Dispatch the broad final review as a fresh ordinary child.

Do **not** reinterpret these fresh-per-task and fresh-per-review dispatches as
`spawn_teammate` calls. Use Team only when the work explicitly calls for a
durable role and ongoing Team coordination.

For a large planned fan-out, `workflow` runs a JavaScript orchestration script
whose `agent`, `pipeline`, `parallel`, and phase facilities coordinate many
subagent runs. It is separate from the direct-child control chain; use it when
the plan calls for that scale of orchestration rather than reproducing it with
manual polling.

#### Cheaper orchestration for subagent-driven development

The controller session is the most expensive seat in a
`subagent-driven-development` run: it reads every dispatch result and every
report, and it usually runs on the session's most capable model. dsh can run the
whole loop one layer down.

When your human partner asks for it — or says the session model is too expensive
to spend on coordination — dispatch ONE orchestrator subagent with the plan path
and the instruction to run `subagent-driven-development` end to end. Give that
call a mid-tier `model` and its `provider` when those route fields are visible;
they are exposed only when the deployment enables subagent model selection.
Otherwise, use the inherited or configured route.

The configured delegation depth must allow the orchestrator to create its own
implementers and reviewers. Do not assume that nested delegation is available
when the depth cap has already been reached.

The orchestrator dispatches its own implementers and reviewers according to that
skill's Model Selection guidance. The workspace and ledger live on disk, so no
state is lost to the extra layer. The orchestrator's final message must carry
the **"Rulings I made"** list verbatim. Relay that list to your human partner;
do not summarize it away.

Do this only for a whole plan. Nesting a single task's dispatch buys nothing and
adds a seat.

### 2. Agent Teams mode for durable collaboration

Use `spawn_teammate` when the work needs a durable role with an ongoing identity,
repeated follow-ups, Team-wide messaging, or the shared task board. Do not use
Team merely as a visibility wrapper around temporary implementers and reviewers.

Team mode adds named durable teammates, a Team-wide roster, peer-to-peer
messaging, event waiting, and a durable shared task board.

The standard Agent Teams profile sets `maxMembers: 8`. This is a **cumulative
durable-roster limit**, not a limit of eight simultaneously running teammates.
It counts every teammate the Team has ever created, including failed members.
The Lead is separate from those eight teammate slots.

An `inactive` teammate still consumes a roster slot. Team has no member deletion
or name reuse, so inactivity, completed work, interruption, and failed work do
not free capacity for a later teammate. Raising or budgeting around this limit
does not make Team a drop-in replacement for an unbounded fresh-per-task worker
loop.

The default Team surface contains nine tools. A deployment can disable
`interrupt_agent`; all other Team capabilities remain independent of that
option.

| Tool | Capability in this mode |
| --- | --- |
| `spawn_teammate` | Team Lead only. Creates one named, durable, direct teammate with a unique lower-kebab-case name, a responsibility description, and a complete initial prompt. `fresh` starts without Lead history; `fork` inherits the Lead's completed turns. The initial task is passed unchanged. The result is a roster member and its addressable `target`, not the teammate's completed work. Creation consumes a durable roster slot even after the member becomes inactive. |
| `list_agents` | Lists only the Lead and durable teammates. It takes no `children` or `descendants` scope and does not list ordinary subagent or Workflow children. Rows expose the member `target`, role, availability, provider, context mode, model when available, and diagnostics. Status is `running`, `inactive`, `provisioning`, or `failed`; `inactive` means no turn is executing, not that the task completed or that the roster slot was released. |
| `send_message` | Sends to another Team member by `target`, including the Lead or a sibling. It does not accept an ordinary subagent's `agent_id`. Any member can message any other Team member. A running target receives the message at its nearest step boundary; an inactive target starts or cold-resumes a turn. `{ sent: true }` confirms inbox acceptance, not recipient processing or a reply. |
| `wait_agent` | Waits for the next Team member-status, incoming-message, or shared-task change that occurs after the call starts. It does not observe ordinary subagent or Workflow execution. The default timeout is 30 seconds; allowed values range from 10 seconds through one hour. It never wakes an inactive member and returns `noProgress` immediately when no other Team member is running or provisioning. It reports a Team change or timeout, not the work result itself. |
| `interrupt_agent` | Team Lead only; present by default. Interrupts one durable teammate by `target`, preserving its pending inbox. It does not accept an ordinary subagent's `agent_id`. It returns the teammate's previous availability, does not release task ownership, roster capacity, or durable mail, and does not imply that all descendant work has stopped. |
| `team_task_create` | Creates one unowned pending shared task with a subject, complete details and acceptance criteria, optional blocker task ids, and optional advisory workspace-relative write scopes. |
| `team_task_list` | Lists non-deleted shared tasks with owner, revision, blockers, readiness, and write-scope-overlap warnings. Supports exact status, owner, and readiness filters plus cursor/limit pagination. |
| `team_task_get` | Reads the complete latest value of one shared task before changing or executing it, including a deleted task's retained tombstone. |
| `team_task_update` | Mutates a task with compare-and-set using `expected_revision`. Actions are `claim`, `release`, `edit`, `set_dependencies`, `complete`, `reopen`, `reassign`, and `delete`. Only the Lead can reassign. A stale revision is rejected rather than overwriting newer work. |

#### Creation, context, and roster

Team creation uses the same underlying Spawn and Fork providers as ordinary
subagents, but adds Team identity, durable roster state, and Team-scoped tools.
Only the Lead creates teammates, and every teammate is a direct member of the
same flat Team. Teammates cannot create a nested Team through
`spawn_teammate`.

A fresh teammate needs a self-contained task. A fork teammate inherits the
Lead's completed-turn prefix, so its prompt should build on that context and
state what is new. Teammate names are durable addresses; use the `target`
returned by `spawn_teammate` or `list_agents` for Team messaging, interruption,
and task ownership.

An ordinary subagent created beneath the Lead has a provider-owned subagent
descriptor but no durable Team roster entry. Team membership resolution
therefore returns no Team identity for it: it is neither promoted to teammate
nor treated as a nested Team Lead. Team tools are not installed for that child.

The Lead and all teammates share the same working directory and filesystem.
Edits are immediately visible to every Team member. Team mode does not provide
separate worktrees, filesystem locks, remote members, or automatic merging.

Persistent role reuse is a legitimate Team-native workflow, but it is not
semantically equivalent to `subagent-driven-development`. Reusing one implementer
or reviewer across many tasks retains that member's conversation context and
changes the skill's fresh-worker isolation guarantees. Adopt that model only
when persistent roles are an explicit design choice, not as an undocumented
way to evade the member limit.

#### Messaging and waiting chain

The normal Team chain is:

**Lead spawns a durable teammate → the teammate performs its assigned role →
Team members exchange explicit reports or follow-ups with `send_message` → a
waiting member uses `wait_agent` for the next Team change → the caller re-reads
current Team state.**

Use `list_agents` to inspect the Team roster before waiting. If a required
teammate is inactive, use `send_message` to start or resume it first;
`wait_agent` cannot wake it. After a wakeup or timeout, re-list the roster and
inspect the task board or newly received messages as appropriate. Do not turn
`wait_agent` into a busy-polling loop.

A successful send means that the target Team inbox accepted the message. It does
not prove that the recipient processed it. A teammate's report is another
explicitly addressed Team message, not the return value of the original send.
The Lead must wait for required teammates before giving the final answer.

Unlike ordinary subagent mode, Team mode has an explicit Team-event wait tool.
It is not a generic wait for every descendant execution, and it does not return
the teammate's final content.

#### Shared task board and workspace safety

Use the shared-task workflow in this order:

**list → get → claim with the current revision → perform the work → complete
with the latest revision.**

A task is ready only when all its blockers are complete. Readiness never starts
or wakes its owner. Task dependencies order the work; they do not create agents
or assign execution. Inactivity, interruption, and failed work do not
automatically release ownership.

Split write work into disjoint scopes and record expected write scopes on shared
tasks. Write-scope overlap produces warnings, not locks or write authorization.
If a file operation returns `FS_STALE_VERSION`, read the current file, rebase the
intended change onto it, and retry.

Prefer `read`, `edit`, and `write` for file changes. Bash, formatters, code
generators, and external scripts are not fully protected by the filesystem
version guard, so coordinate them explicitly. The Lead reviews the final diff
and runs the tests.

#### Workflow and Superpowers skills

Workflow remains available in the standard Team profile, but it is independent
of Team membership. Its `agent()` calls create fresh one-shot children with
self-contained prompts; those runs are not durable teammates and do not consume
Team roster slots. Do not expect the Team roster, Team messaging, `wait_agent`,
or the shared task board to manage Workflow's internal runs.

Superpowers' `subagent-driven-development`, `dispatching-parallel-agents`, and
`requesting-code-review` skills do not change their worker-lifecycle requirements
merely because Team tools are visible.

Where a skill requires a fresh implementer, reviewer, re-reviewer, or final
reviewer, use the ordinary `subagent` chain described above, even in a
Team-capable session. Where work explicitly requires a durable coordinating
role, use `spawn_teammate` and the Team chain. Pass the complete task text and
the review prompts named by the skill, and preserve the skill's requirements for
context isolation, reports, and review independence.

Do not apply the ordinary-subagent cheaper-orchestration recipe literally to
`spawn_teammate`: Team creation does not expose the ordinary subagent
model-route fields. Use the ordinary-subagent orchestration route when that
recipe is selected, subject to its delegation-depth requirements.

## Task lists

`todo_write` is dsh's task list. Superpowers skills that mention `TodoWrite` (or
"create a todo per item") mean this tool: send the complete list on every call,
one item per checklist entry, and mark an item complete the moment it is done.

## Background work

Long shell commands and ordinary subagents run concurrently and report back by
notice. `bash` / `pwsh` take `run_in_background: true`; an ordinary `subagent`
returns `started subagent <childId>` at once and never waits for the child. A
finished job or ordinary child posts a completion notice into the session — a
busy agent receives it on its next step, an idle one is woken by it — so the
result arrives without you asking.

So: **never busy-poll a task and never `sleep` to re-check one.** When nothing
but an ordinary child's result is left, end your turn; the notice starts the
next one. `job_output` (`wait: true` only when genuinely blocked), `job_list`,
and `job_kill` are for collecting, listing, and cancelling work — not for
watching it.

Team coordination additionally provides the explicit `wait_agent` Team-event
wait described above. Use it for durable Team members and shared-task changes,
then re-read Team state; do not treat it as a generic ordinary-child or Workflow
completion wait, and do not repeat it as a busy-polling loop.
