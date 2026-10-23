# Syncing the Vendored Upstream

This plugin **vendors** an upstream skills project and applies a small,
scripted set of dsh adaptations on top. `package.json#upstream` names the
repository and records the revision last vendored — it is the single source for
both, and no script or document repeats it. The tree is disposable; the adaptations are declarative.

```
skills/                     == upstream verbatim + scripted adaptations
scripts/sync-skills.mjs     == the ONLY source of local divergence
package.json#upstream       == the tag+commit vendored last
```

**Never hand-edit `skills/`.** A sync replaces every upstream directory
wholesale, so a hand edit there is lost. If an adaptation is wrong, fix
`scripts/sync-skills.mjs` or `references/dsh-tools.md` instead.

This package ships no skills of its own: every skill under `skills/` is upstream
owned, so `artifacts.json#skillTree.own` is empty and a sync rebuilds the whole
tree. Maintenance guidance lives in `docs/`, deliberately outside `skills/`, so
it never appears in the skill catalog a session receives.

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
**automatically re-runs `generate-artifacts.mjs`** to put this adapter's own
files back. That last step is not optional: the rebuild deletes the whole tree,
so our own skills and the tool mapping go with it.

| Adaptation | Why |
|---|---|
| **Strip the `superpowers:` namespace** (pass over every `.md`) | dsh's skill-name grammar is `/^[a-z0-9]+(?:-[a-z0-9]+)*$/` and rejects `:`. Upstream's *skill names* are already valid, so only the cross-skill *references* change — never a `name:` field. The model must see bare names, because `skill("superpowers:brainstorming")` is a hard error. |
| Install `using-superpowers/references/dsh-tools.md` | Copied from the package's `references/dsh-tools.md`, the single source both the skill and the injected bootstrap render from. |
| **Prune the other harnesses' reference docs** | This package supports dsh only. Their cross-references dangle once dsh is the only harness, and shipping them advertises support we cannot provide. |
| Rewrite the Platform Adaptation section | Upstream lists one row per harness; after the prune those rows point at deleted files. |
| Rewrite the personal-skills path in `writing-skills` | It names two pruned files in prose. |
| Restore the executable bit on shebang files | Some packagers and git-on-Windows drop it, and the skills invoke those scripts directly. |

Files exempt from the namespace strip are the tool mapping and this guide, whose
prose intentionally *mentions* `superpowers:` to explain that it does not exist
on dsh. (`docs/` sits outside `skills/`, so exempting it costs nothing.)

**If upstream adds a harness**, its new `references/<name>-tools.md` will be
vendored and then survive the prune unless you add it to
`PRUNED_HARNESS_REFERENCES` in `scripts/sync-skills.mjs`. `check-upstream.mjs`
warns about exactly this.

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
