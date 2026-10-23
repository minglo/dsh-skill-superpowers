# dsh-skill-superpowers

**把 Superpowers 带到 DeepSeek Harness（dsh）上。** 装上它，你的 dsh agent 就具备了一整套
工程方法论 —— 头脑风暴、计划、TDD、系统化调试、代码评审、subagent 驱动开发 —— 并且会
**自主使用**：任务一匹配某个技能，agent 会先加载它再动手。

支撑这件事的有两点，都借助 dsh 自己的机制：

1. **技能并入 dsh 的技能目录**，由 dsh **自身**的 `@deepseek-ai/dsh-skill-filesystem`
   provider 提供服务（一个指向本包的私有实例）。agent 能看到它们，并用 dsh 原生的
   `skill` 工具加载任意一个。复用官方 provider 意味着 frontmatter 解析、扁平文件、
   `whenToUse`、调用策略、符号链接处理和目录监听全都来自 harness —— 包括后续 dsh
   版本里修好的问题。

   官方 provider 解析不到时，插件会退回到**内置的兜底 provider**：同样的
   `list()`/`get()` 协议、同样的 rank `600`、零运行时依赖，技能照常可用（见
   [为什么需要兜底](#为什么需要兜底)）。
2. **一段简短的「you have superpowers」引导段注入系统提示词**，让技能从每个会话的
   第一轮就生效 —— 无需配置，无需按会话开启。

所 vendor 的技能树固定在一个记录在案的上游版本
（`package.json` 里的 `upstream.tag` / `upstream.commit`），并且可重新同步：
`npm run sync-skills --check` 会逐文件报告漂移并以非零码退出。

## 安装

前置条件：可用的 dsh（`dsh plugin` 在 `PATH` 中）以及 **Node 24 或更高版本**。

硬性下限其实是 Node 22：dsh 的文件系统 provider 在启动目录监听时调用
`Promise.withResolvers`，该 API 从 Node 22 起才有。在 Node 20 上监听会抛错，
`list()` 返回 `{candidates, complete}` 而不是技能数组，**所有技能会静默消失**。
本包只在 Node 24 上验证，因此 `engines` 就写 `>=24` —— 只承诺实际测过的版本。

## 为什么需要兜底

官方 provider 是更好的实现，但它住在 **dsh 安装内部**，从 profile 的 `node_modules`
不一定解析得到。**Desktop 版就是这种情况**：整个 dsh 运行时打在 `app.asar` 里，
profile 里没有 `@deepseek-ai/dsh-skill-filesystem` 这个包，`import()` 直接 reject。

没有兜底时，这个失败表现为**技能全部静默消失**：`list()` 返回空数组，日志之外没有
任何症状，用户很难想到问题出在插件上。它和上面 Node 20 的坑是同一类故障 ——
「看起来装好了，但一个技能都没有」。

所以插件保留官方 provider 作为首选，只在它不可用时退到内置实现：

| | 官方 provider | 内置兜底 |
|---|---|---|
| 何时使用 | 解析得到就用 | 只在解析失败时 |
| 依赖 | `@deepseek-ai/dsh-skill-filesystem` | 无（仅 Node 内置模块） |
| 支持的技能形态 | 目录包 + 扁平文件 | 目录包（`<name>/SKILL.md`） |
| frontmatter | 完整 YAML | 单行标量；多行/序列值会告警而非静默取空 |
| 目录监听 | 有 | 无（技能树只在换包时变化） |
| rank | 600 | 600（同名时用户技能仍优先） |

失败不会被记住：下一次技能目录刷新会重试官方 provider，解析恢复后自动升回去。

```bash
# 从 npm 安装（推荐）
dsh plugin --profile web add dsh-skill-superpowers

# 或从 git URL / 本地 checkout 安装
dsh plugin --profile web add github:minglo/dsh-skill-superpowers
dsh plugin --profile web add link:/path/to/dsh-skill-superpowers
```

也可以作为普通依赖装进 profile：

```bash
npm install dsh-skill-superpowers        # pnpm add / yarn add 同理
```

`dsh plugin` 会在 `$DSH_HOME/profiles/<name>/` 内运行 pnpm。由于本包的
`package.json` 声明了 `dsh.bundle`，它会被追加到 `dsh.profile.bundles`，其
`cordis.patch.yml` 会在启动时叠加进合成配置。

**装完后要重启 harness** —— bundle patch 只在启动时读取。

验证：

```bash
dsh --profile web --dump-config | grep -A10 'id: superpowers'
dsh --profile web headless "用一句话回答：你有 superpowers 吗？并说出两个技能名。"
```

然后在会话里试：

```bash
dsh --profile web headless "我们做一个 react todo list"
```

最先发生的应当是 `brainstorming` 技能被加载 —— 早于任何代码。

## 装了什么

<!-- artifacts:skill-table:begin -->
| 组成 | 在 dsh 上的落点 |
|---|---|
| 15 个上游技能 | `ctx.skills.registerProvider(...)` —— 一个指向本包的私有 `dsh-skill-filesystem` 实例，位于 `bundledSkillDir`，rank `600`，每个 `<skills>/<name>/SKILL.md` 一个候选 |
| `using-superpowers` 引导段 | `ctx.systemPrompt.section({ name: 'superpowers:bootstrap', order: 121 })`，从第一轮起就装配进每一次请求 |
| 本包自有的 2 个技能 | `superpower-monitor-upstream`、`superpower-sync-upstream` |
<!-- artifacts:skill-table:end -->

这两个 `superpower-*` 技能是本包自己写的：一个用来查上游有没有动，一个用来采用新版本。

rank `600` 即 `BUNDLED_SKILL_RANK`：项目级（`.agents/skills`，rank 100/200）或用户级
（`~/.agents/skills`，rank 400/500）的同名技能会胜出 —— 对用户自己写的技能来说，这个
优先级是对的。

### 配置

每个键在代码里都有默认值，所以插件可以零配置挂载。在 profile patch 的对应行下覆盖：

| 字段 | 默认值 | 含义 |
|---|---|---|
| `skills` | `true` | 注册技能目录。`false` = 只保留引导段。 |
| `bootstrap` | `true` | 注入常驻的系统提示词段落。 |
| `toolMapping` | `true` | 把 dsh 工具映射追加到引导段。 |
| `providerName` | `superpowers` | 注册在 `ctx.skills` 上的名字。 |
| `skillsDir` | `''` | 技能根目录。留空则自动解析：配置 → `SUPERPOWERS_SKILLS_DIR` → `<package>/skills` → `<package>/../skills`。 |

只有确实可选的行为才做成配置项。两件事**不需要**旋钮，因此没有暴露：

- **目录监听** —— 由 dsh 官方 provider 自己的默认值决定（默认开启）。不覆盖它，
  意味着本包的技能根与 harness 其它技能根的监听行为完全一致，也会随 dsh 升级一起改进。
- **提示词段落顺序** —— 固定为 `121`。dsh 自己的段落落在 `-1000`（harness 身份）、
  `0`（persona）、`500`/`600`（plan/team 策略）和 `1000+`（各工具），`121` 正好在
  persona 之后、所有策略与工具段落之前。

## 目录结构

```
index.js                  适配器 —— 惰性导入官方 provider
cordis.patch.yml          dsh bundle 行（由 artifacts.json 生成）
artifacts.json            所有派生产物的唯一来源
skills/                   上游技能树 + 适配改动 + 本包自有技能
references/dsh-tools.md   dsh 工具映射 —— 母本，会被安装进技能树
scripts/                  同步 / 监控 / 产物生成脚本
  upstream-baseline.json  上游在记录版本上交付了什么（监控脚本的数据）
tests/test-plugin.mjs     测试套件
```

`skills/` 是可抛弃的，**绝不要手改** —— 同步脚本会删掉并重建它。所有本地差异都放在
`scripts/sync-skills.mjs` 和 `references/dsh-tools.md` 里。

## 维护

四个脚本，各司其职。`npm run verify` 会跑其中两个检查器。

```bash
node scripts/check-upstream.mjs            # 上游动了吗？动了则退出码 1
node scripts/sync-skills.mjs <checkout> --tag v6.5.0   # vendor 一个版本
node scripts/generate-artifacts.mjs        # 重新生成派生产物
node tests/test-plugin.mjs                 # 跑测试套件
```

### 没有任何东西需要手维护两遍

凡是能派生的一律从 [`artifacts.json`](artifacts.json) 派生，因此改名或上游新增技能
都不会让 README、配置和测试互相矛盾：

| 产物 | 派生自 |
|---|---|
| [`cordis.patch.yml`](cordis.patch.yml) | 包名 + `artifacts.json` 里的配置表 |
| README 技能表 | `skills/` 的目录列表 |
| 测试中的 `EXPECTED_SKILLS` | `skills/` 的目录列表 |
| 树内拷贝（`dsh-tools.md`） | `artifacts.json#copies` |

`scripts/lib/own-content.mjs` 是那份拷贝映射的唯一读取者，因此 `generate-artifacts`
和 `sync-skills --check` 不可能对「哪些文件属于 `skills/`」产生分歧。两个脚本的
`--check` 在漂移时都会以非零码退出，CI 跑的就是这个。

一次同步只重建 `skills/` 下**归上游所有**的目录。本包自有技能
（`skills/superpower-*`，在 `artifacts.json#skillTree.own` 中声明）原生就住在那里，
不会被动。工具映射是唯一需要重新落盘的文件，因为它位于一个归上游所有的目录**内部** ——
`references/dsh-tools.md` 是它的母本，`sync-skills.mjs` 会重跑
`generate-artifacts.mjs` 把它放回去。

### 对全新上游技能树施加的适配

1. **剥离 `superpowers:` 命名空间**（跨技能引用中的）。dsh 的技能名文法是
   `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`，不接受 `:`，所以
   `skill("superpowers:brainstorming")` 是硬错误。上游的**技能名本身**已经合法 ——
   只有引用会被改写，绝不改 `name:` 字段或目录名。
2. 把 `references/dsh-tools.md` 安装进技能树。
3. 改写 Platform Adaptation 一节，只提 dsh。
4. **剪掉其它 harness 的参考文档**（`claude-code-tools.md`、`codex-tools.md` 等）。
   本包只支持 dsh；附上另外六种 harness 的映射等于宣传一个我们提供不了的支持，
   而且当 dsh 成为唯一在场的 harness 后，它们的交叉引用会悬空。
5. 恢复 shebang 脚本的可执行位（见下）。

`skills/` 里有些脚本带 shebang（`#!/usr/bin/env bash`），而技能文档会**直接执行**它们
（写 `scripts/task-start PLAN N`，不是 `bash scripts/task-start`）。直接执行要求文件带
可执行位，但 git 在 Windows 上、以及某些打包工具会丢掉它，所以每个同步周期都重新置位。

`npm pack` / `npm publish` 保留这个位，**`pnpm pack` 会丢** —— 打包时请用 npm。

### 监控新版本

`scripts/check-upstream.mjs` 拿 `package.json#upstream` 里的记录版本与上游 tag 比对，
不一致时再对着记录下来的 baseline 对差异分类：

- **新增技能** —— 目录变大；先逐个确认它能否在 dsh 上跑
- **重建的技能** —— 用 `SKILL.md` 的体积变化衡量，因为这类是行为变化而非文字编辑
  （`executing-plans` 在 v6.4.1 里从 64 行涨到 373 行）
- **新增 harness 支持** —— 价值最高的信号：出现新的 `.<name>-plugin/` 目录意味着上游
  加了新的适配模式，而新的 `references/<name>-tools.md` 需要加进
  `PRUNED_HARNESS_REFERENCES`

baseline 是机械记录的，不靠手写：

```bash
node scripts/check-upstream.mjs --record-baseline --offline <checkout>
```

如何读报告、如何采用一个版本（包括遇到无法在 dsh 上跑的技能该怎么办），见
`superpower-monitor-upstream` 和 `superpower-sync-upstream` 两个技能。

## 致谢与许可

感谢 [icanfinish11/dsh_superpowers](https://github.com/icanfinish11/dsh_superpowers)（[icanfinish11](https://github.com/icanfinish11)）—— 本包 `index.js` 所派生的 dsh 适配器。

感谢 [obra/superpowers](https://github.com/obra/superpowers)（[Jesse Vincent](https://github.com/obra)）—— `skills/` 下的技能内容。

两者均为 MIT 许可，版权声明随代码一并保存在 [`LICENSE`](LICENSE) 中。
