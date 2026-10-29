// Refresh the vendored skills from a checkout of the upstream project.
// Upstream coordinates come from package.json#upstream — the single place the
// repository is named.
//
// `skills/` is a copy of the upstream skills tree with this adapter's
// adaptations applied to it. The package authors no skills inside that tree;
// the two maintenance skills live in `.agents/skills/`, which a sync never
// touches. The adaptations are:
//
//   1. the sed pass that strips Claude Code's `superpowers:` namespace from
//      cross-skill references (dsh's skill-name grammar rejects `:`, and the
//      model must see bare names);
//   2. `using-superpowers/references/dsh-tools.md`, copied from the package's
//      `references/dsh-tools.md`;
//   3. one Platform Adaptation line registering dsh.
//
// Drift is measured the only way that is both honest and useful: this adapter's
// adaptations are applied to a throwaway copy of the upstream tree, and THAT is
// compared with the checked-in one. So `--check` answers "has upstream moved
// on?" without reporting our own adaptations as drift, and re-running a sync
// over an already-synced tree is a no-op.
//
// Usage:
//   node scripts/sync-skills.mjs <checkout> [--tag v6.4.2]
//   node scripts/sync-skills.mjs --check [<checkout>]   # report drift, write nothing
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ownContentInSkillsTree, ownSkillNames, upstreamPin } from './lib/own-content.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(packageRoot, 'skills')
const manifestPath = join(packageRoot, 'package.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const recorded = manifest.upstream ?? {}

const args = process.argv.slice(2)
const checkOnly = args.includes('--check')
const tagIndex = args.indexOf('--tag')
const tag = tagIndex === -1 ? undefined : args[tagIndex + 1]
const source = resolve(
  args.find((a) => !a.startsWith('--') && a !== tag) ?? join(packageRoot, '..', 'superpowers'),
)
const sourceSkills = join(source, 'skills')

/** Relative path of the tool mapping inside the skills tree. */
const MAPPING_REL = 'using-superpowers/references/dsh-tools.md'
/**
 * Files whose prose deliberately *mentions* the Claude Code namespace and must
 * therefore be exempt from the strip: the tool mapping explains that no such
 * prefix exists, so stripping it would invert its meaning.
 *
 * The maintenance skills used to live under `skills/` and needed the same
 * exemption. They moved to `.agents/skills/`, which this pass never walks, so
 * the set is down to one.
 */
const NAMESPACE_EXEMPT = new Set([MAPPING_REL])
/** Claude Code's namespace reference, which dsh's name grammar rejects. */
const NAMESPACE = /superpowers:([a-z0-9][a-z0-9-]*)/g

/**
 * Other harnesses' per-harness reference docs, pruned from the tree. This
 * distribution targets dsh only; shipping six other harnesses' tool mappings
 * would advertise support this package cannot provide, and every one of them
 * is a dangling cross-reference once dsh is the only harness present.
 *
 * On a sync where upstream adds a seventh harness, add it here too.
 */
const PRUNED_HARNESS_REFERENCES = [
  'claude-code-tools.md',
  'codex-tools.md',
  'gemini-tools.md',
  'hermes-tools.md',
  'pi-tools.md',
  'antigravity-tools.md',
  'muse-tools.md',
]

/**
 * The Platform Adaptation section, rewritten to name dsh alone. Upstream lists
 * one row per supported harness; after the prune those rows would point at
 * deleted files.
 */
const PLATFORM_SECTION = `## Platform Adaptation

This distribution ships one harness reference. If you are running on the
DeepSeek Harness (dsh), read it before acting:

- DeepSeek Harness (dsh): \`references/dsh-tools.md\`

Other harnesses are not supported by this package. If you are not on dsh, skip
this section rather than following a reference that is not present.
`

/**
 * `writing-skills` points at two of the pruned files by name. Rewrite that
 * sentence to the dsh equivalent so the link resolves.
 */
const PERSONAL_SKILLS_SENTENCE =
  /\*\*Personal skills live in your runtime's skills directory\*\*[^\n]*\n/
const PERSONAL_SKILLS_REPLACEMENT =
  "**Personal skills live in your runtime's skills directory** — on the DeepSeek\n"
  + 'Harness that is `~/.agents/skills/` (cross-runtime alias) or `~/.dsh/skills/`.\n'
  + 'See [dsh-tools.md](../using-superpowers/references/dsh-tools.md).\n'

/**
 * Home-directory rewrites: only the paths that would send a dsh user somewhere
 * that does not exist.
 *
 * Scope is deliberately narrow. Anything that merely *names* another harness —
 * an instruction-file list, a worked example's title, a historical note — is
 * left verbatim: it is upstream's text about upstream, the reader can tell, and
 * rewriting it would make the vendored tree drift from the source of truth for
 * no functional gain. Earlier revisions of this script did rewrite those, which
 * is how `(AGENTS.md, AGENTS.md, GEMINI.md)` and a falsified creation log got
 * shipped; the rename also turned a test example into a file whose name no
 * longer matched its contents.
 *
 * So: rewrite `~/.claude/...` (a path a dsh user would actually try to use) and
 * nothing else. `writing-skills` gets a targeted sentence rewrite below because
 * its original points at two files this package prunes.
 */
const HARNESS_NEUTRAL_REWRITES = [
  // Longest prefix first, so a shorter rule cannot leave a mixed path that
  // exists nowhere.
  [/~\/\.claude\/skills\//g, '~/.agents/skills/'],
  [/~\/\.claude\/CLAUDE\.md/g, '~/.agents/AGENTS.md'],
  [/~\/\.claude\//g, '~/.agents/'],
]

if (!existsSync(join(sourceSkills, 'using-superpowers', 'SKILL.md'))) {
  console.error(`no skills tree at ${sourceSkills}`)
  console.error(`clone it first, e.g. git clone --depth 1 --branch ${upstreamPin(packageRoot).tag} ${upstreamPin(packageRoot).repository}`)
  process.exit(2)
}

/** HEAD of the source checkout, when the source is a git work tree. */
function sourceHead() {
  try {
    return execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

/** Every file under a directory, as root-relative POSIX paths, sorted. */
function listFiles(root) {
  const out = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else out.push(relative(root, full).split('\\').join('/'))
    }
  }
  walk(root)
  return out.sort()
}

/**
 * Apply this adapter's adaptations in place, returning a summary.
 *
 * Idempotent: re-running over an already-adapted tree changes nothing, which is
 * what lets the upgrade skill verify itself by re-running and comparing.
 */
function applyAdaptations(root, { log = false } = {}) {
  const summary = {
    namespaced: [],
    platformEntry: false,
    pruned: [],
    rewrotePersonalSkills: false,
    harnessNeutral: [],
    files: 0,
  }

  for (const rel of listFiles(root)) {
    if (!rel.endsWith('.md')) continue
    // Exempt the files whose prose intentionally mentions the namespace.
    if (NAMESPACE_EXEMPT.has(rel)) continue
    const full = join(root, rel)
    const before = readFileSync(full, 'utf8')
    const after = before.replace(NAMESPACE, '$1')
    if (after !== before) {
      writeFileSync(full, after, 'utf8')
      summary.namespaced.push(`${rel} (${(before.match(NAMESPACE) ?? []).length})`)
    }
  }

  // NOTE: this package's own skills are NOT copied here — they live outside
  // `skills/` (in `.agents/skills/`) and a sync never touches them. Only content
  // that must live *inside* an upstream-owned directory (the tool mapping) needs
  // re-materialising, and generate-artifacts.mjs owns that from artifacts.json.

  // Prune the other harnesses' reference docs: this package supports dsh only,
  // and their cross-references dangle once the files are gone.
  const referencesDir = join(root, 'using-superpowers', 'references')
  summary.pruned = []
  for (const name of PRUNED_HARNESS_REFERENCES) {
    const full = join(referencesDir, name)
    if (existsSync(full)) {
      rmSync(full)
      summary.pruned.push(name)
    }
  }

  // Rewrite the Platform Adaptation section to name dsh alone. Replacing the
  // whole section (rather than editing rows) survives upstream adding or
  // reordering harnesses.
  const skillFile = join(root, 'using-superpowers', 'SKILL.md')
  const body = readFileSync(skillFile, 'utf8')
  const sectionRe = /## Platform Adaptation\n[\s\S]*?(?=\n## |\s*$)/
  const patched = sectionRe.test(body)
    ? body.replace(sectionRe, PLATFORM_SECTION)
    : `${body.trimEnd()}\n\n${PLATFORM_SECTION}`
  if (patched !== body) {
    writeFileSync(skillFile, patched, 'utf8')
    summary.platformEntry = true
  }

  // `writing-skills` names two pruned files in prose; point it at dsh instead.
  const writingSkills = join(root, 'writing-skills', 'SKILL.md')
  if (existsSync(writingSkills)) {
    const before = readFileSync(writingSkills, 'utf8')
    if (PERSONAL_SKILLS_SENTENCE.test(before)) {
      const after = before.replace(PERSONAL_SKILLS_SENTENCE, PERSONAL_SKILLS_REPLACEMENT)
      if (after !== before) {
        writeFileSync(writingSkills, after, 'utf8')
        summary.rewrotePersonalSkills = true
      }
    }
  }

  // Our own skills are excluded: they are this package's own prose and may
  // deliberately name a harness when explaining what upstream assumes.
  //
  // Records and worked examples are excluded too, because their text is a
  // report of what happened rather than advice for the current reader:
  //
  //   - `CREATION-LOG.md` says "Extracted debugging framework from
  //     `~/.claude/CLAUDE.md`" in the past tense; rewriting the path makes the
  //     log false.
  //   - `CLAUDE_MD_TESTING.md` is upstream's transcript of a test campaign run
  //     against Claude Code — every path in it is evidence, and there is nothing
  //     in it a dsh user is meant to follow. Retargeting it would leave a file
  //     whose name and contents no longer agree.
  const RECORD_FILE = /(^|\/)(CREATION-LOG|CLAUDE_MD_TESTING)\.md$/
  const ownNames = new Set(ownSkillNames(packageRoot))
  for (const rel of listFiles(root)) {
    if (!rel.endsWith('.md')) continue
    if (ownNames.has(rel.split('/')[0])) continue
    if (RECORD_FILE.test(rel)) continue
    const full = join(root, rel)
    const before = readFileSync(full, 'utf8')
    let after = before
    for (const [pattern, replacement] of HARNESS_NEUTRAL_REWRITES) {
      after = after.replace(pattern, replacement)
    }
    if (after !== before) {
      writeFileSync(full, after, 'utf8')
      summary.harnessNeutral.push(rel)
    }
  }

  // Some packagers and git-on-Windows drop the executable bit, and the skills
  // invoke these scripts directly. Anything with a shebang must be executable.
  //
  // Windows has no `chmod` binary, so this step aborted the whole sync there
  // with ENOENT — on a tree whose adaptations had already been applied
  // correctly, which made a successful sync look like a failure. NTFS has no
  // POSIX mode bits to restore anyway: git's index carries the 100755 and
  // .gitattributes keeps it. Skip on Windows rather than fake it.
  if (process.platform !== 'win32') {
    for (const rel of listFiles(root)) {
      const full = join(root, rel)
      const first = readFileSync(full, 'utf8').split('\n', 1)[0]
      if (!first.startsWith('#!')) continue
      if ((statSync(full).mode & 0o111) === 0) execFileSync('chmod', ['+x', full])
    }
  }

  summary.files = listFiles(root).length
  if (log) {
    for (const line of summary.namespaced) console.log(`    namespace stripped: ${line}`)
    for (const line of summary.harnessNeutral) console.log(`    harness-neutral: ${line}`)
  }
  return summary
}

/** Compare two trees of repo-relative POSIX paths, returning human lines. */
function diffTrees(expectedRoot, actualRoot) {
  const expected = listFiles(expectedRoot)
  const actual = existsSync(actualRoot) ? listFiles(actualRoot) : []
  const lines = []
  for (const rel of expected) {
    const a = join(expectedRoot, rel)
    const b = join(actualRoot, rel)
    if (!existsSync(b)) lines.push(`added    ${rel}`)
    else if (!readFileSync(a).equals(readFileSync(b))) lines.push(`changed  ${rel}`)
  }
  const expectedSet = new Set(expected)
  for (const rel of actual) {
    if (!expectedSet.has(rel)) lines.push(`removed  ${rel}`)
  }
  return lines
}

const head = sourceHead()
console.log(`recorded pin: ${recorded.repository ?? '(none)'} ${recorded.tag ?? ''} ${recorded.commit ?? ''}`.trimEnd())
if (head !== undefined) console.log(`checkout HEAD: ${head}`)
const pinMismatch = head !== undefined && recorded.commit !== undefined && recorded.commit !== head
if (pinMismatch) {
  console.log('pin mismatch: the checkout is not the commit recorded in package.json — a sync must update "upstream.tag"/"upstream.commit".')
}

// Build the expected end state: a pristine upstream copy with our adaptations
// applied, in a temp dir that never touches the real tree.
const staging = mkdtempSync(join(tmpdir(), 'superpowers-sync-'))
let drift
try {
  cpSync(sourceSkills, staging, { recursive: true })
  applyAdaptations(staging)
  // The expected tree is "upstream + adaptations + copied-in content". Own
  // content must be included or the diff below would report our own files as
  // upstream drift on every run:
  //   - the tool mapping, which lives inside an upstream-owned directory and is
  //     re-materialised from references/ by generate-artifacts;
  //   - any skill this package authors inside `skills/` (none today: `own` is
  //     empty and the maintenance skills live in `.agents/skills/`).
  for (const { from, targetRel } of ownContentInSkillsTree(packageRoot)) {
    const dest = join(staging, targetRel)
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(from, dest)
  }
  for (const name of ownSkillNames(packageRoot)) {
    const source = join(target, name)
    if (existsSync(source)) cpSync(source, join(staging, name), { recursive: true })
  }
  drift = diffTrees(staging, target)
} finally {
  rmSync(staging, { recursive: true, force: true })
}

if (checkOnly) {
  if (drift.length > 0) {
    console.log(`\ndrift against ${sourceSkills}${tag === undefined ? '' : ` (${tag})`}:`)
    for (const line of drift) console.log(`  ${line}`)
  } else {
    console.log(`\nskills/ matches ${sourceSkills}${tag === undefined ? '' : ` (${tag})`} plus this adapter's adaptations`)
  }
  if (pinMismatch) console.log('and the recorded pin is stale')
  process.exit(drift.length === 0 && !pinMismatch ? 0 : 1)
}

if (drift.length === 0) {
  console.log('\nnothing to sync — skills/ already matches upstream plus the adaptations')
  process.exit(0)
}

console.log(`\nsync against ${sourceSkills}${tag === undefined ? '' : ` (${tag})`}:`)
for (const line of drift) console.log(`  ${line}`)

// Replace the UPSTREAM-OWNED parts of the tree, then re-apply every adaptation
// from scratch. Adaptations are declarative, so "fresh upstream + apply" is
// always the correct end state — there is no three-way merge to get wrong.
//
// Skills this package authors inside `skills/` are deliberately left in place
// (there are none today, and `.agents/skills/` is outside this tree entirely),
// so only upstream-owned directories are rebuilt.
const own = ownSkillNames(packageRoot)
mkdirSync(target, { recursive: true })
let replaced = 0
let kept = 0
for (const entry of readdirSync(target, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue
  if (own.has(entry.name)) {
    kept += 1
    continue
  }
  rmSync(join(target, entry.name), { recursive: true, force: true })
  replaced += 1
}
for (const entry of readdirSync(sourceSkills, { withFileTypes: true })) {
  if (entry.name.startsWith('.')) continue
  cpSync(join(sourceSkills, entry.name), join(target, entry.name), { recursive: true })
}
console.log(`\nrebuilt ${replaced} upstream-owned entr${replaced === 1 ? 'y' : 'ies'}, kept ${kept} own skill(s)`)

// Remove upstream entries that no longer exist, so a deleted upstream skill
// does not linger. Own skills are exempt by construction.
const upstreamNames = new Set(readdirSync(sourceSkills))
for (const entry of readdirSync(target, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue
  if (own.has(entry.name)) continue
  if (!upstreamNames.has(entry.name)) {
    rmSync(join(target, entry.name), { recursive: true, force: true })
  }
}
console.log('\nadaptations applied:')
const summary = applyAdaptations(target, { log: true })
console.log(`    tool mapping installed: ${MAPPING_REL}`)
console.log(`    files in tree: ${summary.files}`)

// Re-materialise the tool mapping (it lives inside an upstream-owned
// directory that was just rebuilt) and regenerate every derived artifact. This step is mandatory, not advisory:
// the rebuild above deleted our own skills along with the upstream tree, so
// skipping it would leave the package with a different skill set than its
// README and tests describe.
// Still required: the tool mapping lives inside an upstream-owned directory
// (`using-superpowers/references/`), which was just rebuilt. Regenerating also
// refreshes the derived tables and the test expectations in one step.
console.log('\nregenerating derived artifacts:')
try {
  execFileSync(process.execPath, [join(packageRoot, 'scripts', 'generate-artifacts.mjs')], {
    stdio: 'inherit',
  })
} catch {
  console.error('\nERROR: generate-artifacts failed.')
  console.error('Fix the error above, then re-run: node scripts/generate-artifacts.mjs')
  process.exit(1)
}

console.log('\nnext steps:')
console.log(`  1. set "upstream.tag"${tag === undefined ? '' : ` to "${tag}"`} and "upstream.synced" to today in package.json`)
if (head !== undefined) console.log(`  2. set "upstream.commit" to "${head}"`)
console.log(`  3. record the new baseline: node scripts/check-upstream.mjs --record-baseline --offline <checkout>`)
console.log('  4. run: node tests/test-plugin.mjs')
