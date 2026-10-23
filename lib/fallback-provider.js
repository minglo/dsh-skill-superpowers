// Fallback skill provider: serves a vendored `skills/` tree WITHOUT depending on
// `@deepseek-ai/dsh-skill-filesystem` resolving from the profile.
//
// Why this exists:
//
//   The primary path delegates to dsh's own `FileSystemSkillProvider`, which is
//   the better implementation — it parses frontmatter, honours `whenToUse` and
//   `invocation`, watches directories, and improves with every dsh release.
//   But that package lives INSIDE the dsh installation. In the Desktop build it
//   is only present in `app.asar`, which the profile's `node_modules` cannot
//   resolve, so `import('@deepseek-ai/dsh-skill-filesystem')` rejects.
//
//   The plugin's existing degradation path logs and returns no skills, which on
//   Desktop means the whole catalog silently disappears. This module is the
//   seam that keeps the catalog working there: a minimal, dependency-free
//   implementation of the same provider protocol, used only when delegation
//   fails.
//
// Scope discipline: this is a *fallback*, not a reimplementation. It supports
// directory bundles (`<name>/SKILL.md`) with a flat YAML frontmatter block and
// scalar values, which is exactly what Superpowers ships. Anything richer is
// the official provider's job.

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Rank matching dsh's BUNDLED_SKILL_RANK: project and user skills win. */
const BUNDLED_SKILL_RANK = 600

/**
 * Parse a leading YAML frontmatter block into scalar metadata plus the body.
 *
 * Only the shapes Superpowers actually uses are interpreted: `key: value` lines
 * with optional matching quotes. A value that is a block-scalar header (`>-`,
 * `|`) or a sequence is reported as unsupported rather than silently mangled,
 * so the caller can log it and a future upstream change cannot quietly produce
 * a skill whose description is the string ">-".
 *
 * @param text - raw `SKILL.md` contents.
 * @returns the metadata, the body after the block, and any unsupported keys.
 */
export function parseFrontmatter(text) {
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(normalized)
  if (match === null) return undefined

  const metadata = {}
  const unsupported = []
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const entry = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(line)
    // Indented continuation lines and list items are part of the previous
    // key's unsupported value; they are not standalone entries.
    if (entry === null) continue
    let value = entry[2].trim()
    if (/^[|>][+-]?\d*$/.test(value) || value === '') {
      unsupported.push(entry[1])
      value = ''
    } else if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1)
      || (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1)
    }
    metadata[entry[1]] = value
  }
  return { metadata, body: match[2].replace(/^\s+/, '').trimEnd(), unsupported }
}

/**
 * Read and parse one skill directory.
 * @param skillFile - absolute path to its `SKILL.md`.
 * @param signal - optional cancellation.
 * @returns the parsed record, or `undefined` when unreadable or unparseable.
 */
async function readSkill(skillFile, signal) {
  if (signal?.aborted === true) return undefined
  let text
  try {
    text = await readFile(skillFile, 'utf8')
  } catch {
    return undefined
  }
  if (signal?.aborted === true) return undefined
  const parsed = parseFrontmatter(text)
  if (parsed === undefined) return undefined
  const name = typeof parsed.metadata.name === 'string' ? parsed.metadata.name.trim() : ''
  if (name === '') return undefined
  return { ...parsed, name }
}

/**
 * Discover directory-bundle skills under one root.
 * @param skillsDir - absolute path to a `skills/` directory.
 * @param signal - optional cancellation.
 * @returns one candidate per `<name>/SKILL.md`.
 */
export async function discover(skillsDir, signal, logger) {
  let entries
  try {
    entries = await readdir(skillsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const candidates = []
  for (const entry of entries) {
    if (signal?.aborted === true) break
    if (!entry.isDirectory()) continue
    const skillDir = join(skillsDir, entry.name)
    const skillFile = join(skillDir, 'SKILL.md')
    // Skip directories that are not skill bundles. `stat` also keeps this
    // cheap: a directory without a SKILL.md never reaches the read.
    const present = await stat(skillFile).then(
      (s) => s.isFile(),
      () => false,
    )
    if (!present) continue
    const parsed = await readSkill(skillFile, signal)
    if (parsed === undefined) continue
    if (parsed.unsupported.length > 0) {
      logger?.warn?.(
        `${entry.name}: unsupported frontmatter key(s) ${parsed.unsupported.join(', ')} `
        + '(multi-line or sequence values) — treating them as empty',
      )
    }
    if (parsed.name !== entry.name) {
      logger?.warn?.(
        `${entry.name}: frontmatter name "${parsed.name}" differs from its directory name`,
      )
    }
    candidates.push({
      name: parsed.name,
      description: parsed.metadata.description ?? '',
      ...(parsed.metadata.whenToUse === undefined ? {} : { whenToUse: parsed.metadata.whenToUse }),
      invocation: { modelInvocable: true, userInvocable: true },
      source: 'custom',
      provider: 'superpowers',
      rank: BUNDLED_SKILL_RANK,
      locator: skillDir,
      path: skillFile,
      metadata: parsed.metadata,
    })
  }
  return candidates
}

/**
 * Build the fallback provider.
 * @param skillsDir - absolute path to the vendored `skills/` tree.
 * @param providerName - the name to advertise.
 * @param logger - optional structured logger for diagnostics.
 * @returns a `SkillProvider`-shaped object.
 */
export function createFallbackProvider({ skillsDir, providerName, logger }) {
  return {
    name: providerName,
    async list(options = {}) {
      return discover(skillsDir, options.signal, logger)
    },
    async get(candidate, options = {}) {
      const parsed = await readSkill(candidate.path, options.signal)
      if (parsed === undefined) return undefined
      return {
        name: parsed.name,
        description: parsed.metadata.description ?? '',
        ...(parsed.metadata.whenToUse === undefined ? {} : { whenToUse: parsed.metadata.whenToUse }),
        invocation: { modelInvocable: true, userInvocable: true },
        source: 'custom',
        provider: providerName,
        resourceBase: { kind: 'directory', path: candidate.locator },
        path: candidate.path,
        metadata: parsed.metadata,
        content: parsed.body,
      }
    },
    async dispose() {},
  }
}
