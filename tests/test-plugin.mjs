// End-to-end test: mount the plugin against stub dsh services and assert the
// two contributions behave, mirroring how the harness drives them.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Fail once, clearly, instead of three times confusingly.
//
// The plugin itself only touches `node:fs` and the skill registry, so it has no
// hard runtime floor beyond what dsh requires. The declared floor is Node 24
// (`engines`) because that is the version this suite is run and verified
// against — npm reports "Unsupported engine" below it, so complaining here too
// keeps the two from disagreeing.
const REQUIRED_NODE_MAJOR = 24
const nodeMajor = Number(process.versions.node.split('.')[0])
if (nodeMajor < REQUIRED_NODE_MAJOR) {
  throw new Error(
    `Node ${process.version} is unsupported: this package needs Node >= ${REQUIRED_NODE_MAJOR}.`,
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
  const registered = []
  const sections = []
  const logs = { info: [], warn: [], error: [] }
  // The registry is stubbed rather than instantiated: `register` is the whole
  // contract this plugin uses, and capturing its input lets the tests assert
  // exactly what the model catalog would receive.
  const disposers = []
  const ctx = {
    get: () => undefined,
    logger: {
      info: (m) => logs.info.push(m),
      warn: (m) => logs.warn.push(m),
      error: (m) => logs.error.push(m),
      debug: () => {},
    },
    skills: { register: (skill) => { registered.push(skill); return () => {} } },
    systemPrompt: { section: (section) => { sections.push(section); return () => {} } },
    effect: (fn) => { const disposer = fn(); disposers.push(disposer); return disposer },
  }
  mod.apply(ctx, config)
  return { registered, sections, logs, disposers, mod }
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
  //
  // The registry is the only dsh package this plugin needs: skills are
  // registered through `ctx.skills.register`, so no skill-provider package has
  // to resolve from the profile. That is what makes one code path work on the
  // CLI, Web and Desktop builds alike.
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh-skill'], '>=0.0.1-rc.1 <0.3.0-0')
  assert.equal(pkg.peerDependenciesMeta, undefined, 'the registry peer is required, not optional')
  assert.equal(pkg.devDependencies['@deepseek-ai/dsh-skill'], '>=0.0.1-rc.1 <0.3.0-0')
  for (const field of ['peerDependencies', 'devDependencies', 'dependencies']) {
    const names = Object.keys(pkg[field] ?? {})
    const stray = names.filter((entry) => entry !== '@deepseek-ai/dsh-skill')
    assert.deepEqual(stray, [], `${field} should only carry the registry`)
  }

  // The repository is asserted by shape, not by literal: package.json#upstream
  // is the single source the scripts read, so a re-pointed upstream is a
  // one-line change and this test should not need editing with it.
  assert.match(pkg.upstream.repository, /^https:\/\/github\.com\/[^/]+\/[^/]+$/)
  assert.match(pkg.upstream.tag, /^v\d+\.\d+\.\d+$/)
  assert.match(pkg.upstream.commit, /^[0-9a-f]{40}$/)
  assert.match(pkg.upstream.synced, /^\d{4}-\d{2}-\d{2}$/)
})

test('apply registers every vendored skill and one bootstrap section', async () => {
  const { registered, sections, disposers } = await mount()
  assert.deepEqual([...registered.map((s) => s.name)].sort(), [...EXPECTED_SKILLS].sort())
  // Every registration is bound to this plugin's effect scope, so unloading the
  // plugin withdraws its skills instead of leaving them in the registry.
  assert.equal(disposers.length, registered.length)

  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'superpowers:bootstrap')
  // The order is fixed rather than configurable: dsh's own sections sit at
  // -1000/0/500/600/1000+, so 121 lands after the persona and before policy.
  assert.equal(sections[0].order, 121)
  assert.equal(typeof sections[0].text, 'function')
})

test('every registered skill is a complete definition the registry accepts', async () => {
  const { registered } = await mount()
  for (const skill of registered) {
    assert.ok(skill.description.length > 0, `${skill.name} needs a description`)
    assert.ok(skill.content.length > 200, `${skill.name} body looks truncated`)
    assert.ok(!skill.content.startsWith('---'), `${skill.name} kept its frontmatter`)
    assert.equal(skill.source, 'bundled')
    assert.equal(skill.provider, 'superpowers')
    assert.deepEqual(skill.invocation, { modelInvocable: true, userInvocable: true })
    // resourceBase must point at the skill directory so relative resources resolve.
    assert.equal(skill.resourceBase.kind, 'directory')
    assert.ok(skill.resourceBase.path.endsWith(skill.name), `${skill.name} resourceBase`)
    assert.ok(skill.path.endsWith(join(skill.name, 'SKILL.md')), `${skill.name} path`)
  }
})

test('a malformed skill is reported and skipped instead of registered empty', async () => {
  const root = mkdtempSync(join(tmpdir(), 'superpowers-skills-'))
  try {
    // Keep a valid bootstrap so the root is accepted, then add three bundles the
    // registry would reject: no frontmatter, an invalid name, no description.
    mkdirSync(join(root, 'using-superpowers'))
    writeFileSync(
      join(root, 'using-superpowers', 'SKILL.md'),
      '---\nname: using-superpowers\ndescription: bootstrap\n---\nbody\n',
    )
    mkdirSync(join(root, 'no-frontmatter'))
    writeFileSync(join(root, 'no-frontmatter', 'SKILL.md'), 'just text\n')
    mkdirSync(join(root, 'Bad_Name'))
    writeFileSync(join(root, 'Bad_Name', 'SKILL.md'), '---\nname: Bad_Name\ndescription: x\n---\nb\n')
    mkdirSync(join(root, 'no-description'))
    writeFileSync(join(root, 'no-description', 'SKILL.md'), '---\nname: no-description\n---\nb\n')

    const { registered, logs } = await mount({ skillsDir: root })
    assert.deepEqual(registered.map((s) => s.name), ['using-superpowers'])
    assert.ok(logs.warn.some((m) => m.includes('no usable frontmatter')))
    assert.ok(logs.warn.some((m) => m.includes('not a kebab-case skill name')))
    assert.ok(logs.warn.some((m) => m.includes('requires a description')))
  } finally {
    rmSync(root, { recursive: true, force: true })
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
  assert.equal(off.registered.length, 0)
  assert.equal(off.sections.length, 0)

  const noMapping = await mount({ toolMapping: false })
  const text = noMapping.sections[0].text()
  assert.match(text, /<EXTREMELY_IMPORTANT>/)
  assert.ok(!text.includes('DeepSeek Harness (dsh) Tool Mapping'), 'mapping should be omitted')
})

test('providerName labels the registrations, and the section order is not configurable', async () => {
  const { registered, sections } = await mount({ providerName: 'sp-custom', order: 33 })
  assert.ok(registered.length > 0)
  for (const skill of registered) assert.equal(skill.provider, 'sp-custom')
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
  const { registered, sections } = await mount({ skillsDir: '/nonexistent/superpowers' })
  // The bad explicit root is skipped in favour of the vendored tree.
  assert.equal(sections.length, 1)
  assert.ok(registered.length > 0)

  const saved = process.env.SUPERPOWERS_SKILLS_DIR
  process.env.SUPERPOWERS_SKILLS_DIR = '/nonexistent/env'
  try {
    // A bad env root must not break activation either: the vendored tree wins.
    const isolated = await mount({ skillsDir: '/nonexistent/a' })
    assert.equal(isolated.registered.length, EXPECTED_SKILLS.length)
  } finally {
    if (saved === undefined) delete process.env.SUPERPOWERS_SKILLS_DIR
    else process.env.SUPERPOWERS_SKILLS_DIR = saved
  }
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

test('the catalog is read once at activation, independent of the cwd', async () => {
  // Deliberately `cwd`-insensitive: the skills ship inside this package, so a
  // session opened anywhere sees the same catalog. This is the property that
  // makes the Desktop build behave like every other deployment.
  const first = await mount()
  const second = await mount({ skillsDir: join(packageRoot, 'skills') })
  assert.deepEqual(
    first.registered.map((s) => s.name),
    second.registered.map((s) => s.name),
  )
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

  // Exempt files must be explanatory, not an instruction to call a prefixed name.
  const mapping = readFileSync(join(packageRoot, 'skills/using-superpowers/references/dsh-tools.md'), 'utf8')
  assert.match(mapping, /Names carry no\s+`superpowers:` prefix/)
})

test('the harness-neutral pass rewrites home paths, never harness names', () => {
  // The pass exists so a dsh user is not sent to `~/.claude/...`, which does not
  // exist here. It must NOT rename the instruction file itself: upstream names
  // the files as a list, "(CLAUDE.md, AGENTS.md, GEMINI.md, …)", so a bare
  // rename turns it into "(AGENTS.md, AGENTS.md, …)"; and renaming the worked
  // example on disk leaves a file whose name and contents disagree.
  for (const rel of [
    'skills/using-superpowers/SKILL.md',
    'skills/diagnosing-superpowers/prompts/request-conflicts.md',
  ]) {
    const text = readFileSync(join(packageRoot, rel), 'utf8')
    assert.ok(!/AGENTS\.md,\s*AGENTS\.md/.test(text), `${rel} repeats AGENTS.md in one list`)
    assert.match(text, /CLAUDE\.md/, `${rel} should keep naming CLAUDE.md verbatim`)
  }

  // A worked example and a creation log are records of what happened, not
  // advice for a dsh user; retargeting their paths would falsify them.
  const example = join(packageRoot, 'skills/writing-skills/references/CLAUDE_MD_TESTING.md')
  assert.ok(existsSync(example), 'the example should keep its upstream name')
  assert.ok(
    !existsSync(join(packageRoot, 'skills/writing-skills/references/AGENTS_MD_TESTING.md')),
    'no renamed copy should be produced',
  )
  assert.match(readFileSync(example, 'utf8'), /~\/\.claude\/skills\//, 'its recorded paths are evidence')

  const log = readFileSync(join(packageRoot, 'skills/systematic-debugging/CREATION-LOG.md'), 'utf8')
  assert.match(log, /~\/\.claude\/CLAUDE\.md/, 'the recorded path should survive untouched')
})

test('the maintenance skills are contributors-only, not part of the served catalog', async () => {
  // They live in `.agents/skills/`, which dsh scans as the project scope for
  // anyone working in this repository. `package.json#files` ships no `.agents/`,
  // so users of the published package never see them — and the plugin itself
  // must not register them, because it only reads `<package>/skills`.
  for (const name of ['superpower-monitor-upstream', 'superpower-sync-upstream']) {
    assert.ok(
      existsSync(join(packageRoot, '.agents', 'skills', name, 'SKILL.md')),
      `${name} should exist in .agents/skills`,
    )
    assert.ok(
      !existsSync(join(packageRoot, 'skills', name)),
      `${name} should not be under the served skills/ tree`,
    )
  }

  const { registered } = await mount()
  for (const name of ['superpower-monitor-upstream', 'superpower-sync-upstream']) {
    assert.ok(
      !registered.some((skill) => skill.name === name),
      `${name} must not be registered by the plugin`,
    )
  }
})

