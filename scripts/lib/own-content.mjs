// What belongs to this adapter, and what belongs to upstream.
//
// `skills/` is the vendored upstream tree. This package authors no skills inside
// it (the two maintenance skills live in `.agents/skills/`, outside both this
// root and the published package), so a sync rebuilds the whole tree from
// upstream. `artifacts.json` still carries the ownership maps, because a copy
// such as the tool mapping has to land *inside* an upstream-owned directory and
// both scripts must agree on it — so this module is their single reader.
import { readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

/** Read artifacts.json. */
function readManifest(packageRoot) {
  return JSON.parse(readFileSync(join(packageRoot, 'artifacts.json'), 'utf8'))
}

/** Absolute path of the skills root. */
export function skillsRoot(packageRoot) {
  const manifest = readManifest(packageRoot)
  return join(packageRoot, manifest.skillTree?.root ?? 'skills')
}

/**
 * Skill directory names this package authors itself inside `skills/`.
 *
 * Empty by design: the maintenance skills live in `.agents/skills/`, so every
 * directory under `skills/` belongs to upstream and a sync may rebuild it.
 */
export function ownSkillNames(packageRoot) {
  const manifest = readManifest(packageRoot)
  return new Set(manifest.skillTree?.own ?? [])
}

/**
 * Files that must exist inside `skills/` but whose master copy is kept outside
 * it, because a sync replaces the upstream-owned directory around them.
 *
 * Own skills are NOT here: they live outside `skills/` entirely. Only content
 * that has to live *inside* an upstream-owned directory needs this treatment.
 */
export function ownContentInSkillsTree(packageRoot) {
  const manifest = readManifest(packageRoot)
  const root = skillsRoot(packageRoot)
  const out = []
  for (const [from, to] of Object.entries(manifest.copies ?? {})) {
    if (from.startsWith('$') || to.startsWith('$')) continue
    // Only copies that land under skills/ belong to the sync's expected tree.
    const rel = relative(root, join(packageRoot, to))
    if (rel.startsWith('..') || rel === '' || resolve(root, rel) !== resolve(packageRoot, to)) continue
    out.push({ from: join(packageRoot, from), targetRel: rel.split(sep).join('/') })
  }
  return out.sort((a, b) => a.targetRel.localeCompare(b.targetRel))
}

// ---------------------------------------------------------------------------
// Upstream coordinates
// ---------------------------------------------------------------------------

/**
 * The upstream project this package vendors from, as recorded in package.json.
 *
 * `package.json#upstream` is the ONE place the upstream repository is named.
 * Scripts read it from here rather than hard-coding a URL, so renaming or
 * re-pointing upstream is a single edit and there is exactly one string to
 * audit.
 */
export function upstreamPin(packageRoot) {
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  const pin = manifest.upstream
  if (pin === undefined || typeof pin.repository !== 'string' || pin.repository === '') {
    throw new Error('package.json#upstream.repository is required to locate the vendored source')
  }
  return pin
}
