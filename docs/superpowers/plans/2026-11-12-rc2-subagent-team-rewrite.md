# RC2 Subagent and Agent Teams Reference Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the complete DSH tool-mapping reference so it describes the RC2 unified subagent tree and optional Agent Teams shared task board instead of the removed dual identity and control models.

**Architecture:** Keep `references/dsh-tools.md` as the only authored runtime reference and regenerate its skill-tree copy. Replace the Subagents chapter with a unified subagent-tree explanation plus an Agent Teams increment, preserve valid surrounding chapters, and prove behavior through failing-then-passing content checks and fresh-document application reviews.

**Tech Stack:** Markdown, Node.js built-in filesystem/assertion utilities, the repository artifact generator and npm verification scripts, Git, fresh-context review subagents.

**Spec:** `docs/superpowers/specs/2026-11-12-rc2-subagent-team-design.md`

## Global Constraints

- Target only official DSH `0.2.2-rc.2`, tag `dsh-v0.2.2-rc.2`, commit `ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c`; do not describe older behavior as current.
- The only authored runtime document is `references/dsh-tools.md`; `skills/using-superpowers/references/dsh-tools.md` must be regenerated, never edited independently.
- The complete Chinese translation is supplied in the final review response, not added as another repository maintenance copy.
- Do not modify DSH source, profiles, plugin configuration, user Sessions, Superpowers SDD flow, or unrelated repository files.
- PR #4 is already merged. Create a new documentation branch for this work; never commit this work directly to `main` and do not push or open/update a PR without separate user approval.
- Use the RC2 `agent` argument and returned agent names, not `target` or the obsolete `agent_id` call shape.
- Team mode is optional for SDD. Fresh-per-task and fresh-per-review worker isolation remains mandatory in both Team states.
- Do not claim `spawn_teammate`, a separate Team roster, `maxMembers`, Team-specific control tools, or Team-specific inbox waiting exists in RC2.
- The built-in base and Web standard/cordis/ptc configurations set `interrupt: false`; document `interrupt_agent` as conditional on actual visibility.

## Review Focus

1. **Team-enabled fresh SDD work:** a six-task plan creates fresh implementers and reviewers without a cumulative Team roster wall; Task 1 static checks and Task 2 scenarios 1–2.
2. **Team switched off with live descendants:** agents and tasks remain, four task tools and policy disappear, ordinary controls and inbox waiting continue; Task 2 scenario 3.
3. **Nested and cross-branch continuation:** `reviewer/checker` can be messaged with `agent`, and SDD fix rounds resume the original implementer when controls allow; Task 2 scenario 4 and the fix-loop text in Task 1.
4. **Task changes versus inbox input:** task mutation alone does not release `wait_agent`; explicit messaging is required when action is needed; Task 2 scenario 5.
5. **Partial and conditional tool surfaces:** default absence of `interrupt_agent`, active-versus-cumulative capacity, Workflow-only execution, and orchestrator depth are not guessed from Team visibility; Task 2 scenarios 6–9.

---

### Task 1: Rewrite and Generate the Unified RC2 Reference

**Files:**
- Modify: `references/dsh-tools.md`
- Generate: `skills/using-superpowers/references/dsh-tools.md`
- Commit only for design/plan record: `docs/superpowers/specs/2026-11-12-rc2-subagent-team-design.md`, `docs/superpowers/plans/2026-11-12-rc2-subagent-team-rewrite.md`

**Interfaces:**
- Consumes: the approved design, especially §7 target structure, §8 removal table, and §10 verification scenarios.
- Produces: a complete English reference whose normative terms are `subagent`, `subagent_fork`, `agent`, `lead`, root-relative names such as `reviewer/checker`, ordinary inbox `wait_agent`, and four Team task tools. Task 2 reviews this document without relying on conversation history.

- [ ] **Step 1: Create the documentation branch and record the approved design and plan**

With the user's execution and isolation choices confirmed, use `using-git-worktrees` to establish the isolated workspace. Create a new documentation branch from current `main`; do not reuse merged PR #4. Preserve the approved design and this plan in the branch history before editing runtime documentation.

Run:

```bash
git status --short --branch
git branch --show-current
```

Expected: the new branch is clean apart from the intentionally added design/plan files before they are committed.

Commit only those records:

```bash
git add docs/superpowers/specs/2026-11-12-rc2-subagent-team-design.md docs/superpowers/plans/2026-11-12-rc2-subagent-team-rewrite.md
git commit -m "docs: record RC2 delegation redesign"
```

- [ ] **Step 2: Measure the verification baseline before editing**

Run:

```bash
npm run verify
```

Record the complete pass/fail/skip counts and any failing test name. Do not assume the earlier Windows result still applies and do not attribute a new failure to the platform without comparing against this output.

- [ ] **Step 3: Run the fresh-document baseline against the old reference**

Dispatch one fresh ordinary subagent with only `references/dsh-tools.md` and these questions, forbidding use of DSH source or prior conversation:

1. What tool creates a teammate when Team is enabled?
2. Can a normal SDD child be listed and resumed in a Team Session?
3. Does Team use `target`, `agent_id`, or `agent` for messages?
4. Is `wait_agent` ordinary inbox waiting or a Team-task event wait?
5. Is `interrupt_agent` present in the built-in configuration?

Expected RED evidence: the old document promotes removed dual-model behavior and cannot answer all five with RC2-correct guidance. Preserve the reviewer's response; do not edit it to manufacture a failure.

- [ ] **Step 4: Add the failing static RC2 content check**

Run this read-only inline check against the old master:

```bash
node --input-type=module -e "import {readFileSync} from 'node:fs'; const t=readFileSync('references/dsh-tools.md','utf8').replace(/\s+/g,' '); const required=['## Subagents and Agent Teams','started subagent <name>','send_message({ agent, message })','maxActiveSubagents','team_task_create','interrupt: false']; const forbidden=['spawn_teammate','maxMembers','agent_id','noProgress','blind background','durable roles use Team']; const missing=required.filter(s=>!t.includes(s)); const stale=forbidden.filter(s=>t.includes(s)); if(missing.length||stale.length) throw new Error('RED missing='+missing.join('|')+' stale='+stale.join('|'));"
```

Expected: FAIL because the required unified model is absent and obsolete instructions remain.

- [ ] **Step 5: Rewrite the complete English master according to the approved structure**

Edit only `references/dsh-tools.md`. Preserve the title, Skills, Task lists, and valid background guidance; rewrite the mapping row, the entire delegation chapter, and the background return/wait wording.

Use exactly this conceptual hierarchy, with concise tables and `####` subdivisions inside the two child sections:

1. `## Subagents and Agent Teams`
   - One subagent tree owns creation, identity, discovery, messaging, inbox waiting, and lifecycle.
   - Team is an optional shared task board on that tree, not a second identity or control system.
   - Route only from actual visible capabilities and task context; never from `spawn_teammate`, a preset name, or Team UI presence.
2. `### 1. Subagent tree`
   - Fresh `subagent`, history-inheriting `subagent_fork`, optional `cwd`, self-contained prompt, and immediate `started subagent <name>` receipt.
   - `lead`, sibling-unique names, nested paths such as `reviewer/checker`, completion notices, and no busy polling.
   - Argument-free `list_agents` over the whole reachable continuable tree; `name`, `status`, and optional description rows.
   - `send_message({ agent, message })` to any other member of the same tree by name or Session id; inbox acceptance is not a reply.
   - `wait_agent` waits only for the caller's next-step inbox; task changes do not release it; `timedOut: false` is not proof of task completion.
   - Conditional `interrupt_agent` using `agent`, ancestor-only authority, local/external differences, and built-in `interrupt: false`.
   - Default `maxActiveSubagents` of eight live/materializing activations, cleanup releasing capacity, no cumulative Session-history cap, and independent depth limits.
   - SDD fresh implementers/reviewers in either Team state; fix rounds 1–3 resume the original implementer when controls permit, otherwise use the existing fresh-implementer + brief/report/findings path; rounds 4–5 and scoped re-reviews remain unchanged.
   - Whole-plan orchestration uses ordinary `subagent`, conditional model-route fields, required depth headroom, and verbatim “Rulings I made” handoff.
3. `### 2. Agent Teams shared task board`
   - Built into base-backed profiles; new roots default off; root-only persisted selection shared by descendants; ordinary forks are independent roots.
   - `defaultEnabled` remains false in the standard bundle; a historical board without a saved selection remains enabled.
   - Team adds only `team_task_create`, `team_task_list`, `team_task_get`, `team_task_update`, and Team policy. Ordinary tool schemas do not change.
   - Disabling hides those four tools and policy from later steps, retains tasks and subagents, and leaves ordinary controls and `wait_agent` available; re-enabling restores the board.
   - Owners accept `lead`, a full name path, or Session id; root reassigns to itself or any continuable descendant; other members claim ready tasks themselves.
   - Preserve list → get → claim at current revision → work → complete at latest revision, DAG blockers, eight update actions, CAS, default `maxTasks` 256, tombstones, pagination, and mutually exclusive `owner`/`unowned` filters.
   - Write scopes are advisory, checkout sharing provides no worktree/merge/owner-release automation, and task mutations require explicit messages when someone must act.
4. `## Background work`
   - Use `started subagent <name>` and ordinary inbox `wait_agent`; remove Team-specific waiting language.

Do not include a historical migration tutorial or operational instructions for removed tools.

- [ ] **Step 6: Verify the new master turns the static check green**

Run the Step 4 command unchanged.

Expected: no output and exit code 0; both required content exists and forbidden operational legacy content is absent.

- [ ] **Step 7: Generate the skill-tree copy and prove exact synchronization**

Run:

```bash
node scripts/generate-artifacts.mjs
node --input-type=module -e "import {readFileSync} from 'node:fs'; const a=readFileSync('references/dsh-tools.md','utf8'); const b=readFileSync('skills/using-superpowers/references/dsh-tools.md','utf8'); if(a!==b) throw new Error('reference copies differ'); console.log('reference copies identical');"
node scripts/generate-artifacts.mjs --check
```

Expected: only the generated mapping copy changes among artifacts, the two files are identical, and all generated artifacts match.

- [ ] **Step 8: Run Task 1 verification and review its diff**

Run:

```bash
npm run verify
git diff --check
git diff --stat
```

Expected: artifact checks and content checks pass. Compare test counts with Step 2 and identify any new failure precisely. The runtime-document diff touches only the master and its generated copy; the design/plan commit is separate.

Review the complete diff against design §§7–8 before committing. If any removed dual-model instruction remains, return to Step 5 rather than explaining it away.

- [ ] **Step 9: Commit the rewritten reference and generated copy**

```bash
git add references/dsh-tools.md skills/using-superpowers/references/dsh-tools.md
git commit -m "docs: unify RC2 subagent and Team guidance"
```

### Task 2: Prove Application Behavior and Complete the Review Package

**Files:**
- Modify only if an evidenced finding requires correction: `references/dsh-tools.md`
- Regenerate after any correction: `skills/using-superpowers/references/dsh-tools.md`
- No Chinese repository file and no additional production files.

**Interfaces:**
- Consumes: Task 1's complete English master and generated copy.
- Produces: scenario-review evidence, any necessary corrective commit, a full Chinese translation for the user, final verification evidence, and a clean branch ready for a later user-authorized PR action.

- [ ] **Step 1: Run the nine-scenario fresh-document review**

Dispatch one fresh ordinary subagent with only the new `references/dsh-tools.md`, the nine scenarios below, and instructions to cite `file:line` for every answer. It must not use DSH source or conversation history to fill gaps.

1. Team off: execute a six-task SDD plan with fresh implementers and reviewers; is there a cumulative Team member wall?
2. Team on: do those workers appear in `list_agents`, and how can the original implementer be resumed?
3. Team is disabled with live descendants: what happens to agents, tasks, four task tools, and `wait_agent`?
4. How is `reviewer/checker` messaged, and does the result contain the reply or inbox acceptance?
5. Why did a task commit not release `wait_agent`, and what should happen next?
6. What must the reader do when `interrupt_agent` is absent in the built-in configuration?
7. How does an active capacity of eight differ from cumulative Session history?
8. When direct creation tools are absent but Workflow is visible, when can fan-out still run?
9. When may an orchestrator run the whole SDD loop one level down?

Expected: every answer has an RC2-correct, document-grounded response and line citation. Any “not covered”, dual-model answer, or unsupported guess is a finding, not a pass.

- [ ] **Step 2: Correct every evidenced coverage or accuracy finding through RED/GREEN**

For each finding, first add the smallest failing inline content assertion or focused fresh-document question that reproduces it; run and record the failure. Edit only the master to close that specific gap, regenerate the copy, and rerun the same check until it passes.

If no findings exist, record “no corrective changes required” and do not create an empty commit.

For each correction set, run:

```bash
node scripts/generate-artifacts.mjs
npm run verify
git diff --check
```

Then commit only evidenced corrections:

```bash
git add references/dsh-tools.md skills/using-superpowers/references/dsh-tools.md
git commit -m "docs: close RC2 delegation review gaps"
```

- [ ] **Step 3: Produce and cross-check the complete Chinese translation**

Provide the full Chinese translation in the final user-facing review response, including every chapter of the English master—not only the changed Subagents chapter.

Cross-check section by section against the final English file: mapping table, Skills, unified delegation chapter with all fourth-level blocks, Task lists, and Background work. Keep tool names, parameter names, limits, result shapes, and workflow commands verbatim. Do not write the translation into the repository.

- [ ] **Step 4: Request the final fresh whole-branch review**

Dispatch a fresh reviewer with the approved design, Task 1/2 reports, and the diff from the branch base to HEAD. Require it to verify:

- RC2 factual accuracy against the checked-out DSH source at `C:\Users\Think\Desktop\项目\deepseek-harness`.
- No operational use of removed tools or parameters.
- No dual identity, shadowed Team controls, blind-background, or cumulative Team-roster claims.
- Team on/off behavior, ordinary inbox waiting, conditional interruption, and active-capacity semantics.
- SDD fresh-worker isolation and fix-loop continuity.
- Exact master/generated-copy equality and no unrelated runtime changes.

Expected: a clear Ready verdict with Critical/Important/Minor findings. Resolve Critical and Important before delivery; do not silently discard Minor findings.

- [ ] **Step 5: Run final fresh verification and inspect repository state**

Run after the last content change:

```bash
npm run verify
node scripts/generate-artifacts.mjs --check
node --input-type=module -e "import {readFileSync} from 'node:fs'; const a=readFileSync('references/dsh-tools.md','utf8'); const b=readFileSync('skills/using-superpowers/references/dsh-tools.md','utf8'); if(a!==b) throw new Error('reference copies differ'); console.log('reference copies identical');"
git diff --check
git status --short --branch
git log --oneline main..HEAD
```

Expected: content and artifact checks pass, copies are identical, and every result is reported with actual counts. Any pre-existing verification failure is reported separately from regressions using the Step 2 baseline; do not claim a fully green suite unless zero failures are observed.

- [ ] **Step 6: Deliver for review without pushing**

Report the branch, commit ids, changed files, verification results, independent review verdict, and full Chinese translation. Link the final English master and generated copy.

Do not push, open a PR, update a PR description, merge, or alter DSH/profile state until the user separately authorizes that action.
