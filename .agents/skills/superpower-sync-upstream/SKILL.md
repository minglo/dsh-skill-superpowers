---
name: superpower-sync-upstream
description: Use when the vendored upstream skills tree must be refreshed from a new upstream release. Re-vendors it, re-applies the dsh adaptations (the namespace strip, the tool mapping, the harness prune, the subagent-wait rewrite) and updates the recorded pin.
---

# Syncing the Vendored Upstream

This plugin **vendors** an upstream skills project and applies a small,
scripted set of dsh adaptations on top. `package.json#upstream` names the
repository and records the revision last vendored — it is the single source for
both, and no script or document repeats it. The tree is disposable; the adaptations are declarative.

```
.agents/skills/             == skills THIS package authors (contributors only)
skills/                     == upstream verbatim + scripted adaptations
scripts/sync-skills.mjs     == the ONLY source of local divergence
package.json#upstream       == the tag+commit vendored last
```

**Never hand-edit the upstream-owned parts of `skills/`.** A sync replaces every
upstream directory wholesale, so a hand edit there is lost. If an adaptation is
wrong, fix `scripts/sync-skills.mjs` or `references/dsh-tools.md` instead.

The maintenance skills live in `.agents/skills/`, which dsh scans as its project
scope for anyone working inside this repository. Contributors get them; users of
the published package never do, because `package.json#files` ships no `.agents/`.
They are ordinary skills — edit them directly. `artifacts.json#skillTree.own`
stays empty on purpose: it describes what this package authors *inside* `skills/`,
which is nothing, and a sync rebuilds that tree from upstream alone.

A sync is correct when re-running it reports `nothing to sync`.

## Procedure

### 1. Read the current pin

```bash
node -e "console.log(JSON.stringify(require('./package.json').upstream, null, 2))"
```

### 2. Pick the target and clone it

Ask the human partner which release, or take upstream's newest tag:

```bash
REPO=$(node -p "require('./package.json').upstream.repository")
git ls-remote --tags "$REPO" | tail -5
git clone --depth 1 --branch <TAG> "$REPO" /tmp/upstream
```

### 3. Report the drift BEFORE changing anything

```bash
node scripts/sync-skills.mjs --check /tmp/superpowers
```

Exit 1 with a file list means upstream moved. Read the list and tell the human
partner which skills are **new**, **rebuilt**, or **removed**. A rebuilt skill is
a behavior change, not a routine bump — `executing-plans` went from a 64-line
stub to a 373-line native-execution skill in v6.4.1, and that is worth flagging
explicitly rather than reporting as "15 files changed".

### 4. Apply

```bash
node scripts/sync-skills.mjs /tmp/superpowers --tag <TAG>
```

This rebuilds `skills/` from the checkout, re-applies the adaptations, and then
**automatically re-runs `generate-artifacts.mjs`** to put the tool mapping back.
That last step is not optional: the rebuild deletes the whole upstream tree, and
the mapping lives inside one of those directories. `.agents/skills/` is outside
that tree, so a sync never touches these guides.

| Adaptation | Why |
|---|---|
| **Strip the `superpowers:` namespace** (pass over every `.md`) | dsh's skill-name grammar is `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` and rejects `:`. Upstream's *skill names* are already valid, so only the cross-skill *references* change — never a `name:` field. The model must see bare names, because `skill("superpowers:brainstorming")` is a hard error. |
| Install `using-superpowers/references/dsh-tools.md` | Copied from the package's `references/dsh-tools.md`, the single source both the skill and the injected bootstrap render from. |
| **Prune the other harnesses' reference docs** | This package supports dsh only. Their cross-references dangle once dsh is the only harness, and shipping them advertises support we cannot provide. |
| Rewrite the Platform Adaptation section | Upstream lists one row per harness; after the prune those rows point at deleted files. |
| Rewrite the personal-skills path in `writing-skills` | It names two pruned files in prose. |
| Rewrite the subagent-wait paragraph in `subagent-driven-development` | Upstream tells the controller to wait in bounded stretches (five to ten minutes) and reconcile its live children between them. dsh's own subagent guidance says the opposite — "end your turn instead of sleeping or polling; the next result starts a new turn" — and a model handed both settles on a `sleep` loop. The paragraph is replaced wholesale; unlike the other adaptations, a missing anchor is a hard error (see below). |
| Restore the executable bit on shebang files | Some packagers and git-on-Windows drop it, and the skills invoke those scripts directly. |

The only file exempt from the namespace strip is the tool mapping, whose prose
intentionally *mentions* `superpowers:` to explain that it does not exist on
dsh. These guides live outside `skills/`, so the pass never reaches them.

**If upstream adds a harness**, its new `references/<name>-tools.md` will be
vendored and then survive the prune unless you add it to
`PRUNED_HARNESS_REFERENCES` in `scripts/sync-skills.mjs`. `check-upstream.mjs`
warns about exactly this.

**If an adaptation's anchor disappears, the sync stops instead of shipping
upstream text back.** The subagent-wait rewrite is the only adaptation with this
guard, because vendoring its paragraph back would silently restart the polling.
An exit whose message is `the "Waiting on dispatched subagents" paragraph is gone
or reshaped` means upstream rewrote that paragraph: read the new text, decide what
dsh's waiting model should say, then update `SUBAGENT_WAIT_SECTION` and
`SUBAGENT_WAIT_REPLACEMENT` in `scripts/sync-skills.mjs` and re-run. Do not delete
the check to get past it.

### 5. Update the pin, then re-record the baseline

```bash
# upstream.tag / upstream.commit / upstream.synced in package.json
node -e "
const fs=require('fs'); const p=JSON.parse(readFileSync('package.json','utf8'));
p.upstream.tag='<TAG>'; p.upstream.commit='<40-hex-commit>'; p.upstream.synced='<YYYY-MM-DD>';
fs.writeFileSync('package.json', JSON.stringify(p,null,2)+'\n')"

# The baseline is what future `check-upstream` runs diff against. Recording it
# mechanically is the point: a hand-written list of "what upstream had" rots.
node scripts/check-upstream.mjs --record-baseline --offline /tmp/superpowers
```

**You do not need to update `EXPECTED_SKILLS` or the README skill table by
hand** — both are generated regions. `generate-artifacts.mjs` (already run by
step 4) reads the new tree and rewrites them. If the skill set changed, the
generated `EXPECTED_SKILLS` changes with it.

### 6. Verify

```bash
node tests/test-plugin.mjs                 # must be all-pass
node scripts/generate-artifacts.mjs --check # must exit 0
node scripts/sync-skills.mjs --check /tmp/superpowers   # must exit 0
```

The second command exiting 0 is the real proof that nothing was hand-edited: it
means every derived file equals what `artifacts.json` would produce. The third
means the tree equals "upstream plus adaptations", with no residue from you.

## Adapting a Skill That Cannot Work on dsh

If upstream adds a skill that depends on a harness capability dsh lacks, do
**not** silently vendor it. `diagnosing-superpowers` (added in v6.4.1) is the
known case: it reads Claude Code session transcripts from disk, builds scrub
bundles and drafts GitHub issues. dsh has session logs under `$DSH_HOME/sessions`
but the discovery rules in its `references/session-discovery.md` assume the
Claude Code layout.

Choose one, and record the choice in `package.json#upstream`:

- **Adapt** — add a dsh section to that skill's reference docs.
- **Exclude** — delete the skill from `skills/` *in the sync script*, so the
  exclusion is reproducible rather than a hand edit that the next sync undoes.
  Keep `EXPECTED_SKILLS` in step.

Either way, tell the human partner; this is a judgment call about behavior, not
a mechanical step.

## What NOT To Do

- **Do not rename skills or add a `superpower-` prefix to `name:`.** Upstream
  names already satisfy dsh's grammar. Renaming forces a rewrite of every
  cross-reference — and therefore a translation-style whole-file conflict — on
  every single sync.
- **Do not translate the skill bodies.** Translation turns every upstream change
  into an unresolvable whole-file conflict instead of a scripted re-apply.
- **Do not `git merge upstream/main`.** This is a vendoring consumer, not a git
  fork; there is no shared history to merge.
- **Do not edit `skills/` directly**, for the reason at the top.
