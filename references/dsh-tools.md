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
| Dispatch a subagent (`Task`, `Subagent`) | `subagent` (background by default) or `subagent_fork` when the child must inherit this conversation; `workflow` for large planned fan-outs |
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

dsh ships `subagent` (a separate agent with its own context; background by
default, continuable with `send_message`) and `subagent_fork` (a child seeded
with the current conversation). Superpowers' `subagent-driven-development`,
`dispatching-parallel-agents`, and `requesting-code-review` skills work with
either: dispatch one subagent per task, give it the complete task text and the
review prompts the skill names, and act on the report it returns. `workflow`
runs a JavaScript script that fans work out across many subagents when the plan
calls for large-scale parallel work.

### Cheaper orchestration for subagent-driven development

The controller session is the most expensive seat in a `subagent-driven-development`
run: it reads every dispatch result and every report, and it usually runs on the
session's most capable model. dsh can run the whole loop one layer down.

When your human partner asks for it — or says the session model is too expensive
to spend on coordination — dispatch ONE orchestrator subagent with the plan path
and the instruction to run `subagent-driven-development` end to end. Give that
call a mid-tier `model` (and its `provider`); the tool only exposes those route
fields when the deployment enabled subagent model selection, so fall back to the
inherited route when it does not. The orchestrator then dispatches its own
implementers and reviewers per that skill's Model Selection. The workspace and
ledger live on disk, so nothing is lost to the extra layer. Its final message
must carry the "Rulings I made" list verbatim — that list is how the decisions
reach your human partner, and you relay it, not summarize it.

Do this only for a whole plan. Nesting a single task's dispatch buys nothing and
adds a seat.

## Task lists

`todo_write` is dsh's task list. Superpowers skills that mention `TodoWrite` (or
"create a todo per item") mean this tool: send the complete list on every call,
one item per checklist entry, and mark an item complete the moment it is done.

## Background work

Long shell commands and agents run as managed background jobs. Start them with
`run_in_background: true`, read progress with `job_output` (use `wait: true` only
when genuinely blocked), and stop them with `job_kill`. Never busy-poll.
