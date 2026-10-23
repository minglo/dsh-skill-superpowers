// Superpowers for the DeepSeek Harness (dsh) — the "path B" adapter.
//
// This plugin contributes Superpowers to dsh through the harness's OWN surfaces
// rather than reimplementing them:
//
//   1. `ctx.skills.registerProvider(...)` — the vendored `skills/` tree is served
//      by dsh's own `@deepseek-ai/dsh-skill-filesystem` provider, mounted as a
//      private instance pointed at this package. Using the official provider gets
//      its frontmatter parsing, flat-file support, `whenToUse`, `invocation`
//      policy, symlink handling and directory watching for free — including
//      improvements shipped in future dsh releases.
//
//   2. `ctx.systemPrompt.section(...)` — the `using-superpowers` bootstrap is
//      contributed as an always-on system-prompt section. dsh has no
//      session-start hook channel, and the system-prompt registry is the
//      sanctioned always-on contribution point: assembled into every request
//      from the first turn, no per-session opt-in (the port requirement), and
//      stable as a prompt prefix instead of a re-emitted user message that
//      would grow the transcript every turn.
//
// Why the official provider is imported lazily, inside `apply()`:
//
//   A static `import` of a dsh-internal package makes the whole module fail to
//   load when that package is not resolvable from the profile's node_modules —
//   the plugin then cannot even report why. Importing on activation lets the
//   plugin degrade with a clear diagnostic instead of a bare
//   ERR_MODULE_NOT_FOUND, and keeps `--dump-config` working on hosts without it.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createFallbackProvider } from './lib/fallback-provider.js'

/** Directory holding this plugin module. */
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))

/** Cordis plugin name. */
export const name = 'superpowers'

/** dsh services this plugin registers against. */
export const inject = ['skills', 'systemPrompt']

/** Skill-provider name, unique within the calling context's layer. */
const PROVIDER_NAME = 'superpowers'
/** The bootstrap skill whose body is injected every session. */
const BOOTSTRAP_SKILL = 'using-superpowers'
/** Skill body filename, used only to validate a candidate skills root. */
const SKILL_FILE = 'SKILL.md'
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
/** The official provider, imported lazily. */
const FILESYSTEM_PROVIDER = '@deepseek-ai/dsh-skill-filesystem'

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
    // `registerProvider` must be called synchronously during apply, so the
    // official provider is resolved lazily: registration happens now, the
    // module import happens on first discovery. dsh's provider contract
    // explicitly allows this — "remote initialization, authentication, and
    // discovery are awaited inside `list()`".
    ctx.skills.registerProvider((control) => {
      let pending
      const resolveDelegate = () => {
        if (pending !== undefined) return pending
        pending = import(FILESYSTEM_PROVIDER)
          .then(({ FileSystemSkillProvider }) => new FileSystemSkillProvider(ctx, control, {
            providerName: settings.providerName,
            // A private root only: the project/user roots belong to the
            // harness's own filesystem provider instance. `watch` is left to the
            // provider's own default (true), so watching behaves exactly like
            // the harness's other skill roots and improves with it.
            includeDefaultRoots: false,
            bundledSkillDir: skillsDir,
          }))
          .catch((error) => {
            // The official provider is not resolvable from here. On the Desktop
            // build it lives only inside `app.asar`, which the profile's
            // node_modules cannot reach; on a CLI install a misconfigured profile
            // looks the same. Either way an empty catalog is the wrong answer:
            // fall back to the built-in provider so the skills still load.
            //
            // Do not memoize the failure: a later catalog refresh retries, so a
            // transient resolution problem upgrades back to the official provider.
            pending = undefined
            logger.warn(
              `cannot load ${FILESYSTEM_PROVIDER} (${messageOf(error)}). Serving the skill `
              + 'catalog through the built-in fallback provider instead; the official '
              + 'provider is retried on the next catalog refresh.',
            )
            return createFallbackProvider({
              skillsDir,
              providerName: settings.providerName,
              logger,
            })
          })
        return pending
      }

      return {
        name: settings.providerName,
        async list(options) {
          const delegate = await resolveDelegate()
          return delegate === undefined ? [] : delegate.list(options)
        },
        async get(candidate, options) {
          const delegate = await resolveDelegate()
          return delegate === undefined ? undefined : delegate.get(candidate, options)
        },
        // The official provider also self-disposes when `control.signal` aborts,
        // which is what the harness relies on; forwarding `dispose` keeps the
        // wrapper a faithful drop-in for callers that tear down explicitly.
        async dispose() {
          const delegate = await resolveDelegate()
          await delegate?.dispose()
        },
      }
    })
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
  const normalized = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/)
  if (match === null) return undefined
  const body = match[2].trim()
  return body === '' ? undefined : body
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
