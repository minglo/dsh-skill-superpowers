// Superpowers for the DeepSeek Harness (dsh) — the "path B" adapter.
//
// This plugin contributes Superpowers to dsh through the harness's OWN surfaces
// rather than reimplementing them:
//
//   1. `ctx.skills.register(...)` — the vendored `skills/` tree is read once at
//      activation and registered as runtime skills on dsh's own skill registry
//      (`@deepseek-ai/dsh-skill`). Only the registry is needed, and every dsh
//      deployment carries it, so there is one code path everywhere: CLI, Web,
//      SDK and the Desktop build. No `@deepseek-ai/dsh-skill-filesystem` import,
//      no resolution probe, no fallback that behaves differently from the
//      primary path.
//
//      The trade is that runtime skills carry the registry's fixed runtime rank
//      (250), which outranks user-scope skills (400/500) and is outranked by
//      project-scope skills (100/200). For a plugin that ships its own catalog
//      that is the honest ordering: installing the plugin means its skills are
//      the ones the session sees, and a project may still override them.
//
//   2. `ctx.systemPrompt.section(...)` — the `using-superpowers` bootstrap is
//      contributed as an always-on system-prompt section. dsh has no
//      session-start hook channel, and the system-prompt registry is the
//      sanctioned always-on contribution point: assembled into every request
//      from the first turn, no per-session opt-in (the port requirement), and
//      stable as a prompt prefix instead of a re-emitted user message that
//      would grow the transcript every turn.
//
// Why the tree is read synchronously, once:
//
//   `register` belongs to activation, and the skills ship inside this package,
//   so they cannot change while the process runs. Reading them eagerly keeps
//   the catalog independent of the working directory, the profile layout and
//   any filesystem service, which is exactly where the previous provider
//   delegation broke on Desktop.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Directory holding this plugin module. */
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))

/** Cordis plugin name. */
export const name = 'superpowers'

/** dsh services this plugin registers against. */
export const inject = ['skills', 'systemPrompt']

/** Provider label shown for every registered skill. */
const PROVIDER_NAME = 'superpowers'
/** The bootstrap skill whose body is injected every session. */
const BOOTSTRAP_SKILL = 'using-superpowers'
/** Skill body filename, used only to validate a candidate skills root. */
const SKILL_FILE = 'SKILL.md'
/** The registry's kebab-case rule; a name outside it is dropped, not repaired. */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** Discovery source recorded on every skill, matching packaged dsh providers. */
const SKILL_SOURCE = 'bundled'
/** Rendered at the top of the injected bootstrap, for tests and diagnostics. */
const BOOTSTRAP_MARKER = 'superpowers:using-superpowers bootstrap for dsh'
/** Prompt section name; unique per scope, so a second mount throws loudly. */
const BOOTSTRAP_SECTION = 'superpowers:bootstrap'
/**
 * Section order, fixed rather than configurable. `section()` requires a finite
 * number; dsh places its own sections at -1000 (harness identity), 0 (persona),
 * 500/600 (plan/team policy) and 1000+ (per-tool guidance), so 121 puts the
 * bootstrap after the persona and before every policy and tool block.
 */
const BOOTSTRAP_SECTION_ORDER = 121
/** Long-form tool mapping, relative to the bootstrap skill directory. */
const TOOL_MAPPING_REFERENCE = join('references', 'dsh-tools.md')

/**
 * Register the Superpowers skill catalog and bootstrap on dsh.
 *
 * @param ctx - cordis context carrying the injected `skills` and `systemPrompt` services.
 * @param config - optional plugin config; every key has an in-code default, so a
 *   composition may mount the plugin with no config at all.
 */
export function apply(ctx, config = {}) {
  const logger = createLogger(ctx)
  const settings = normalizeConfig(config)
  const skillsDir = resolveSkillsDir(config)

  if (skillsDir === undefined) {
    logger.warn(
      'skills directory not found — no Superpowers skills registered. Set the plugin '
      + '`skillsDir` config or the SUPERPOWERS_SKILLS_DIR environment variable to a '
      + 'Superpowers skills/ directory.',
    )
  } else if (settings.skills) {
    logger.info(`registering the Superpowers skill catalog from ${skillsDir}`)
    for (const skill of readSkills(skillsDir, settings.providerName, logger)) {
      // `register` binds its own teardown to the registry context; the extra
      // effect keeps the disposer attached to THIS plugin, so unloading the
      // plugin withdraws its skills instead of leaving them behind.
      ctx.effect(() => ctx.skills.register(skill))
    }
  }

  if (settings.bootstrap) {
    const bootstrap = createBootstrap({ skillsDir, toolMapping: settings.toolMapping, logger })
    if (bootstrap !== undefined) {
      ctx.systemPrompt.section({
        name: BOOTSTRAP_SECTION,
        order: BOOTSTRAP_SECTION_ORDER,
        text: bootstrap,
      })
    }
  }
}

/** Normalize plugin config, applying in-code defaults for every key. */
function normalizeConfig(config) {
  return {
    providerName: typeof config.providerName === 'string' && config.providerName.trim() !== ''
      ? config.providerName.trim()
      : PROVIDER_NAME,
    skills: config.skills ?? true,
    bootstrap: config.bootstrap ?? true,
    toolMapping: config.toolMapping ?? true,
  }
}

/**
 * Resolve the skills root, first candidate that looks like a Superpowers tree.
 *
 *   1. `config.skillsDir` (explicit)
 *   2. `SUPERPOWERS_SKILLS_DIR` environment variable
 *   3. `<package>/skills` — the vendored tree, the normal path
 *   4. `<package>/../skills` — an in-repo checkout beside this package
 */
function resolveSkillsDir(config) {
  const candidates = []
  const configured = typeof config.skillsDir === 'string' ? config.skillsDir.trim() : ''
  if (configured !== '') candidates.push(isAbsolute(configured) ? configured : resolve(configured))
  const fromEnv = (process.env.SUPERPOWERS_SKILLS_DIR ?? '').trim()
  if (fromEnv !== '') candidates.push(isAbsolute(fromEnv) ? fromEnv : resolve(fromEnv))
  candidates.push(join(PLUGIN_DIR, 'skills'))
  candidates.push(resolve(PLUGIN_DIR, '..', 'skills'))
  return candidates.find((candidate) => looksLikeSkillsDir(candidate))
}

/** True when `dir` holds a Superpowers skills tree. */
function looksLikeSkillsDir(dir) {
  return existsSync(join(dir, BOOTSTRAP_SKILL, SKILL_FILE))
}

/**
 * Read every skill bundle under `skillsDir` into registration input.
 *
 * The tree ships inside this package, so it is read once, synchronously, at
 * activation: no watcher, no cwd sensitivity, no filesystem service. A bundle
 * that cannot be parsed is reported and skipped rather than registered empty.
 *
 * @param skillsDir - absolute path to the vendored `skills/` tree.
 * @param providerName - provider label recorded on every skill.
 * @param logger - structured logger for diagnostics.
 * @returns registration inputs ready for `ctx.skills.register()`.
 */
function readSkills(skillsDir, providerName, logger) {
  let entries
  try {
    entries = readdirSync(skillsDir, { withFileTypes: true })
  } catch (error) {
    logger.warn(`cannot read the skills directory ${skillsDir}: ${messageOf(error)}`)
    return []
  }

  const skills = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue
    const skillDir = join(skillsDir, entry.name)
    const skillFile = join(skillDir, SKILL_FILE)
    let raw
    try {
      raw = readFileSync(skillFile, 'utf8')
    } catch (error) {
      // A directory without a SKILL.md is not a skill bundle; anything else is
      // an actual read failure and worth a line in the log.
      if (!['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error?.code)) {
        logger.warn(`cannot read ${skillFile}: ${messageOf(error)}`)
      }
      continue
    }

    const parsed = parseSkillFile(raw)
    if (parsed === undefined) {
      logger.warn(`${skillFile} has no usable frontmatter — skipped`)
      continue
    }
    if (!SKILL_NAME.test(parsed.name)) {
      logger.warn(`${skillFile} ignored: "${parsed.name}" is not a kebab-case skill name`)
      continue
    }
    if (parsed.name !== entry.name) {
      logger.warn(`${entry.name}: frontmatter name "${parsed.name}" differs from its directory name`)
    }
    if (parsed.description === '') {
      logger.warn(`${skillFile} ignored: frontmatter requires a description`)
      continue
    }

    skills.push({
      name: parsed.name,
      description: parsed.description,
      ...(parsed.whenToUse === undefined ? {} : { whenToUse: parsed.whenToUse }),
      invocation: parsed.invocation,
      source: SKILL_SOURCE,
      provider: providerName,
      // Relative references (`references/…`, `scripts/…`) resolve against the
      // bundle directory, exactly as they did through the filesystem provider.
      resourceBase: { kind: 'directory', path: skillDir },
      path: skillFile,
      content: parsed.body,
    })
  }
  return skills
}

/**
 * Parse one `SKILL.md` into the fields the registry accepts.
 * @param raw - file contents.
 * @returns the parsed skill, or `undefined` without a name.
 */
function parseSkillFile(raw) {
  const parsed = parseFrontmatterBlock(raw)
  if (parsed === undefined) return undefined
  const name = scalarField(parsed.metadata.name)
  if (name === undefined) return undefined
  return {
    name,
    description: scalarField(parsed.metadata.description) ?? '',
    whenToUse: scalarField(parsed.metadata.whenToUse),
    invocation: {
      modelInvocable: parsed.metadata['disable-model-invocation'] !== 'true',
      userInvocable: parsed.metadata['user-invocable'] !== 'false',
    },
    body: parsed.body,
  }
}

/**
 * Split a leading YAML frontmatter block into scalar metadata plus the body.
 *
 * Only the shapes Superpowers uses are interpreted: `key: value` lines with
 * optional matching quotes, plus the two invocation booleans. A block scalar or
 * sequence value yields an empty string, so a skill whose description depends
 * on one is skipped and reported instead of being registered with `">-"` as
 * its description. The official provider parses full YAML; this is the subset
 * the vendored tree actually contains.
 *
 * @param text - raw file contents.
 * @returns the metadata, the body after the block, or `undefined` without one.
 */
function parseFrontmatterBlock(text) {
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(normalized)
  if (match === null) return undefined

  const metadata = {}
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const entry = /^([A-Za-z][\w-]*):[ \t]*(.*)$/.exec(line)
    // Indented continuation lines belong to the previous key and are dropped:
    // none of the vendored skills use a multi-line scalar.
    if (entry === null) continue
    let value = entry[2].trim()
    if (/^[|>][+-]?\d*$/.test(value)) {
      value = ''
    } else if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1)
      || (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1)
    }
    metadata[entry[1]] = value
  }
  return { metadata, body: match[2].trim() }
}

/** Trimmed non-empty string field, or `undefined`. */
function scalarField(value) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * Build the bootstrap text provider.
 *
 * Returns `undefined` when the bootstrap cannot be read at all, so the caller
 * skips the section rather than registering one that throws on every assembly.
 */
function createBootstrap({ skillsDir, toolMapping, logger }) {
  if (skillsDir === undefined) return undefined
  const file = join(skillsDir, BOOTSTRAP_SKILL, SKILL_FILE)
  let cached
  try {
    cached = composeBootstrap(readFileSync(file, 'utf8'), { skillsDir, toolMapping })
    if (cached === undefined) {
      logger.warn(`${file} has no usable frontmatter — bootstrap skipped`)
    }
  } catch (error) {
    logger.warn(`cannot read the using-superpowers bootstrap at ${file}: ${messageOf(error)}`)
    return undefined
  }
  if (cached === undefined) return undefined
  // The body is stable for the process lifetime; watching would require
  // re-reading every turn for a file that only changes on plugin upgrade.
  return () => cached
}

/** Wrap the bootstrap skill body in the markers upstream uses across harnesses. */
function composeBootstrap(raw, { skillsDir, toolMapping }) {
  const body = stripFrontmatter(raw)
  if (body === undefined) return undefined
  const parts = [
    '<EXTREMELY_IMPORTANT>',
    'You have superpowers.',
    '',
    BOOTSTRAP_MARKER,
    '',
    '**The `using-superpowers` skill content is included below. It is ALREADY LOADED — '
    + 'you are currently following it. Do NOT call the `skill` tool to load '
    + '"using-superpowers" again.**',
    '',
    body,
  ]
  if (toolMapping) {
    const mapping = dshToolMapping(skillsDir)
    if (mapping !== undefined) parts.push('', mapping)
  }
  parts.push('</EXTREMELY_IMPORTANT>')
  return parts.join('\n')
}

/**
 * Read the long-form tool mapping so the bootstrap and `references/dsh-tools.md`
 * cannot drift: one source, two renderings.
 */
function dshToolMapping(skillsDir) {
  const file = join(skillsDir, BOOTSTRAP_SKILL, TOOL_MAPPING_REFERENCE)
  try {
    return readFileSync(file, 'utf8').trim()
  } catch {
    // The mapping is an enhancement; the bootstrap still works without it.
    return undefined
  }
}

/**
 * Remove a leading YAML frontmatter block, returning the body.
 * Returns `undefined` when the file has no frontmatter to strip.
 */
function stripFrontmatter(text) {
  const body = parseFrontmatterBlock(text)?.body
  return body === undefined || body === '' ? undefined : body
}

/** Structured logger over the context logger, falling back to no-ops. */
function createLogger(ctx) {
  const logger = ctx?.logger
  if (logger === undefined) return { info() {}, warn() {}, error() {} }
  const pick = (level) => (typeof logger[level] === 'function' ? logger[level].bind(logger) : () => {})
  return { info: pick('info'), warn: pick('warn'), error: pick('error') }
}

/** Human-readable message from an unknown thrown value. */
function messageOf(error) {
  return error instanceof Error ? error.message : String(error)
}

export default { name, inject, apply }
