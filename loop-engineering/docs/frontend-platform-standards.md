# 前端平台工程规范 / Frontend Platform Engineering Standards

## 中文

## 目标

本规范把通用前端开发技能沉淀为 Loop Engineering 工程仓的平台级规则，用于约束平台内前端项目、前端类 Skill、agent 交付结果和评审口径。

它不是单个业务项目的风格偏好，也不是一次性提示词。平台规则必须可维护、可审计、可验证，并能被项目级 `SKILL.md`、loop 配置、评审 agent 和测试命令共同引用。

## 适用范围

本规范适用于仓库内新增或维护的前端 Web 应用、管理台、移动端 H5、组件库、前端脚本和前端相关文档。

项目级规则可以在 `workspace/projects/<project>/SKILL.md` 中收窄本规范，但不能降低安全、可验证性、提交边界和可维护性要求。确需例外时，必须在项目 Skill 或变更说明中记录原因、影响范围和验证方式。

## 平台原则

1. 目录、命名、类型、样式和提交格式必须稳定，避免让 agent 在不同项目中反复重新推断约定。
2. 配置优先落到结构化文件，例如 TypeScript、ESLint、Prettier、构建工具、JSON Schema 或 YAML 配置，不用口头约定替代机器可校验规则。
3. 共享规则放在平台文档或模板里，项目差异放在项目 Skill 里，本机路径和外部仓内容不得进入平台规范。
4. 评审不能只看“能运行”，还要检查目录边界、类型安全、可访问性、性能风险、安全边界和测试证据。
5. generator 产出的前端修改需要由独立 evaluator 或等价评审流程复核，不能用自评作为完成条件。

## 目录结构

前端项目应保持职责分层清楚。常见 `src/` 结构如下，项目可按框架调整，但语义必须明确。

```text
src/
├── api/          # 接口请求与 API 客户端
├── assets/       # 静态资源
├── components/   # 可复用展示与交互组件
├── constants/    # 常量、枚举和稳定配置
├── hooks/        # React hooks 或业务 hooks
├── composables/  # Vue composables
├── layouts/      # 布局组件
├── pages/        # 页面或路由入口
├── router/       # 路由配置
├── store/        # 状态管理
├── styles/       # 全局样式、变量和 mixins
└── utils/        # 纯工具函数
```

目录规则：

- 不把业务页面代码放进通用组件目录。
- 不把 API 请求、状态管理、副作用和展示组件混在同一个无边界目录里。
- 公共组件必须有清晰输入输出，避免直接依赖页面级状态。
- 跨项目复用代码进入平台模板或共享包前，必须先有真实重复使用场景。

## 命名规范

文件命名：

- 组件文件使用大驼峰，例如 `UserList.tsx`、`UserList.vue`。
- 页面、工具、样式和非组件模块使用短横线，例如 `user-info.ts`、`date-format.ts`、`button.module.scss`。
- 测试文件与被测文件同名并加测试后缀，例如 `user-info.test.ts`。

代码命名：

- 变量和普通函数使用小驼峰，例如 `userList`、`getUserInfo`。
- 常量使用全大写下划线，例如 `MAX_RETRY_COUNT`。
- 布尔值使用 `is`、`has`、`can`、`should` 等前缀，例如 `isVisible`。
- 事件处理函数使用动词开头；React 事件处理推荐 `handle` 前缀。
- 命名必须表达领域含义，避免 `data`、`list`、`temp` 这类脱离上下文的泛名。

## HTML 与可访问性

- 优先使用语义化标签，例如 `header`、`main`、`section`、`nav`、`aside`、`footer`。
- 图片必须提供有意义的 `alt`；纯装饰图应显式标记为空替代文本。
- 交互元素必须可键盘访问，禁止只依赖鼠标 hover 或裸 `div` 点击。
- 表单控件必须有 label、错误状态和可理解的辅助信息。
- class 命名使用短横线或项目既有约定，禁止行内样式承载长期样式规则。

## CSS 与样式

- 样式组织应使用项目既有方案，例如 CSS Modules、SCSS、Tailwind、styled-components 或组件库主题，不在同一模块混用多套风格。
- SCSS 嵌套不超过 3 层，超过时应拆分结构或引入更清晰的类名。
- 颜色、间距、字体、阴影、层级和断点优先使用设计变量或主题 token。
- `z-index` 必须按项目层级体系管理，不能随意写极大值。
- 响应式布局优先使用稳定约束，例如 grid、flex、`minmax()`、`clamp()`、固定比例和容器宽度。
- 禁止让动态文本、按钮、卡片、表格列在常见桌面和移动视口下互相遮挡。

## JavaScript 规范

- 使用 `const` 和 `let`，禁止新增 `var`。
- 异步代码优先使用 `async` / `await`，并显式处理失败路径。
- 控制流避免超过 3 层嵌套；复杂逻辑应拆成有领域含义的小函数。
- 魔法数字、状态码和重复字符串必须抽成常量或枚举。
- 数组转换优先使用 `map`、`filter`、`reduce` 等表达式；存在副作用时使用清晰循环。
- 不在生产路径保留调试 `console`，除非项目有受控日志封装。

## TypeScript 规范

- 公共函数、组件 props、接口返回值和跨模块数据结构必须有类型定义。
- 禁止新增无约束的 `any`；确需接收未知输入时优先使用 `unknown` 并做类型收窄。
- 类型命名保持项目一致，不强制全仓统一 `I` 前缀或 `Type` 后缀；新增项目应优先使用不带匈牙利前缀的领域名。
- 能由 TypeScript 推断的局部变量不需要重复标注，跨边界 API 必须标注。
- 联合类型、枚举或常量对象应覆盖真实业务状态，避免用裸字符串在多处传播。
- 解析外部输入时要在边界处校验，不把未验证数据直接当作可信类型。

## Vue 规范

- 组件名使用多单词命名，避免与 HTML 原生标签冲突。
- props 必须声明类型、必填性和默认值；复杂对象默认值必须使用工厂函数。
- `computed` 应保持无副作用；`watch` 只用于明确的副作用、同步或外部交互。
- 模板逻辑保持轻量，复杂判断提取到 `computed` 或函数。
- 事件和方法命名使用动词短语，并表达业务动作。

## React 规范

- 新增 React 组件默认使用函数组件和 Hooks。
- 严格遵守 Hooks 规则，禁止在循环、条件或嵌套函数中调用 Hooks。
- 状态应尽量扁平，避免深层对象频繁局部更新导致不可控渲染。
- 组件 props 要表达组件职责，避免把页面级大对象整包透传给通用组件。
- 副作用放在 `useEffect` 或框架数据层中，并明确依赖项、清理逻辑和失败状态。
- 大列表、复杂图表和高频交互需要评估 memo、虚拟滚动、分页或懒加载。

## Git 与变更说明

提交信息推荐使用 Conventional Commits：

```text
type(scope): summary
```

常用类型：

- `feat`: 新功能
- `fix`: 修复
- `docs`: 文档
- `style`: 纯格式或样式调整
- `refactor`: 重构
- `perf`: 性能优化
- `test`: 测试
- `chore`: 构建、工具或维护任务

前端变更说明应包含用户可见影响、测试证据和风险点。涉及认证、支付、权限、数据删除、依赖升级或构建链路的变更，必须进入人工复核或更高强度评审。

## 格式化与静态检查

- 新项目必须配置 ESLint 和 Prettier，或使用等价的项目既有工具链。
- 缩进、引号、分号、换行和 import 顺序以项目配置为准，不在评审中制造风格争议。
- 禁止未使用变量、不可达代码、重复依赖、循环依赖和明显失效的类型断言。
- 配置变更必须同步验证命令和文档，不能只修改编辑器本地设置。

## 构建与性能

- 图片应压缩并优先使用合适的现代格式；大图、长列表、路由和重组件应按需加载。
- 高频事件必须评估防抖、节流、取消请求或后台调度。
- 首屏关键路径避免引入不必要的大依赖；新增大型依赖要说明必要性。
- 表格、树、图表和日志流等大数据视图应考虑虚拟滚动、分页或增量渲染。
- 性能优化必须有可复查证据，例如构建体积、加载时间、交互延迟或浏览器 QA 记录。

## 安全规范

- 不把密钥、长期 token、生产凭证或敏感配置写入前端代码、localStorage 或仓库文档。
- 渲染用户输入、富文本、Markdown、URL 和 HTML 片段时必须考虑 XSS。
- 鉴权、权限和数据过滤必须以后端为准，前端只做体验层防护。
- 跨站请求、下载、上传、跳转和第三方脚本接入必须明确安全边界。
- 敏感操作需要显式确认、失败反馈和可追踪日志，不能只依赖隐藏按钮或前端状态。

## Agent 交付要求

agent 处理前端任务时，应按以下顺序收敛：

1. 读取项目级 `SKILL.md`、现有目录结构、包管理配置、测试命令和相关组件。
2. 使用项目既有框架和样式体系，不新增无必要的架构或 UI 库。
3. 修改范围限定在任务需要的模块，避免顺手重命名、迁移目录或格式化无关文件。
4. 对用户可见页面进行真实浏览器或等价截图验证；复杂交互需要覆盖主要状态。
5. 交付时说明修改内容、验证命令、未覆盖风险和需要人工确认的点。

## 验收清单

前端变更合入前至少确认：

- 目录边界符合项目结构，没有把平台、本机或外部仓状态混入业务代码。
- 命名、类型、样式和状态管理与项目既有约定一致。
- 关键用户路径可运行，错误、加载、空态和权限态不破坏布局。
- 静态检查、构建或相关测试已运行；无法运行时说明原因。
- 安全、性能、可访问性和响应式风险已被检查或明确记录。

## English

## Goal

This standard distills a general frontend development skill into platform-level rules for the Loop Engineering repository. It governs frontend projects, frontend-oriented skills, agent deliverables, and review criteria.

It is not a single project's style preference or a disposable prompt. Platform rules must be maintainable, auditable, and verifiable, and they should be referenceable from project-level `SKILL.md` files, loop specs, evaluator agents, and test commands.

## Scope

This standard applies to frontend Web apps, admin consoles, mobile H5 apps, component libraries, frontend scripts, and frontend-related documentation added to or maintained inside this repository.

Project-level rules may narrow this standard in `workspace/projects/<project>/SKILL.md`, but they must not weaken security, verifiability, commit boundaries, or maintainability. Any required exception must record the reason, impact, and verification method in the project Skill or change notes.

## Platform Principles

1. Directory layout, naming, typing, styling, and commit format must stay stable so agents do not have to rediscover conventions across projects.
2. Put enforceable rules in structured configuration, such as TypeScript, ESLint, Prettier, build tools, JSON Schema, or YAML, instead of relying on verbal conventions.
3. Shared rules belong in platform docs or templates; project differences belong in project Skills. Machine-specific paths and external repository contents must not enter platform standards.
4. Review must check more than whether the app runs. It must cover boundaries, type safety, accessibility, performance risk, security boundaries, and test evidence.
5. Frontend changes produced by a generator need independent evaluator review or an equivalent review flow. Generator self-review is not a completion gate.

## Directory Layout

Frontend projects should keep responsibilities clearly separated. A common `src/` layout is shown below. Projects may adapt it to their framework, but the meaning must remain explicit.

```text
src/
├── api/          # API requests and clients
├── assets/       # Static assets
├── components/   # Reusable presentation and interaction components
├── constants/    # Constants, enums, and stable configuration
├── hooks/        # React hooks or business hooks
├── composables/  # Vue composables
├── layouts/      # Layout components
├── pages/        # Pages or route entries
├── router/       # Routing configuration
├── store/        # State management
├── styles/       # Global styles, variables, and mixins
└── utils/        # Pure utility functions
```

Directory rules:

- Do not put business page code into generic component directories.
- Do not mix API calls, state management, side effects, and presentation components in an unbounded directory.
- Shared components must have clear inputs and outputs and should avoid direct dependency on page-level state.
- Code should move into platform templates or shared packages only after there is real repeated use across projects.

## Naming

File naming:

- Component files use PascalCase, such as `UserList.tsx` or `UserList.vue`.
- Pages, utilities, styles, and non-component modules use kebab-case, such as `user-info.ts`, `date-format.ts`, or `button.module.scss`.
- Test files match the tested file and add a test suffix, such as `user-info.test.ts`.

Code naming:

- Variables and regular functions use camelCase, such as `userList` and `getUserInfo`.
- Constants use upper snake case, such as `MAX_RETRY_COUNT`.
- Booleans use prefixes such as `is`, `has`, `can`, or `should`, for example `isVisible`.
- Event handlers start with verbs; React event handlers should generally use a `handle` prefix.
- Names must express domain meaning. Avoid context-free generic names such as `data`, `list`, or `temp`.

## HTML And Accessibility

- Prefer semantic tags such as `header`, `main`, `section`, `nav`, `aside`, and `footer`.
- Images must provide meaningful `alt` text; purely decorative images should explicitly use empty alternative text.
- Interactive elements must be keyboard-accessible. Do not rely only on hover or clickable bare `div` elements.
- Form controls must have labels, error states, and understandable helper information.
- Class names should use kebab-case or the existing project convention. Do not use inline styles for long-lived styling rules.

## CSS And Styling

- Organize styling with the project's existing approach, such as CSS Modules, SCSS, Tailwind, styled-components, or component-library theming. Do not mix multiple styling systems in one module without a reason.
- SCSS nesting should not exceed three levels. Split structure or introduce clearer class names when it does.
- Colors, spacing, typography, shadows, layers, and breakpoints should use design variables or theme tokens.
- `z-index` must follow the project layering system; do not use arbitrary very large values.
- Responsive layouts should prefer stable constraints such as grid, flex, `minmax()`, `clamp()`, fixed aspect ratios, and container widths.
- Dynamic text, buttons, cards, and table columns must not overlap on common desktop and mobile viewports.

## JavaScript

- Use `const` and `let`; do not add new `var` declarations.
- Prefer `async` / `await` for asynchronous code and handle failure paths explicitly.
- Avoid control flow deeper than three nesting levels; split complex logic into small domain-named functions.
- Magic numbers, status codes, and repeated strings must become constants or enums.
- Prefer array expressions such as `map`, `filter`, and `reduce` for transformations; use clear loops when side effects are involved.
- Do not leave debug `console` calls in production paths unless the project has a controlled logging wrapper.

## TypeScript

- Public functions, component props, API responses, and cross-module data structures must have type definitions.
- Do not add unconstrained `any`. Use `unknown` and narrow it when accepting unknown input.
- Keep type naming consistent with the project. Do not force a repository-wide `I` prefix or `Type` suffix. New projects should prefer domain names without Hungarian-style prefixes.
- Local variables that TypeScript can infer do not need repeated annotations; cross-boundary APIs must be annotated.
- Union types, enums, or constant objects should cover real business states instead of spreading raw strings across modules.
- Validate external input at the boundary instead of treating unverified data as trusted typed data.

## Vue

- Component names use multiple words to avoid conflicts with native HTML elements.
- Props must declare type, requiredness, and defaults; complex object defaults must use factory functions.
- `computed` values should remain side-effect free. Use `watch` only for explicit side effects, synchronization, or external interaction.
- Keep template logic light. Extract complex conditions into `computed` values or functions.
- Events and methods use verb phrases and express business actions.

## React

- New React components use function components and Hooks by default.
- Strictly follow the Rules of Hooks. Do not call Hooks inside loops, conditions, or nested functions.
- Keep state as flat as practical to avoid uncontrolled rendering from deep object updates.
- Component props should express component responsibility. Avoid passing entire page-level objects into generic components.
- Put side effects in `useEffect` or the framework data layer, with explicit dependencies, cleanup, and failure states.
- Large lists, complex charts, and high-frequency interactions require evaluation of memoization, virtual scrolling, pagination, or lazy loading.

## Git And Change Notes

Commit messages should use Conventional Commits:

```text
type(scope): summary
```

Common types:

- `feat`: Feature
- `fix`: Bug fix
- `docs`: Documentation
- `style`: Formatting or styling only
- `refactor`: Refactor
- `perf`: Performance improvement
- `test`: Tests
- `chore`: Build, tooling, or maintenance

Frontend change notes should include user-visible impact, test evidence, and risks. Changes involving authentication, payment, permissions, data deletion, dependency upgrades, or build pipelines must go through human review or a stronger review path.

## Formatting And Static Checks

- New projects must configure ESLint and Prettier, or use an equivalent existing project toolchain.
- Indentation, quotes, semicolons, line wrapping, and import order follow project configuration. Reviews should not create style debates outside that configuration.
- Unused variables, unreachable code, duplicated dependencies, circular dependencies, and clearly invalid type assertions are not allowed.
- Configuration changes must update verification commands and documentation. Do not rely only on local editor settings.

## Build And Performance

- Images should be compressed and use suitable modern formats. Large images, long lists, routes, and heavy components should load on demand.
- High-frequency events require consideration of debounce, throttle, request cancellation, or background scheduling.
- Avoid unnecessary large dependencies on the first-render critical path. New large dependencies need justification.
- Large data views such as tables, trees, charts, and log streams should consider virtual scrolling, pagination, or incremental rendering.
- Performance work must include reviewable evidence, such as bundle size, load time, interaction latency, or browser QA notes.

## Security

- Do not put secrets, long-lived tokens, production credentials, or sensitive configuration in frontend code, localStorage, or repository documentation.
- Rendering user input, rich text, Markdown, URLs, or HTML fragments must account for XSS.
- Authorization, permissions, and data filtering must be enforced by the backend. Frontend checks are only an experience layer.
- Cross-site requests, downloads, uploads, redirects, and third-party scripts must have explicit security boundaries.
- Sensitive operations need explicit confirmation, failure feedback, and traceable logs. Do not rely only on hidden buttons or frontend state.

## Agent Delivery Requirements

When handling frontend tasks, agents should converge in this order:

1. Read the project-level `SKILL.md`, existing directory layout, package configuration, test commands, and related components.
2. Use the project's existing framework and styling system. Do not add unnecessary architecture or UI libraries.
3. Keep changes scoped to the modules required by the task. Avoid opportunistic renaming, directory migration, or formatting unrelated files.
4. Verify user-visible pages with a real browser or equivalent screenshots. Complex interactions need coverage for major states.
5. In the handoff, state what changed, which verification commands ran, uncovered risks, and points needing human confirmation.

## Acceptance Checklist

Before merging frontend changes, confirm at least:

- Directory boundaries fit the project structure, and platform, local, or external repository state has not leaked into business code.
- Naming, typing, styling, and state management follow existing project conventions.
- Key user paths run, and error, loading, empty, and permission states do not break layout.
- Static checks, build, or relevant tests have run. If they could not run, the reason is stated.
- Security, performance, accessibility, and responsive risks have been checked or explicitly recorded.
