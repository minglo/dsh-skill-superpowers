// Report whether the vendored upstream project has moved past the pinned
// revision, and what the delta means for this dsh package.
//
// The repository to poll is package.json#upstream.repository — the single place
// upstream is named.
//
// Reporting is deliberately separate from adopting: a human decides whether a
// release is worth taking, `sync-skills.mjs` carries that decision out.
//
// Usage:
//   node scripts/check-upstream.mjs                 # report, exit 1 if stale
//   node scripts/check-upstream.mjs --json          # machine-readable
//   node scripts/check-upstream.mjs --offline DIR   # classify against a local checkout
//   node scripts/check-upstream.mjs --quiet         # exit code only
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
/**
 * Maintenance data describing what upstream shipped at the recorded pin.
 *
 * It lives here rather than in the package root because this script is its only
 * reader: it is observation data belonging to the monitor, not part of the
 * package's identity the way `artifacts.json` is (that one has five readers,
 * including the tests and CI).
 */
const BASELINE_PATH = join(packageRoot, 'scripts/upstream-baseline.json')
const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
const pin = pkg.upstream ?? {}
/** `own` names skills this package authors; empty here, read rather than assumed. */
const artifacts = JSON.parse(readFileSync(join(packageRoot, 'artifacts.json'), 'utf8'))

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const quiet = args.includes('--quiet')
const offlineIndex = args.indexOf('--offline')
const offline = offlineIndex === -1 ? undefined : resolve(args[offlineIndex + 1])
const recordBaseline = args.includes('--record-baseline')

/** A skill whose rendered SKILL.md grew/shrank past this ratio is "rebuilt". */
const REBUILT_RATIO = 1.5
/** Absolute line delta that also counts as rebuilt, for small files. */
const REBUILT_LINES = 40

/** Run a git command against the upstream repo, returning stdout or undefined. */
function git(cwd, argv) {
  try {
    return execFileSync('git', ['-C', cwd, ...argv], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

/** Every file under a directory as root-relative POSIX paths, sorted. */
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

/** Count lines in a file, 0 when unreadable. */
function lineCount(file) {
  try {
    return readFileSync(file, 'utf8').split('\n').length
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// --record-baseline: snapshot what upstream ships AT THE PIN
// ---------------------------------------------------------------------------

/**
 * Record the upstream baseline into package.json#upstream.baseline.
 *
 * The baseline is what makes this monitor useful. Comparing the target against
 * OUR tree would report everything we deliberately do not vendor — every other
 * harness's manifest and reference file — as "new upstream support" on every
 * run. Recording what upstream shipped at the pin gives a stable reference, and
 * deriving it mechanically means it cannot rot the way a hand-written list does.
 */
function recordBaselineInto(checkout) {
  const skillsDir = join(checkout, 'skills')
  const names = existsSync(skillsDir)
    ? readdirSync(skillsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name)
        .sort()
    : []
  const skillFiles = {}
  const skillLineCounts = {}
  for (const name of names) {
    const dir = join(skillsDir, name)
    skillFiles[name] = listFiles(dir)
    skillLineCounts[name] = lineCount(join(dir, 'SKILL.md'))
  }
  const harnessDirs = readdirSync(checkout, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\..+-plugin$/.test(e.name))
    .map((e) => e.name)
    .sort()
  const refsDir = join(skillsDir, 'using-superpowers/references')
  const harnessReferences = existsSync(refsDir)
    ? readdirSync(refsDir).filter((f) => f.endsWith('-tools.md') && f !== 'dsh-tools.md').sort()
    : []
  const hooksDir = join(checkout, 'hooks')
  const hooks = existsSync(hooksDir) ? readdirSync(hooksDir).sort() : []

  const baseline = {
    $comment:
      'What upstream shipped at the recorded pin. check-upstream.mjs diffs the target against '
      + 'THIS, not against our vendored tree, so what we deliberately do not vendor is never '
      + 'reported as upstream news. Regenerate with: node scripts/check-upstream.mjs '
      + '--record-baseline (it clones the pinned tag). Kept out of package.json because it is '
      + 'maintenance data, not package metadata, and no runtime code reads it.',
    harnessDirs,
    harnessReferences,
    hooks,
    skillCount: names.length,
    skillNames: names,
    skillFiles,
    skillLineCounts,
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8')
  return { names, harnessDirs, harnessReferences, hooks }
}

if (recordBaseline) {
  const dir = offline ?? mkdtempSync(join(tmpdir(), 'superpowers-baseline-'))
  const cleanup = offline === undefined
  try {
    if (offline === undefined) {
      execFileSync('git', ['clone', '--depth', '1', '--branch', pin.tag, report.upstreamRepo, dir], {
        stdio: ['ignore', 'ignore', 'pipe'],
      })
    }
    const recorded = recordBaselineInto(dir)
    console.log(`[monitor] baseline recorded from ${pin.tag}:`)
    console.log(`  skills            ${recorded.names.length}`)
    console.log(`  harness manifests ${recorded.harnessDirs.length}`)
    console.log(`  harness refs      ${recorded.harnessReferences.length}`)
    console.log(`  hooks             ${recorded.hooks.length}`)
  } catch (error) {
    console.error(`[monitor] --record-baseline failed: ${String(error).slice(0, 200)}`)
    process.exitCode = 2
  } finally {
    if (cleanup) rmSync(dir, { recursive: true, force: true })
  }
  process.exit(process.exitCode ?? 0)
}

// ---------------------------------------------------------------------------
// Locate the target revision
// ---------------------------------------------------------------------------

const report = {
  pin,
  upstreamRepo: pin.repository,
  latestTag: undefined,
  pinIsLatest: undefined,
  targetTag: undefined,
  targetCommit: undefined,
  checkout: undefined,
  changes: { added: [], changed: [], removed: [], rebuilt: [] },
  harnessSupport: { current: [], added: [] },
  exitCode: 0,
}

let checkoutDir = offline
const tempDirs = []

if (offline === undefined) {
  // Tags are cheap to list; use them to answer "is the pin current" without a clone.
  const tags = git(packageRoot, ['ls-remote', '--tags', report.upstreamRepo])
  if (tags === undefined) {
    console.error(`[monitor] cannot reach ${report.upstreamRepo} (no network or no git?)`)
    console.error('[monitor] re-run with --offline <checkout> to classify a local tree')
    process.exit(2)
  }
  const versions = [...tags.matchAll(/refs\/tags\/(v\d+\.\d+\.\d+)\s*$/gm)].map((m) => m[1])
  versions.sort((a, b) => {
    const pa = a.slice(1).split('.').map(Number)
    const pb = b.slice(1).split('.').map(Number)
    return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2]
  })
  report.latestTag = versions.at(-1)
  report.pinIsLatest = report.latestTag === pin.tag

  if (report.pinIsLatest) {
    report.exitCode = 0
    finish()
  }

  report.targetTag = report.latestTag
  const dir = mkdtempSync(join(tmpdir(), 'superpowers-monitor-'))
  tempDirs.push(dir)
  try {
    execFileSync('git', ['clone', '--depth', '1', '--branch', report.targetTag, report.upstreamRepo, dir], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    checkoutDir = dir
  } catch (error) {
    console.error(`[monitor] clone of ${report.targetTag} failed: ${String(error).slice(0, 200)}`)
    process.exit(2)
  }
} else {
  report.targetTag = git(checkoutDir, ['describe', '--tags', '--abbrev=0']) ?? '(local)'
  report.pinIsLatest = report.targetTag === pin.tag
}

report.checkout = checkoutDir
report.targetCommit = git(checkoutDir, ['rev-parse', 'HEAD'])

// ---------------------------------------------------------------------------
// Classify the delta against the recorded baseline
// ---------------------------------------------------------------------------

// The baseline is maintenance data (~190 lines), not package metadata, so it
// lives beside the scripts rather than inside package.json.
const baseline = existsSync(BASELINE_PATH)
  ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
  : {}
const theirSkillsDir = join(checkoutDir, 'skills')

/** Skill names present in a tree. */
function skillNames(root) {
  const dir = join(root, 'skills')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort()
}

const theirs = skillNames(checkoutDir)
// Skills this package authors live OUTSIDE `skills/` (in `.agents/skills/`, so
// only contributors in this repository see them). `artifacts.json#skillTree.own`
// therefore stays empty and every name under `skills/` is upstream's. Read the
// manifest rather than hard-coding names that a future change would desync.
const ownSkills = new Set(artifacts.skillTree?.own ?? [])

// The delta that matters is upstream-at-pin vs upstream-at-target. Comparing
// against OUR tree would report everything we deliberately do not vendor
// (every other harness's reference file, every harness manifest) as upstream
// news on every single run.
const baselineSkills = baseline.skillNames
report.changes.added = baselineSkills
  ? theirs.filter((s) => !baselineSkills.includes(s) && !ownSkills.has(s))
  : ['(no baseline recorded — run once with --record-baseline)']
report.changes.removed = baselineSkills
  ? baselineSkills.filter((s) => !theirs.includes(s))
  : []

// Shape changes: compare per-skill file inventories and SKILL.md sizes between
// the baseline pin's tree (cloned on demand) and the target.
for (const skill of theirs) {
  const theirsDir = join(theirSkillsDir, skill)
  const theirFiles = existsSync(theirsDir) ? listFiles(theirsDir) : []
  const base = baseline.skillFiles?.[skill]
  if (base) {
    for (const f of theirFiles) {
      if (!base.includes(f)) report.changes.changed.push(`${skill}/${f} (new file upstream)`)
    }
    for (const f of base) {
      if (!theirFiles.includes(f)) report.changes.removed.push(`${skill}/${f}`)
    }
  }
  const skillFile = join(theirsDir, 'SKILL.md')
  const lines = existsSync(skillFile) ? lineCount(skillFile) : 0
  const baseLines = baseline.skillLineCounts?.[skill]
  if (baseLines && lines) {
    const delta = lines - baseLines
    const ratio = lines / baseLines
    if (ratio >= REBUILT_RATIO || ratio <= 1 / REBUILT_RATIO || Math.abs(delta) >= REBUILT_LINES) {
      report.changes.rebuilt.push(`${skill}/SKILL.md  ${baseLines} -> ${lines} lines`)
    }
  }
}

// ---------------------------------------------------------------------------
// Harness support: the highest-value signal
// ---------------------------------------------------------------------------

/** Per-harness manifest directories at the repo root. */
function harnessDirs(root) {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\..+-plugin$/.test(e.name))
    .map((e) => e.name)
    .sort()
}

const theirHarness = harnessDirs(checkoutDir)
const knownHarness = new Set(baseline.harnessDirs ?? [])
report.harnessSupport.current = theirHarness
report.harnessSupport.added = theirHarness.filter((h) => !knownHarness.has(h))

// A new harness ships a new references/<name>-tools.md. Our prune list names
// each unsupported harness explicitly, so a new one must be added there.
const theirRefsDir = join(theirSkillsDir, 'using-superpowers/references')
const theirRefs = existsSync(theirRefsDir) ? readdirSync(theirRefsDir) : []
const knownRefs = new Set(baseline.harnessReferences ?? [])
report.harnessSupport.newReferenceFiles = theirRefs.filter(
  (f) => f.endsWith('-tools.md') && f !== 'dsh-tools.md' && !knownRefs.has(f),
)

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const stale =
  report.pinIsLatest === false ||
  report.changes.added.length > 0 ||
  report.changes.rebuilt.length > 0 ||
  report.changes.removed.length > 0
report.exitCode = stale ? 1 : 0

function finish() {
  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
  } else if (!quiet) {
    printHuman()
  }
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true })
  process.exit(report.exitCode)
}

function printHuman() {
  const line = (s) => console.log(s)
  line('')
  line(`recorded pin : ${pin.tag ?? '(none)'}  ${(pin.commit ?? '').slice(0, 12)}  synced ${pin.synced ?? '?'}`)
  line(`upstream     : ${report.latestTag ?? report.targetTag ?? '(unknown)'}`)

  if (report.exitCode === 0) {
    line('')
    line('✓ pin is current — nothing to do')
    return
  }

  line('')
  line(`⚠ upstream has moved (${pin.tag} → ${report.targetTag})`)
  line('')

  if (report.changes.added.length) {
    line(`NEW SKILLS (${report.changes.added.length}) — the catalog grows:`)
    for (const s of report.changes.added) line(`  + ${s}`)
    line('  → check whether it can run on dsh before adopting it')
    line('')
  }
  if (report.changes.rebuilt.length) {
    line(`REBUILT SKILLS (${report.changes.rebuilt.length}) — behavior changes, not edits:`)
    for (const s of report.changes.rebuilt) line(`  ~ ${s}`)
    line('')
  }
  if (report.changes.removed.length) {
    line(`REMOVED (${report.changes.removed.length}):`)
    for (const s of report.changes.removed) line(`  - ${s}`)
    line('')
  }

  if (report.harnessSupport.added.length) {
    line(`NEW HARNESS SUPPORT (${report.harnessSupport.added.length}) — mirror the pattern:`)
    for (const h of report.harnessSupport.added) line(`  + ${h}/`)
    line('')
  }
  if (report.harnessSupport.newReferenceFiles?.length) {
    line('NEW per-harness reference files — add each to PRUNED_HARNESS_REFERENCES')
    line('in scripts/sync-skills.mjs, or it ships as a dangling file:')
    for (const f of report.harnessSupport.newReferenceFiles) line(`  + references/${f}`)
    line('')
  }

  line('next: node scripts/sync-skills.mjs <checkout> --tag ' + (report.targetTag ?? '<tag>'))
  line('      then: node scripts/generate-artifacts.mjs && node tests/test-plugin.mjs')
  line('')
}

finish()