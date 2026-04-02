# CI 质量门禁设计规格

> ArcFlow 平台仓库的 GitHub Actions CI/CD 质量门禁体系，确保所有合并代码经过自动化检查和人工审批。

## 1. 概述

### 1.1 目标

在 arcflow Monorepo 中建立完整的代码质量门禁，覆盖四个维度：

1. **代码规范** — lint + 格式化，零容忍 warning
2. **自动化测试** — 单元测试 + 覆盖率 ≥ 80%
3. **AI Code Review** — Claude 自动 Review，严重问题阻塞合并
4. **安全扫描** — 依赖漏洞、敏感信息泄露、License 合规

### 1.2 适用范围

arcflow 仓库（GitHub），采用 Monorepo 结构：

```
arcflow/
├── packages/
│   ├── gateway/          # Bun + Hono 胶水服务 (TypeScript)
│   └── web/              # Vue3 管理前端 (TypeScript + Vue)
├── docs/                 # 设计文档 (Markdown)
```

### 1.3 分支模型

沿用已有的三分支模型：`develop → test → main`。

所有 CI 检查在 PR 阶段触发，目标分支为 `develop`、`test` 或 `main` 时执行完整检查。

## 2. 仓库结构

### 2.1 Monorepo Workspace

根 `package.json` 使用 workspace 管理子包：

```json
{
  "name": "arcflow",
  "private": true,
  "workspaces": ["packages/*"]
}
```

### 2.2 CI 相关文件

```
arcflow/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml            # 主 CI：lint + test + coverage
│   │   ├── ai-review.yml     # Claude AI Code Review
│   │   └── security.yml      # 安全扫描
│   └── dependabot.yml        # 依赖自动更新配置
├── .husky/
│   └── pre-commit            # pre-commit hook
├── .prettierrc               # Prettier 格式化配置
├── .prettierignore
├── eslint.config.js          # 根 ESLint flat config
├── .markdownlint.json        # markdownlint 配置
├── .gitleaksignore           # gitleaks 白名单
└── package.json              # workspace 根配置
```

## 3. 代码规范（Lint + 格式化）

### 3.1 工具矩阵

| 子包 | 语言 | Lint 工具 | 格式化 |
|------|------|----------|--------|
| gateway | TypeScript (Bun) | ESLint + typescript-eslint | Prettier |
| web | Vue3 + TypeScript | ESLint + eslint-plugin-vue + typescript-eslint | Prettier |
| 通用 | Markdown | markdownlint-cli2 | Prettier |
| 通用 | YAML | yamllint (via Action) | Prettier |

### 3.2 ESLint 配置策略

采用 ESLint flat config（`eslint.config.js`），根目录定义通用规则，各子包可扩展：

- **根配置**：typescript-eslint recommended + Prettier 兼容
- **gateway 扩展**：Node/Bun 环境规则
- **web 扩展**：eslint-plugin-vue recommended + Vue3 特定规则

### 3.3 严格程度

- 所有 warning 视为 error（`--max-warnings 0`）
- Prettier 检查模式（`--check`），不自动修复，CI 中只报错
- markdownlint 应用于 `docs/` 和 `*.md` 文件

### 3.4 本地 Git Hooks

使用 `husky` + `lint-staged`：

```json
// package.json
{
  "lint-staged": {
    "packages/gateway/**/*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "packages/web/**/*.{ts,tsx,vue}": ["eslint --fix", "prettier --write"],
    "**/*.md": ["markdownlint-cli2 --fix", "prettier --write"],
    "**/*.{json,yml,yaml}": ["prettier --write"]
  }
}
```

pre-commit hook 通过 `husky` 自动调用 `lint-staged`，提交前拦截不规范代码。

## 4. 自动化测试

### 4.1 测试框架

| 子包 | 测试框架 | Runner |
|------|---------|--------|
| gateway | Bun 内置 test runner | `bun test` |
| web | Vitest + Vue Test Utils | `vitest run` |

### 4.2 覆盖率要求

- **全局覆盖率**：≥ 80%（行覆盖率）
- **新增代码覆盖率**：≥ 80%
- 覆盖率报告格式：lcov（用于 CI 解析）+ text（用于终端输出）
- web 子包需在 devDependencies 中声明 `@vitest/coverage-v8` 以支持覆盖率报告生成

### 4.3 覆盖率检查

在 CI 中直接解析覆盖率报告，低于阈值则 Action 失败：

- gateway：`bun test --coverage --coverage-reporter lcov`
- web：`vitest run --coverage --coverage.reporter=lcov`

覆盖率结果以 PR Comment 形式展示变化趋势。

### 4.4 测试规范

- PR 新增功能代码必须附带对应单元测试
- 测试文件与源码同目录，命名 `*.test.ts` / `*.spec.ts`
- 集成测试后续按需添加，当前阶段以单元测试为主

## 5. AI Code Review

### 5.1 工具

使用 Claude Code CLI headless 模式，在 GitHub Action 中运行。

### 5.2 触发条件

- PR 创建（opened）
- PR 更新（synchronize）
- 目标分支为 `develop`、`test` 或 `main`

### 5.3 Review 流程

1. Action 获取 PR diff
2. 调用 Claude Code，传入 diff + 仓库 CLAUDE.md 上下文
3. Claude 进行 Review，检查维度：
   - 逻辑错误和 Bug
   - 安全漏洞（OWASP Top 10）
   - 代码质量和可维护性
   - 是否符合项目架构规范（CLAUDE.md）
   - 性能问题
4. 输出 Review 结果

### 5.4 结果处理

- **无严重问题**：以 PR Comment 发布 Review 摘要，标记 `approved`
- **发现严重问题**：以 PR Review 形式发布，标记 `changes_requested`，阻塞合并
- 严重问题的定义：安全漏洞、明确的逻辑错误、数据丢失风险

### 5.5 Prompt 设计要点

- 上下文包含：CLAUDE.md、PR description、完整 diff
- 指示 Claude 区分严重程度：critical（阻塞）/ warning（建议）/ info（参考）
- 避免对风格问题标记 critical（风格问题由 lint 负责）

## 6. 安全扫描

### 6.1 依赖漏洞检测

**Dependabot 配置**（`.github/dependabot.yml`）：

```yaml
version: 2
updates:
  # gateway 使用 Bun，但 Dependabot 尚不支持 bun.lockb，
  # 此处使用 npm ecosystem 作为近似方案，仅监控 package.json 声明的依赖版本
  - package-ecosystem: "npm"
    directory: "/packages/gateway"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
  - package-ecosystem: "npm"
    directory: "/packages/web"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 5
  - package-ecosystem: "github-actions"
    directory: "/"
    schedule:
      interval: "weekly"
```

**CI 中额外运行 `npm audit`**：

- `npm audit --audit-level=high`，high/critical 级别漏洞阻塞合并
- moderate 及以下仅作为 warning 输出

### 6.2 敏感信息检测

- **GitHub Secret Scanning**：仓库级别开启（GitHub 原生功能）
- **gitleaks**：在 CI 中运行，扫描 PR 变更的 commit

```yaml
# security.yml 中的 gitleaks 步骤
- uses: gitleaks/gitleaks-action@v2
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

检测到任何敏感信息 → 阻塞合并。

### 6.3 License 合规

使用 `license-checker` 检查依赖的 License：

- 白名单：MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD
- 不在白名单中的 License → 阻塞合并并报告
- 每个子包独立检查

## 7. GitHub Actions Workflow 设计

### 7.1 ci.yml — 主 CI

```yaml
name: CI

on:
  pull_request:
    branches: [main, develop, test]

permissions:
  contents: read
  pull-requests: read

jobs:
  changes:
    # 检测变更目录，决定运行哪些子包的检查
    runs-on: ubuntu-latest
    outputs:
      gateway: ${{ steps.filter.outputs.gateway }}
      web: ${{ steps.filter.outputs.web }}
      docs: ${{ steps.filter.outputs.docs }}
    steps:
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            gateway:
              - 'packages/gateway/**'
            web:
              - 'packages/web/**'
            docs:
              - 'docs/**'
              - '**/*.md'

  lint-gateway:
    needs: changes
    if: needs.changes.outputs.gateway == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run lint --max-warnings 0
        working-directory: packages/gateway
      - run: bunx prettier --check packages/gateway/

  lint-web:
    needs: changes
    if: needs.changes.outputs.web == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run lint
        working-directory: packages/web
      - run: bunx prettier --check packages/web/

  lint-docs:
    needs: changes
    if: needs.changes.outputs.docs == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bunx markdownlint-cli2 "docs/**/*.md"

  test-gateway:
    needs: changes
    if: needs.changes.outputs.gateway == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun test --coverage --coverage-reporter lcov
        working-directory: packages/gateway
      # 覆盖率检查（阈值 80%）
      - name: Install lcov
        run: sudo apt-get install -y lcov
      - name: Check coverage
        run: |
          COVERAGE=$(lcov --summary packages/gateway/coverage/lcov.info 2>&1 | grep 'lines' | grep -o '[0-9.]*%' | head -1 | tr -d '%')
          echo "Coverage: ${COVERAGE}%"
          if (( $(echo "$COVERAGE < 80" | bc -l) )); then
            echo "::error::Coverage ${COVERAGE}% is below threshold 80%"
            exit 1
          fi

  test-web:
    needs: changes
    if: needs.changes.outputs.web == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bunx vitest run --coverage --coverage.reporter=lcov
        working-directory: packages/web
      - name: Install lcov
        run: sudo apt-get install -y lcov
      - name: Check coverage
        run: |
          COVERAGE=$(lcov --summary packages/web/coverage/lcov.info 2>&1 | grep 'lines' | grep -o '[0-9.]*%' | head -1 | tr -d '%')
          echo "Coverage: ${COVERAGE}%"
          if (( $(echo "$COVERAGE < 80" | bc -l) )); then
            echo "::error::Coverage ${COVERAGE}% is below threshold 80%"
            exit 1
          fi
```

### 7.2 ai-review.yml — AI Review

使用 Anthropic 官方的 `anthropics/claude-code-action@beta` GitHub Action：

```yaml
name: AI Code Review

on:
  pull_request:
    branches: [main, develop, test]
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  ai-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: anthropics/claude-code-action@beta
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          model: claude-sonnet-4-6-20250514
          direct_prompt: |
            Review this PR for:
            1. Logic errors and bugs (critical)
            2. Security vulnerabilities - OWASP Top 10 (critical)
            3. Data loss risks (critical)
            4. Code quality and maintainability (warning)
            5. Performance issues (warning)
            6. Adherence to project conventions in CLAUDE.md (info)

            Classify each issue as: critical / warning / info.
            Style issues are handled by lint — do not flag them.
            If any critical issues are found, request changes.
            Otherwise, approve the PR.
```

> **注意**：`anthropics/claude-code-action@beta` 是 Anthropic 官方 Action，会自动读取仓库的 CLAUDE.md 作为上下文，并以 PR Review 形式发布结果（支持 `approved` 和 `changes_requested`）。如该 Action 接口发生变更，需参照其官方文档调整配置。

### 7.3 security.yml — 安全扫描

```yaml
name: Security

on:
  pull_request:
    branches: [main, develop, test]

permissions:
  contents: read
  security-events: write

jobs:
  gitleaks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

  audit-gateway:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
        working-directory: packages/gateway
      - run: bun pm audit --level=high
        working-directory: packages/gateway

  audit-web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
        working-directory: packages/web
      - run: bun pm audit --level=high
        working-directory: packages/web

  license-check-gateway:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: bun install
        working-directory: packages/gateway
      - run: |
          npx license-checker --production --onlyAllow \
            "MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD"
        working-directory: packages/gateway

  license-check-web:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: bun install
        working-directory: packages/web
      - run: |
          npx license-checker --production --onlyAllow \
            "MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD"
        working-directory: packages/web
```

## 8. 分支保护规则

### 8.1 main 分支

| 规则 | 值 |
|------|---|
| Require pull request | ✅ |
| Required approvals | ≥ 1 |
| Required status checks | CI (lint + test), Security, AI Review |
| Require branches up to date | ✅ |
| Block force pushes | ✅ |
| Block deletions | ✅ |

### 8.2 develop 分支

与 main 相同的规则。

### 8.3 test 分支

| 规则 | 值 |
|------|---|
| Require pull request | ✅ |
| Required approvals | ≥ 1 |
| Required status checks | CI (lint + test), Security |
| Block force pushes | ✅ |

## 9. 开发者体验

### 9.1 本地开发命令

```bash
# 安装依赖（含 husky 自动初始化）
bun install

# 全局 lint
bun run lint

# 全局格式化
bun run format

# 单包测试
cd packages/gateway && bun test
cd packages/web && bun run test

# 全局测试
bun run test
```

### 9.2 根 package.json scripts

```json
{
  "scripts": {
    "lint": "eslint . && markdownlint-cli2 'docs/**/*.md'",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "bun run --cwd packages/gateway test && bun run --cwd packages/web test",
    "prepare": "husky"
  }
}
```

### 9.3 CI 反馈

- 每个 check 独立显示在 PR 页面，失败时可快速定位
- 覆盖率变化以 PR Comment 展示
- AI Review 结果以 inline comment 形式标注在具体代码行

## 10. 后续扩展

当前设计覆盖 gateway 和 web 两个子包。后续新增子包时：

1. 在 `ci.yml` 的 `paths-filter` 中添加新路径
2. 添加对应的 lint / test job
3. 在 `dependabot.yml` 中添加新目录
4. License check 添加新目录

如涉及新语言（如后续加入 Java 后端），需在 CI 中添加对应工具链（Checkstyle、JUnit 等）。
