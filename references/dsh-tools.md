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
| Dispatch a subagent (`Task`, `Subagent`) | Use `subagent` for a fresh, isolated child or `subagent_fork` when the child must inherit this conversation. Use `workflow` for large planned fan-outs. When the root Session enables Agent Teams, coordinate that same subagent tree through `team_task_*`; Team does not provide another creation path. |
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

## Subagents and Agent Teams

A root Session owns one **subagent tree**. That tree owns creation, identity,
discovery, messaging, inbox waiting, and lifecycle. **Agent Teams adds a durable
shared task board and coordination guidance to that same tree; it does not add
another member identity or control system.** Enabling or disabling Team does not
change how children are created, named, discovered, or contacted.

Read the actual tool list rather than inferring capabilities from a preset name
or the Team UI. Deployments and child presets can expose different tools.

| Visible capability | What it means and how to route |
| --- | --- |
| `subagent` or `subagent_fork` | Direct delegation is available. Choose by the child's required context, not by Team state. |
| `team_task_create`, `team_task_list`, `team_task_get`, and `team_task_update` | The caller's root Session currently has Team mode enabled. Use the shared board in addition to the ordinary subagent controls. |
| `interrupt_agent` | This composition permits ancestor-initiated interruption. Do not assume it exists when it is absent. |
| Neither direct creation tool is visible | Carry out the work directly, or use an independently visible execution surface such as `workflow` or `ralph` only when its own usage conditions are met. Do not invent delegation or control tools. |

The ordinary controls and the four Team task tools are independent capabilities.
The Team switch never changes the schemas of the ordinary controls.

### 1. Subagent tree

The baseline chain is:

**start a managed child → continue useful work → receive its completion notice.**

Local continuable children also support tree discovery, follow-up messages, and
inbox waiting. These controls remain ordinary subagent controls whether Team is
on or off.

| Tool | Capability |
| --- | --- |
| `subagent` | Starts a fresh child through its configured provider. Supply a complete, self-contained prompt and a short description. An optional `cwd` selects its initial working directory; later directory changes in either agent are independent. |
| `subagent_fork` | Starts a child seeded with all completed turns of the current conversation, excluding the current in-flight turn. Use it when new work should build on this context rather than when a skill requires an isolated fresh worker. |
| `list_agents` | Lists the root `lead`, the caller, and every reachable continuable descendant in the same tree. Rows contain `name`, `status`, and an optional description; there is no `scope` argument. |
| `send_message` | Sends to another agent in the same tree with `send_message({ agent, message })`. `agent` accepts a returned name such as `reviewer/checker` or a Session id. |
| `wait_agent` | Waits for input at the exact caller's next-step inbox. This is an ordinary subagent control and does not depend on Team mode. |
| `interrupt_agent` | Conditional on the composition. Uses `agent` and interrupts only a descendant of the caller. Built-in base and Web standard/cordis/ptc configurations set `interrupt: false`, so the tool is absent unless explicitly enabled. |
| `list_subagent_models` | Conditional on model discovery being enabled. Discovers authorized child provider/model routes and reasoning efforts; the same policy can expose `provider`, `model`, and `reasoning_effort` on delegation calls. |

#### Creation, context, and names

`subagent` and `subagent_fork` start independently managed activations and
immediately return `started subagent <name>`. This acknowledgement is not the
child's result. The runtime owns execution, outcome reporting, and cleanup. If
you are still online when the child finishes, it automatically delivers a
completion notice. The notice includes the final answer unless the child sent
you a message just before finishing; in that case, use the child's closing
message as the result and `send_message` if more work is needed. A parent that
is offline when the child finishes does not receive that automatic delivery, so
do not assume a completion notice was queued. After reconnecting, use the
child's available Session history to recover its recorded result, or ask a
continuable child for the result with `send_message`; a one-shot external
execution cannot be resumed for a new answer.

The root agent is named `lead`. Each child name is unique among its creator's
children. A nested descendant has a root-relative path such as
`reviewer/checker`; omitted names use the first free `agent-N`. Names are the
normal way to address messages, interruption, and Team task owners, while
Session ids remain accepted for historical or unnamed entries.

Start independent delegations together in one assistant message and continue
useful work while they run. A busy parent receives completion at its next step;
an idle parent is woken by it. Never busy-poll a child and never sleep to
re-check one. When only a child's result remains, end the turn and let the notice
start the next one.

#### Discovery and messaging

`list_agents` reports `running` or `inactive` from live turn activity. `inactive`
means no turn is executing, not completion, success, failure, or a released task
owner. One-shot and external entries do not appear as continuable rows. External
entries are traversal leaves; unreadable branches can report `corrupt`,
`unsupported`, or `unavailable` while the row itself remains a member.

A working message recipient receives input at its nearest step boundary. An
inactive recipient starts or cold-resumes a turn; only that recipient resumes,
not its creation ancestors. A successful send returns inbox acceptance and a
`messageId`, never the recipient's answer. Self-messages, unrelated trees,
unsupported recipients, and rejected admission fail explicitly.

Use `send_message` to steer an active local child or continue it after it
settles. External backends such as Codex, Claude Code, ACP, and DSH SDK
executions are one-shot from the caller's control perspective: they do not
accept follow-up messages, and any completion delivery follows the same online
and closing-message rules.

#### Inbox waiting and completion

`wait_agent` waits for the caller's own next-step inbox, including agent
messages, completion notifications, and user steering. Pending input returns
immediately unless an earlier wait in the same model tool call already reported
it. Later input ends the wait; other agents' status changes, unrelated inboxes,
queued next-turn messages, and Team task changes do not.

The tool does not consume input or start an agent. `timedOut: false` means new
input is pending, which is delivered to the model after code execution finishes;
it does not prove that a particular task completed. `timeout_ms` defaults to
30000 and accepts integers from 10000 through 3600000.

After a Team task mutation, use `send_message` whenever another agent needs to
act. Task creation, assignment, completion, and mode changes neither add inbox
messages nor release an inbox wait. Do not turn `wait_agent` into a busy-polling
loop.

#### Interruption and backend lifecycle

When `interrupt_agent` is visible, it accepts `agent` and requests interruption
of a direct child or deeper descendant. It is not available for a sibling,
oneself, or an unrelated tree. Acceptance means the stop request was accepted,
not that the target is already quiet.

For a local child, interruption stops only the current turn, preserves queued
input and descendants, and leaves the child available for follow-up. An external
execution stops permanently and cannot receive follow-ups. Descendants that the
interrupted agent started keep running.

#### Capacity and delegation depth

`maxActiveSubagents` limits simultaneous live or materializing activations in a
subagent tree, defaulting to eight. The root consumes no slot. Creation and cold
resume reserve capacity before yielding; disposal returns a slot only after
cleanup. Pending inbox work and stopping activations remain counted, while
sending to an already resident child reuses its slot.

This is a process-local **active-capacity** limit, not a cumulative Session
history limit. Completed work does not permanently consume capacity. At
capacity, creation or cold resume is rejected: wait for an existing child to
finish or continue using an existing agent.

Delegation depth is a separate policy. A depth cap remains enforced even when a
creation tool is visible, and child presets can remove creation tools entirely.
At the cap, do the work directly instead of attempting another delegation.
Optional child presets and model-route fields are available only when exposed by
the deployment; otherwise use configured or inherited values.

#### Skill-driven delegation and fix rounds

Superpowers' `subagent-driven-development`, `dispatching-parallel-agents`, and
`requesting-code-review` skills use `subagent` or `subagent_fork` according to
their context requirements. Team mode does not change those requirements.

For `subagent-driven-development` in either Team state:

- Dispatch a fresh ordinary `subagent` implementer per task.
- Dispatch a fresh ordinary `subagent` reviewer for each task review and scoped
  re-review.
- Preserve fresh context for the broad final review.
- In fix rounds 1–3, resume the original implementer through `send_message`
  when controls permit. If follow-up is unavailable, dispatch a fresh
  implementer with the task brief path, report-file path, and open findings.
- Keep the report file as persistent memory either way. Rounds 4–5 use a fresh
  implementer on a more capable model according to the skill, and every fix round
  receives a fresh scoped re-review.

When Team is enabled, these same fresh workers are teammates in the ordinary
tree and can own shared tasks. When Team is disabled, their creation, discovery,
messaging, and completion semantics are unchanged; only the shared board is
unavailable. Team is optional for SDD and must not replace fresh-worker
isolation with persistent-role reuse.

For a large planned fan-out, `workflow` runs a JavaScript orchestration script
whose `agent`, `pipeline`, `parallel`, and phase facilities coordinate many
subagent runs. Workflow owns its orchestration and result collection; Team mode
does not turn the script into a shared task plan or automatically assign its
internal runs on the board. Use it when the plan calls for that scale rather
than reproducing it with manual polling. Use `ralph` only for an explicit Ralph
or fresh-agent iterative-execution request.

#### Cheaper orchestration for subagent-driven development

The controller session is the most expensive seat in a
`subagent-driven-development` run: it reads every dispatch result and every
report, and it usually runs on the session's most capable model. dsh can run the
whole loop one layer down.

When your human partner asks for it — or says the session model is too expensive
to spend on coordination — dispatch ONE orchestrator `subagent` with the plan
path and the instruction to run `subagent-driven-development` end to end. Give
that call a mid-tier `model` and its `provider` when those route fields are
visible; otherwise use the inherited or configured route. The configured
delegation depth must allow the orchestrator to create its own implementers and
reviewers. Do not assume nested delegation is available when the depth cap has
already been reached.

The orchestrator dispatches its own workers according to the skill's Model
Selection guidance. The workspace and ledger live on disk, so no state is lost
to the extra layer. The orchestrator's final message must carry the **"Rulings I
made"** list verbatim. Relay that list to your human partner; do not summarize it
away.

Do this only for a whole plan. Nesting a single task's dispatch buys nothing and
adds a seat. Team mode does not change this orchestration route.

### 2. Agent Teams shared task board

Agent Teams ships with base-backed profiles. It is a per-root-Session mode, not a
separate experimental profile or a second delegation system. The root Session's
saved selection controls Team tools and guidance throughout its live subagent
tree.

#### Mode selection and scope

New root Sessions, including ordinary forks, default to Team mode off. The root
conversation's Team menu switch saves the selection and preserves it across
restarts. Descendants use their live root's current mode rather than saving
independent selections. An ordinary fork is an independent root and does not
inherit the previous root's enabled state.

The standard bundle's `defaultEnabled` remains false. A deployment can set it to
true for new roots before their first model step; an existing saved selection
takes precedence, and resuming never reapplies the default. For compatibility, a
historical task board without a saved selection remains enabled.

Enabling Team adds only these tools and the shared-task policy:

- `team_task_create`
- `team_task_list`
- `team_task_get`
- `team_task_update`

Creation, discovery, messaging, inbox waiting, and optional interruption remain
the ordinary subagent tools described above. Every root and descendant in an
enabled tree receives the same four task schemas and task policy.

Disabling Team hides those four tools and Team guidance from subsequent steps
throughout the tree. It **retains subagents and task records**, leaves ordinary
controls and `wait_agent` available, and re-enabling restores the existing
board. Task-board operations reject while disabled. An admitted operation
finishes; queued work checks the current mode when it starts. Team operations
require a live root.

The root switch appends the selection before flushing persistence. If that flush
fails, the appended selection remains active; retrying the same selection
flushes without another mode record.

#### Team task tools

| Tool | Capability while Team is enabled |
| --- | --- |
| `team_task_create` | Creates one unowned pending task with a subject, complete details and acceptance criteria, optional blocker task ids, and optional advisory workspace-relative write scopes. The default board limit is 256 non-deleted tasks. |
| `team_task_list` | Lists non-deleted tasks with owner, revision, blockers, readiness, and write-scope-overlap warnings. Supports exact `status`, `owner`, `unowned`, and `ready` filters plus cursor/limit pagination. `owner` and `unowned` cannot be combined. The default limit is 50 and the maximum is 100. |
| `team_task_get` | Reads the complete latest value of one task before changing or executing it, including a deleted task's retained tombstone. |
| `team_task_update` | Mutates a task with compare-and-set using `expected_revision`. Actions are `claim`, `release`, `edit`, `set_dependencies`, `complete`, `reopen`, `reassign`, and `delete`. A stale revision is rejected rather than overwriting newer work. |

Task `owner` arguments accept `lead`, a full root-relative name such as
`reviewer/checker`, or a Session id. Results report the assigned name when one
exists. The root can reassign to itself or any reachable continuable descendant;
other agents claim ready tasks themselves. Historical roster records grant no
authority.

#### Shared-task workflow and dependencies

Use the shared-task workflow in this order:

**list → get → claim with the current revision → perform the work → complete
with the latest revision.**

A task is ready only when all its blockers are complete. Readiness never starts
or wakes its owner. Dependencies order work; they do not create agents or assign
execution. Inactivity, interruption, process exit, and failed work do not
automatically release ownership.

After changing a task, explicitly message any agent that needs to act on the
update. Task changes do not end `wait_agent`, add inbox messages, or start idle
agents.

#### Shared workspace safety

The root and all descendants in the tree share the same working directory and
filesystem, and edits are immediately visible. Team does not provide separate
worktrees, filesystem locks, remote members, or automatic merging.

Split write work into disjoint scopes and record expected write scopes on shared
tasks. Overlap produces warnings, not locks or write authorization. If a file
operation returns `FS_STALE_VERSION`, read the current file, rebase the intended
change onto it, and retry.

Prefer `read`, `edit`, and `write` for file changes. Bash, formatters, code
generators, and external scripts are not fully protected by the filesystem
version guard, so coordinate them explicitly. The root reviews the final diff
and runs the tests.

#### Team mode and Superpowers skills

Team mode adds shared-task coordination to ordinary subagent work; it does not
replace the lifecycle required by a skill. Fresh SDD implementers, reviewers,
re-reviewers, and final reviewers remain fresh `subagent` children in either
Team state. Use the board when shared ownership and dependencies help, but do
not require Team for SDD and do not treat task readiness as a dispatch trigger.

Workflow and Ralph remain independent execution surfaces. Their presence does
not imply that Team is enabled, and Team mode does not move their orchestration
onto the shared board automatically.

## Task lists

`todo_write` is dsh's task list. Superpowers skills that mention `TodoWrite` (or
"create a todo per item") mean this tool: send the complete list on every call,
one item per checklist entry, and mark an item complete the moment it is done.

## Background work

Long shell commands and ordinary subagents run concurrently and report back by
notice. `bash` / `pwsh` take `run_in_background: true`; an ordinary `subagent`
returns `started subagent <name>` at once and never waits for the child. A
finished job posts a completion notice into the session. If you are still online
when an ordinary child finishes, the runtime delivers its completion notice,
including the final answer unless the child sent you a message just before
finishing; in that case, the child's closing message carries the result. An
offline parent does not receive automatic delivery, so do not assume a notice
was queued: after reconnecting, use the child's available Session history or
ask a continuable child for the result with `send_message`. A busy agent
receives a delivered notice on its next step, and an idle one is woken by it.

So: **never busy-poll a task and never `sleep` to re-check one.** When nothing
but an ordinary child's result is left, end your turn; the notice starts the
next one. `job_output` (`wait: true` only when genuinely blocked), `job_list`,
and `job_kill` are for collecting, listing, and cancelling work — not for
watching it.

`wait_agent` is the bounded wait for the calling agent's own next-step inbox.
Use it when genuinely waiting for new input, then read the delivered messages;
it is not a generic wait for another agent's status or for a Team task change,
and it must not become a busy-polling loop.
