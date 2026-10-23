# Monitoring Upstream

`docs/sync-upstream.md` answers "how do I adopt a release". This guide answers
the question that comes first: **has anything changed, and does it matter here?**

Run it on a schedule, before a release, or when someone reports that upstream
shipped something.

## The One Command

```bash
node scripts/check-upstream.mjs            # report against the recorded pin
node scripts/check-upstream.mjs --json     # machine-readable, for CI or a cron
```

It exits **0** when the pin is current, **1** when upstream has moved — so a
scheduled job can alert on the exit code alone.

## What It Checks

The script compares the pin in `package.json#upstream` against upstream's tags
and, when they differ, clones the target and classifies the delta:

| Signal | Why it needs your attention |
|---|---|
| **New skill** (`added <name>/SKILL.md`) | The catalog grows. `EXPECTED_SKILLS` is generated, so re-run `generate-artifacts` after syncing — but check first whether the new skill can even work on dsh (see below). |
| **Rebuilt skill** (large line delta in an existing `SKILL.md`) | A behavior change, not a wording tweak. `executing-plans` went 64 → 373 lines in v6.4.1 and became a different execution mode. Report these separately to the human partner; do not bury them in a file count. |
| **Removed file** | Something we vendor no longer exists upstream. Usually fine, but a removal can also mean a skill was split or renamed. |
| **New harness support** (a new `.<name>-plugin/` directory) | **The highest-value signal.** Upstream adds a harness by adding a manifest directory plus a per-harness reference file. A new one means upstream grew an adaptation pattern we may need to mirror — and a new reference file will land in `using-superpowers/references/`, which our prune list must explicitly cover. |
| **New hook or bootstrap change** (`hooks/`, `session-start`) | Upstream's bootstrap mechanism is how skills auto-trigger. If it changes, our `systemPrompt.section` injection may need to change with it. |

## Reading the Result

**Exit 0** — nothing to do. Report that and stop.

**Exit 1** — upstream moved. Before touching anything, answer three questions
and put the answers in front of the human partner:

1. **Which skills changed, and is any of them rebuilt rather than edited?**
   A rebuilt skill changes how the agent works. That is worth a sentence, not a
   line in a diff summary.
2. **Did the skill *set* change?** A new or removed skill means the generated
   `EXPECTED_SKILLS` and the README table both need regenerating.
3. **Did upstream add a harness?** If a new `.<name>-plugin/` directory appeared,
   upstream also added (or will add) a matching `references/<name>-tools.md`.
   Our prune list in `scripts/sync-skills.mjs` names each unsupported harness
   reference explicitly, so a new one must be added there or it ships as a
   dangling file.

## Deciding Whether a New Skill Can Work Here

Upstream skills assume capabilities a harness may not have. Before adopting one,
grep it for harness-specific machinery:

- reading session transcripts from a harness-specific directory
  (`diagnosing-superpowers` does this — it assumes the Claude Code layout)
- writing to a harness-specific config path (`~/.claude/…`)
- invoking a harness-specific tool by name

If it does, choose **adapt** (document the dsh equivalent in the reference file)
or **exclude** (remove it in the sync script so the exclusion is reproducible),
then record the choice in `package.json#upstream`. Never silently vendor a skill
that cannot run; it becomes a trap for the next reader.

## What This Guide Does Not Do

It does not change the pin and does not sync. Reporting is separate from
adopting on purpose: a human decides whether a release is worth taking, and
`docs/sync-upstream.md` carries out that decision.
