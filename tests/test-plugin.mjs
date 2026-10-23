// End-to-end test: mount the plugin against stub dsh services and assert the
// two contributions behave, mirroring how the harness drives them.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test, { after } from 'node:test'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Fail once, clearly, instead of three times confusingly.
//
// The technical floor is Node 22: the dsh filesystem provider starts its watcher
// with `Promise.withResolvers`, and on anything older the watch throws, `list()`
// returns a `{candidates, complete}` page instead of the skill array, and the
// resulting failures look like bugs in this package rather than a wrong Node.
//
// The declared floor is Node 24 (`engines`), because that is the version this
// suite is actually run and verified against — npm reports "Unsupported engine"
// below it, so complaining here too keeps the two from disagreeing.
const REQUIRED_NODE_MAJOR = 24
const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < REQUIRED_NODE_MAJOR) {
  throw new Error(
    `Node ${process.version} is unsupported: this package needs Node >= ${REQUIRED_NODE_MAJOR}. `
    + 'Below 22 the dsh skill provider cannot start its watcher (Promise.withResolvers), '
    + 'so every skill silently disappears; 22 and 23 work but are not what we test.',
  )
}
if (typeof Promise.withResolvers !== 'function') {
  throw new Error(
    `Node ${process.version} lacks Promise.withResolvers, which the dsh skill provider `
    + 'needs; without it the watcher fails and every skill silently disappears.',
  )
}

const EXPECTED_SKILLS = [
  // artifacts:expected-skills:begin
  'brainstorming',
  'diagnosing-superpowers',
  'dispatching-parallel-agents',
  'executing-plans',
  'finishing-a-development-branch',
  'receiving-code-review',
  'requesting-code-review',
  'subagent-driven-development',
  'systematic-debugging',
  'test-driven-development',
  'using-git-worktrees',
  'using-superpowers',
  'verification-before-completion',
  'writing-plans',
  'writing-skills',
  // artifacts:expected-skills:end
]

/** Mount the plugin against stub services and return what it registered. */
async function mount(config = {}) {
  const mod = await import(pathToFileURL(join(packageRoot, 'index.js')).href)
  const providers = []
  const sections = []
  const logs = { info: [], warn: [], error: [] }
  const ctx = {
    get: () => undefined,
    logger: {
      info: (m) => logs.info.push(m),
      warn: (m) => logs.warn.push(m),
      error: (m) => logs.error.push(m),
      debug: () => {},
    },
    skills: { registerProvider: (factory) => { providers.push(factory); return () => {} } },
    systemPrompt: { section: (section) => { sections.push(section); return () => {} } },
    effect: (fn) => fn(),
  }
  // `watch` is the provider's own default (true) and the plugin no longer
  // overrides it, so every mount starts a live chokidar watcher that holds the
  // event loop open. `instantiate()` registers each provider it builds and the
  // `after()` hook at the bottom of this file disposes them all, or the runner
  // would never exit.
  mod.apply(ctx, config)
  return { providers, sections, logs, mod }
}

/** Providers built during the run, so their watchers can be torn down. */
const liveProviders = []

/** Drive a provider factory to a resolved provider instance. */
async function instantiate(factory) {
  const provider = await factory({ signal: new AbortController().signal, invalidate: () => {} })
  liveProviders.push(provider)
  return provider
}

test('module exports the cordis shape dsh loads', async () => {
  const mod = await import(pathToFileURL(join(packageRoot, 'index.js')).href)
  assert.equal(mod.name, 'superpowers')
  assert.deepEqual(mod.inject, ['skills', 'systemPrompt'])
  assert.equal(typeof mod.apply, 'function')
  assert.equal(typeof mod.default.apply, 'function')
})

test('package.json records the dsh bundle, the widened peer range and upstream provenance', () => {
  const pkg = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  assert.deepEqual(pkg.dsh, { bundle: { patch: './cordis.patch.yml' } })
  assert.ok(pkg.files.includes('skills'), 'the skills tree ships with the package')
  assert.ok(pkg.files.includes('references'), 'references ship with the package')

  // The peer range deliberately spans the prerelease line; dsh validates peers
  // with includePrerelease, under which one range covers 0.0/0.1/0.2.
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-skill-filesystem'], '>=0.0.1-rc.1 <0.3.0-0')
  assert.equal(pkg.peerDependenciesMeta['@deepseek-ai/dsh-skill-filesystem'].optional, true)

  // The repository is asserted by shape, not by literal: package.json#upstream
  // is the single source the scripts read, so a re-pointed upstream is a
  // one-line change and this test should not need editing with it.
  assert.match(pkg.upstream.repository, /^https:\/\/github\.com\/[^/]+\/[^/]+$/)
  assert.match(pkg.upstream.tag, /^v\d+\.\d+\.\d+$/)
  assert.match(pkg.upstream.commit, /^[0-9a-f]{40}$/)
  assert.match(pkg.upstream.synced, /^\d{4}-\d{2}-\d{2}$/)
})

test('apply registers exactly one provider and one bootstrap section', async () => {
  const { providers, sections } = await mount()
  assert.equal(providers.length, 1)
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'superpowers:bootstrap')
  // The order is fixed rather than configurable: dsh's own sections sit at
  // -1000/0/500/600/1000+, so 121 lands after the persona and before policy.
  assert.equal(sections[0].order, 121)
  assert.equal(typeof sections[0].text, 'function')
})

test('the provider serves every vendored skill through the official provider', async () => {
  const { providers } = await mount()
  const provider = await instantiate(providers[0])
  assert.equal(provider.name, 'superpowers')

  const list = await provider.list({ cwd: packageRoot })
  assert.deepEqual([...list.map((c) => c.name)].sort(), [...EXPECTED_SKILLS].sort())

  // rank 600 == BUNDLED_SKILL_RANK: a project or user skill of the same name wins.
  for (const candidate of list) {
    assert.equal(candidate.rank, 600, `${candidate.name} should sit at the bundled rank`)
    assert.equal(candidate.provider, 'superpowers')
  }
})

test('every skill body loads, is non-trivial and strips frontmatter', async () => {
  const { providers } = await mount()
  const provider = await instantiate(providers[0])
  const list = await provider.list({ cwd: packageRoot })

  for (const candidate of list) {
    const definition = await provider.get(candidate, { cwd: packageRoot })
    assert.ok(definition, `${candidate.name} should load`)
    assert.ok(definition.content.length > 200, `${candidate.name} body looks truncated`)
    assert.ok(!definition.content.startsWith('---'), `${candidate.name} kept its frontmatter`)
    // resourceBase must point at the skill directory so relative resources resolve.
    assert.equal(definition.resourceBase.kind, 'directory')
    assert.ok(definition.resourceBase.path.endsWith(candidate.name), `${candidate.name} resourceBase`)
  }
})

test('the bootstrap carries the marker, the body and the tool mapping', async () => {
  const { sections } = await mount()
  const text = sections[0].text()
  assert.match(text, /<EXTREMELY_IMPORTANT>/)
  assert.match(text, /superpowers:using-superpowers bootstrap for dsh/)
  assert.match(text, /already loaded/i)
  assert.match(text, /DeepSeek Harness \(dsh\) Tool Mapping/)
  assert.match(text, /<\/EXTREMELY_IMPORTANT>/)
  // The bootstrap must not leak the skill's own frontmatter.
  assert.ok(!/^---/m.test(text.split('\n').slice(0, 12).join('\n')))
})

test('the bootstrap body comes from the vendored skills root', async () => {
  const { sections } = await mount()
  const text = sections[0].text()
  const skill = readFileSync(join(packageRoot, 'skills/using-superpowers/SKILL.md'), 'utf8')
  const body = skill.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '').trim()
  assert.ok(text.includes(body.split('\n')[0]), 'bootstrap should include the skill body')
  assert.match(text, /Skill Priority/)
})

test('skills, bootstrap and toolMapping can be disabled independently', async () => {
  const off = await mount({ skills: false, bootstrap: false })
  assert.equal(off.providers.length, 0)
  assert.equal(off.sections.length, 0)

  const noMapping = await mount({ toolMapping: false })
  const text = noMapping.sections[0].text()
  assert.match(text, /<EXTREMELY_IMPORTANT>/)
  assert.ok(!text.includes('DeepSeek Harness (dsh) Tool Mapping'), 'mapping should be omitted')
})

test('providerName is configurable, and the section order is not', async () => {
  const { providers, sections } = await mount({ providerName: 'sp-custom', order: 33 })
  const provider = await instantiate(providers[0])
  assert.equal(provider.name, 'sp-custom')
  // `order` is not part of the config surface: a stray value is ignored, so a
  // profile that still carries a stale `order:` cannot misplace the bootstrap.
  assert.equal(sections[0].order, 121)
})

test('an explicit skillsDir wins over the vendored tree', async () => {
  const override = join(packageRoot, 'skills')
  const { logs } = await mount({ skillsDir: override })
  assert.ok(logs.info.some((m) => m.includes(override)), 'should log the configured root')
})

test('a host with no skills root degrades without failing activation', async () => {
  const { providers, sections, logs } = await mount({ skillsDir: '/nonexistent/superpowers' })
  // The bad explicit root is skipped in favour of the vendored tree.
  assert.equal(sections.length, 1)
  assert.ok(providers.length === 1)

  const saved = process.env.SUPERPOWERS_SKILLS_DIR
  try {
    // With every candidate broken, activation must still succeed.
    const isolated = await mount({ skillsDir: '/nonexistent/a' })
    assert.ok(isolated.providers.length === 1 || isolated.logs.warn.length > 0)
  } finally {
    if (saved === undefined) delete process.env.SUPERPOWERS_SKILLS_DIR
    else process.env.SUPERPOWERS_SKILLS_DIR = saved
  }
  assert.ok(Array.isArray(logs.warn))
})

test('scripts the skills invoke directly keep their executable bit', (t) => {
  // NTFS has no POSIX mode bits: `statSync().mode & 0o111` is always 0 there,
  // whatever the file is, so asserting on it tests the host rather than the
  // package. The bit that matters on Windows is git's, and the index plus
  // .gitattributes carry it. Skip with a reason instead of failing.
  if (process.platform === 'win32') {
    t.skip('NTFS has no POSIX mode bits; git carries the 100755 instead')
    return
  }
  const expected = [
    'brainstorming/scripts/start-server.sh',
    'subagent-driven-development/scripts/review-package',
    'subagent-driven-development/scripts/task-brief',
    'subagent-driven-development/scripts/sdd-workspace',
    'executing-plans/scripts/task-start',
    'executing-plans/scripts/task-done',
  ]
  for (const rel of expected) {
    const mode = statSync(join(packageRoot, 'skills', rel)).mode
    assert.ok(mode & 0o111, `${rel} should be executable`)
  }
})

test('the plugin leaves watching to the provider default', async () => {
  // `watch` is no longer a plugin config key: the provider's own zod schema
  // defaults it to true, so watching behaves exactly like the harness's other
  // skill roots. Confirm a provider built through the plugin sees every skill
  // with a live watcher attached; `after()` disposes it so the runner exits.
  const { providers } = await mount()
  const provider = await instantiate(providers[0])
  const list = await provider.list({ cwd: packageRoot })
  assert.equal(list.length, EXPECTED_SKILLS.length)
})

test('no skill still carries a Claude Code namespace reference', () => {
  // The adapter's strip pass rewrites every `superpowers:<name>` cross-reference
  // to the bare DSH skill name. The tool mapping is intentionally exempt: it
  // explains that no such prefix exists on dsh, so mentioning one is the point.
  const exempt = new Set([
    'skills/using-superpowers/references/dsh-tools.md',
  ])
  let out = ''
  try {
    out = execFileSync('grep', ['-rl', 'superpowers:', join(packageRoot, 'skills')], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  } catch {
    // grep exits non-zero when nothing matches — that is the passing case.
    out = ''
  }
  const offenders = out
    .split('\n')
    .filter(Boolean)
    .map((line) => line.replace(packageRoot + '/', ''))
    .filter((rel) => !exempt.has(rel))
  assert.deepEqual(offenders, [], `these files still reference superpowers: ${offenders.join(', ')}`)

  // The exempt file must be explanatory, not an instruction to call a prefixed name.
  const mapping = readFileSync(join(packageRoot, 'skills/using-superpowers/references/dsh-tools.md'), 'utf8')
  assert.match(mapping, /Names carry no\s+`superpowers:` prefix/)
})

test('the harness-neutral pass touches only home paths, never harness names', () => {
  // The pass exists to stop a dsh user being sent to `~/.claude/...`, which does
  // not exist here. It must NOT rename the instruction file itself: upstream
  // names the instruction files as a list, "(CLAUDE.md, AGENTS.md, GEMINI.md,
  // …)", so a bare rename turns it into "(AGENTS.md, AGENTS.md, …)" and a
  // rename on disk leaves a file whose name and contents disagree. Both
  // regressions shipped once.
  for (const rel of [
    'skills/using-superpowers/SKILL.md',
    'skills/diagnosing-superpowers/prompts/request-conflicts.md',
  ]) {
    const text = readFileSync(join(packageRoot, rel), 'utf8')
    assert.ok(
      !/AGENTS\.md,\s*AGENTS\.md/.test(text),
      `${rel} repeats AGENTS.md in one list`,
    )
    assert.match(text, /CLAUDE\.md/, `${rel} should keep naming CLAUDE.md verbatim`)
  }

  // The worked example keeps its upstream filename and contents: it is a record
  // of a test campaign run against Claude Code, not advice for a dsh user.
  const example = join(packageRoot, 'skills/writing-skills/references/CLAUDE_MD_TESTING.md')
  assert.ok(existsSync(example), 'the example should keep its upstream name')
  assert.ok(
    !existsSync(join(packageRoot, 'skills/writing-skills/references/AGENTS_MD_TESTING.md')),
    'no renamed copy should be produced',
  )
  assert.match(readFileSync(example, 'utf8'), /~\/\.claude\/skills\//, 'its recorded paths are evidence')
})

test('CREATION-LOG.md keeps the paths it recorded, not rewritten ones', () => {
  // A creation log is history: "Extracted debugging framework from
  // `~/.claude/CLAUDE.md`" says what happened. Retargeting that path would
  // make the record false, so the harness-neutral pass must skip these files.
  const log = readFileSync(join(packageRoot, 'skills/systematic-debugging/CREATION-LOG.md'), 'utf8')
  assert.match(log, /\.claude\/CLAUDE\.md/, 'the recorded path should survive untouched')
  assert.ok(!/\.agents\/AGENTS\.md/.test(log), 'history should not be retargeted')
})

// Watching is the provider's own default (true) and the plugin deliberately does
// not override it, so every provider built here owns a live watcher.
//
// That makes teardown worth spelling out. On Node < 22 the provider cannot start
// its watcher at all: `@deepseek-ai/dsh-skill-filesystem` calls
// `Promise.withResolvers`, which only exists from Node 22. Measured on Node
// 20.19.5 with watch at its default:
//
//   warn: skill-filesystem: failed to watch <dir>: TypeError:
//         Promise.withResolvers is not a function
//   list()  -> { candidates, complete }        (NOT the 17-skill array)
//   after dispose() -> 57 FSWatcher handles still open
//
// Two consequences, and the second is the confusing one: the leaked handles hold
// the event loop, so the suite passes every assertion and then never exits. That
// is exactly how it presented in CI — Node 20 hung past ten minutes while the
// same suite finished in 0.1s on Node 22 locally.
//
// The package therefore requires Node >= 22 (`engines`), and CI pins 22. This
// teardown is defensive for anyone who runs the suite on an older interpreter
// anyway: `unref()` on top of `dispose()` is what actually lets the process exit.
// It is test-side scaffolding, not a claim about our own code — the plugin passes
// no `watch` option, so production behaviour matches every other dsh skill root.
after(async () => {
  await Promise.all(liveProviders.map((provider) => provider.dispose()))
  for (const handle of process._getActiveHandles()) {
    if (handle?.constructor?.name === 'FSWatcher' && typeof handle.unref === 'function') {
      handle.unref()
    }
  }
})
