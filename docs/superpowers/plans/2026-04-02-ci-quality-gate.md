# CI 质量门禁实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 arcflow Monorepo 中搭建完整的 GitHub Actions CI 质量门禁，覆盖 lint、测试、AI Review、安全扫描四个维度。

**Architecture:** Monorepo workspace 结构，根 package.json 管理两个子包（gateway/web）。三条独立 workflow（ci.yml / ai-review.yml / security.yml）并行运行，通过 paths-filter 按变更目录智能触发。本地 husky + lint-staged 做 pre-commit 拦截。

**Tech Stack:** Bun, Node.js 20, ESLint (flat config), Prettier, markdownlint-cli2, Vitest, husky, lint-staged, gitleaks, license-checker, anthropics/claude-code-action

**Spec:** `docs/superpowers/specs/2026-04-02-ci-quality-gate-design.md`

---

## File Map

### 创建的文件

| 文件 | 职责 |
|------|------|
| `package.json` | 根 workspace 配置 + scripts + lint-staged |
| `eslint.config.js` | 根 ESLint flat config（TS + Vue 规则） |
| `.prettierrc` | Prettier 格式化规则 |
| `.prettierignore` | Prettier 忽略列表 |
| `.markdownlint.json` | markdownlint 规则 |
| `.husky/pre-commit` | pre-commit hook 脚本 |
| `.github/workflows/ci.yml` | 主 CI：lint + test + 覆盖率 |
| `.github/workflows/ai-review.yml` | Claude AI Code Review |
| `.github/workflows/security.yml` | 安全扫描（gitleaks + audit + license） |
| `.github/dependabot.yml` | Dependabot 自动依赖更新 |
| `.gitleaksignore` | gitleaks 白名单（避免文档示例误报） |
| `packages/gateway/package.json` | gateway 子包配置 |
| `packages/gateway/tsconfig.json` | gateway TypeScript 配置 |
| `packages/gateway/src/index.ts` | gateway 入口（最小可运行） |
| `packages/gateway/src/index.test.ts` | gateway 入口测试 |
| `packages/web/package.json` | web 子包配置 |
| `packages/web/tsconfig.json` | web TypeScript 配置 |
| `packages/web/vitest.config.ts` | Vitest 配置 |
| `packages/web/src/main.ts` | web 入口（最小可运行） |
| `packages/web/src/App.vue` | web 根组件 |
| `packages/web/src/App.test.ts` | web 根组件测试 |

### 修改的文件

| 文件 | 变更 |
|------|------|
| `.gitignore` | 添加 node_modules / dist / coverage 等 |

---

## Task 1: 根 Workspace 初始化

**Files:**
- Create: `package.json`
- Modify: `.gitignore`

- [ ] **Step 1: 创建根 package.json**

```json
{
  "name": "arcflow",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "lint": "eslint . && markdownlint-cli2 'docs/**/*.md'",
    "lint:fix": "eslint . --fix",
    "format": "prettier --write .",
    "format:check": "prettier --check .",
    "test": "bun run --cwd packages/gateway test && bun run --cwd packages/web test",
    "prepare": "husky"
  },
  "devDependencies": {
    "eslint": "^9.0.0",
    "typescript-eslint": "^8.0.0",
    "eslint-plugin-vue": "^9.0.0",
    "eslint-config-prettier": "^10.0.0",
    "prettier": "^3.0.0",
    "markdownlint-cli2": "^0.17.0",
    "husky": "^9.0.0",
    "lint-staged": "^15.0.0"
  },
  "lint-staged": {
    "packages/gateway/**/*.{ts,tsx}": ["eslint --fix", "prettier --write"],
    "packages/web/**/*.{ts,tsx,vue}": ["eslint --fix", "prettier --write"],
    "**/*.md": ["markdownlint-cli2 --fix", "prettier --write"],
    "**/*.{json,yml,yaml}": ["prettier --write"]
  }
}
```

- [ ] **Step 2: 更新 .gitignore**

在现有内容后追加：

```
node_modules/
dist/
coverage/
*.tsbuildinfo
.env
.env.*
!.env.example
```

- [ ] **Step 3: 提交**

```bash
git add package.json .gitignore
git commit -m "chore(#<issue号>): 初始化根 workspace 配置"
```

---

## Task 2: ESLint + Prettier + markdownlint 配置

**Files:**
- Create: `eslint.config.js`, `.prettierrc`, `.prettierignore`, `.markdownlint.json`

- [ ] **Step 1: 创建 eslint.config.js**

```js
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";
import eslintConfigPrettier from "eslint-config-prettier";

export default [
  { ignores: ["**/dist/", "**/node_modules/", "**/coverage/"] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs["flat/recommended"],
  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },
  eslintConfigPrettier,
];
```

- [ ] **Step 2: 创建 .prettierrc**

```json
{
  "semi": true,
  "singleQuote": false,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```

- [ ] **Step 3: 创建 .prettierignore**

```
dist/
coverage/
node_modules/
bun.lockb
package-lock.json
*.md
```

> 注意：`.md` 文件由 markdownlint 管理格式，Prettier 不处理。

- [ ] **Step 4: 创建 .markdownlint.json**

```json
{
  "MD013": false,
  "MD033": false,
  "MD041": false
}
```

> MD013（行长度限制）关闭——表格和代码块经常超长。MD033（行内 HTML）关闭——Mermaid 图表需要。MD041（首行必须是 h1）关闭——有些文件以 frontmatter 开头。

- [ ] **Step 5: 验证 lint 能运行**

```bash
bun install
bun run lint
```

Expected: 可能有若干 markdown warning，但命令本身不报错。

- [ ] **Step 6: 提交**

```bash
git add eslint.config.js .prettierrc .prettierignore .markdownlint.json
git commit -m "chore(#<issue号>): 添加 ESLint + Prettier + markdownlint 配置"
```

---

## Task 3: Husky + lint-staged 配置

**Files:**
- Create: `.husky/pre-commit`

- [ ] **Step 1: 初始化 husky**

```bash
bunx husky init
```

- [ ] **Step 2: 配置 pre-commit hook**

写入 `.husky/pre-commit`：

```sh
bunx lint-staged
```

- [ ] **Step 3: 验证 hook 生效**

修改任意 `.json` 文件（如在 `.prettierrc` 中临时加一行 `"endOfLine": "lf"`），然后：

```bash
git add .prettierrc
git commit -m "test: 验证 husky hook"
```

Expected: lint-staged 自动运行 prettier，commit 成功。验证后撤销此测试提交：

```bash
git reset --soft HEAD~1
git checkout -- .prettierrc
```

- [ ] **Step 4: 提交 husky 配置**

```bash
git add .husky/
git commit -m "chore(#<issue号>): 添加 husky + lint-staged pre-commit hook"
```

---

## Task 4: gateway 子包脚手架

**Files:**
- Create: `packages/gateway/package.json`, `packages/gateway/tsconfig.json`, `packages/gateway/src/index.ts`, `packages/gateway/src/index.test.ts`

- [ ] **Step 1: 创建 gateway package.json**

```json
{
  "name": "@arcflow/gateway",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "bun run --watch src/index.ts",
    "lint": "eslint src/ --max-warnings 0",
    "test": "bun test --coverage --coverage-reporter lcov"
  },
  "dependencies": {
    "hono": "^4.0.0"
  },
  "devDependencies": {
    "bun-types": "latest"
  }
}
```

- [ ] **Step 2: 创建 gateway tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "types": ["bun-types"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 写 gateway 入口测试**

`packages/gateway/src/index.test.ts`：

```ts
import { describe, expect, it } from "bun:test";
import { app } from "./index";

describe("gateway health check", () => {
  it("GET /health returns 200", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok" });
  });
});
```

- [ ] **Step 4: 运行测试确认失败**

```bash
cd packages/gateway && bun test
```

Expected: FAIL — `./index` 没有导出 `app`。

- [ ] **Step 5: 写 gateway 最小入口**

`packages/gateway/src/index.ts`：

```ts
import { Hono } from "hono";

export const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

export default {
  port: 3100,
  fetch: app.fetch,
};
```

- [ ] **Step 6: 运行测试确认通过**

```bash
cd packages/gateway && bun test
```

Expected: PASS

- [ ] **Step 7: 安装依赖并验证 lint**

```bash
cd packages/gateway && bun install
bun run lint
```

Expected: 无 error。

- [ ] **Step 8: 提交**

```bash
git add packages/gateway/
git commit -m "feat(#<issue号>): 初始化 gateway 子包（Bun + Hono）"
```

---

## Task 5: web 子包脚手架

**Files:**
- Create: `packages/web/package.json`, `packages/web/tsconfig.json`, `packages/web/vitest.config.ts`, `packages/web/src/main.ts`, `packages/web/src/App.vue`, `packages/web/src/App.test.ts`

- [ ] **Step 1: 创建 web package.json**

```json
{
  "name": "@arcflow/web",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "lint": "eslint src/ --max-warnings 0",
    "test": "vitest run --coverage --coverage.reporter=lcov"
  },
  "dependencies": {
    "vue": "^3.5.0"
  },
  "devDependencies": {
    "vite": "^6.0.0",
    "@vitejs/plugin-vue": "^5.0.0",
    "typescript": "^5.0.0",
    "vitest": "^3.0.0",
    "@vitest/coverage-v8": "^3.0.0",
    "@vue/test-utils": "^2.4.0",
    "jsdom": "^26.0.0"
  }
}
```

- [ ] **Step 2: 创建 web tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "jsx": "preserve",
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 创建 vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "jsdom",
    coverage: {
      provider: "v8",
      reporter: ["lcov", "text"],
    },
  },
});
```

- [ ] **Step 4: 写 App 组件测试**

`packages/web/src/App.test.ts`：

```ts
import { describe, expect, it } from "vitest";
import { mount } from "@vue/test-utils";
import App from "./App.vue";

describe("App", () => {
  it("renders ArcFlow title", () => {
    const wrapper = mount(App);
    expect(wrapper.text()).toContain("ArcFlow");
  });
});
```

- [ ] **Step 5: 运行测试确认失败**

```bash
cd packages/web && bun install && bun run test
```

Expected: FAIL — App.vue 不存在或没有内容。

- [ ] **Step 6: 写最小 App.vue**

`packages/web/src/App.vue`：

```vue
<template>
  <div id="app">
    <h1>ArcFlow</h1>
  </div>
</template>
```

- [ ] **Step 7: 写 main.ts 入口**

`packages/web/src/main.ts`：

```ts
import { createApp } from "vue";
import App from "./App.vue";

createApp(App).mount("#app");
```

- [ ] **Step 8: 运行测试确认通过**

```bash
cd packages/web && bun run test
```

Expected: PASS

- [ ] **Step 9: 提交**

```bash
git add packages/web/
git commit -m "feat(#<issue号>): 初始化 web 子包（Vue3 + Vite + Vitest）"
```

---

## Task 6: CI Workflow（ci.yml）

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: 创建 ci.yml**

`.github/workflows/ci.yml`：

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
      - run: bun run lint
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

> **设计决策**：CI 中统一使用 `bun install` 安装所有 workspace 依赖（包括 web 子包），避免 `npm ci` 因缺少 `package-lock.json` 而失败。web 子包的 lint/test 命令通过 `bun run` / `bunx` 执行，运行时行为与 npm 一致。

- [ ] **Step 2: 验证 YAML 语法**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"
```

Expected: 无报错。

- [ ] **Step 3: 提交**

```bash
git add .github/workflows/ci.yml
git commit -m "ci(#<issue号>): 添加主 CI workflow（lint + test + 覆盖率）"
```

> 注意：所有 commit message 中的 `#<issue号>` 需替换为实际的 GitHub Issue 编号。

---

## Task 7: AI Review Workflow（ai-review.yml）

**Files:**
- Create: `.github/workflows/ai-review.yml`

- [ ] **Step 1: 创建 ai-review.yml**

`.github/workflows/ai-review.yml`：

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

- [ ] **Step 2: 验证 YAML 语法**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ai-review.yml'))"
```

Expected: 无报错。

- [ ] **Step 3: 提交**

```bash
git add .github/workflows/ai-review.yml
git commit -m "ci(#<issue号>): 添加 Claude AI Code Review workflow"
```

---

## Task 8: Security Workflow + Dependabot + gitleaksignore

**Files:**
- Create: `.github/workflows/security.yml`, `.github/dependabot.yml`, `.gitleaksignore`

- [ ] **Step 1: 创建 security.yml**

`.github/workflows/security.yml`：

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
      - run: bunx npm-audit-html --level=high || true
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

- [ ] **Step 2: 创建 dependabot.yml**

`.github/dependabot.yml`：

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

- [ ] **Step 3: 创建 .gitleaksignore**

`.gitleaksignore`：

```
# 文档中的示例 token / key（非真实凭据）
# 格式：每行一个 commit hash:file:line 或 fingerprint
```

> 初始为空文件（仅含注释）。后续如 gitleaks 在文档示例中误报，将对应 fingerprint 加入此文件。

- [ ] **Step 4: 验证 YAML 语法**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/security.yml'))"
python3 -c "import yaml; yaml.safe_load(open('.github/dependabot.yml'))"
```

Expected: 无报错。

- [ ] **Step 5: 提交**

```bash
git add .github/workflows/security.yml .github/dependabot.yml .gitleaksignore
git commit -m "ci(#<issue号>): 添加安全扫描 workflow + Dependabot 配置"
```

---

## Task 9: 安装依赖 + 全量验证

**Files:** 无新文件，验证已有配置

- [ ] **Step 1: 根目录安装全部依赖**

```bash
bun install
```

Expected: 成功安装，生成 `bun.lockb`。

- [ ] **Step 2: 运行全局 lint**

```bash
bun run lint
```

Expected: 通过（可能有 markdown warning 需要修复）。

- [ ] **Step 3: 运行全局格式检查**

```bash
bun run format:check
```

Expected: 通过。若失败则运行 `bun run format` 后重新检查。

- [ ] **Step 4: 运行 gateway 测试**

```bash
cd packages/gateway && bun test
```

Expected: 1 test passed。

- [ ] **Step 5: 运行 web 测试**

```bash
cd packages/web && bun run test
```

Expected: 1 test passed。

- [ ] **Step 6: 提交 lockfile 和修复**

```bash
git add bun.lockb
git commit -m "chore(#<issue号>): 添加 lockfile 并修复 lint 问题"
```

---

## Task 10: 分支保护规则配置

**Files:** 无文件变更，GitHub 仓库设置

- [ ] **Step 1: 创建 develop 和 test 分支**

```bash
git branch develop
git branch test
git push origin develop test
```

- [ ] **Step 2: 配置 main 分支保护**

通过 GitHub UI (Settings → Branches → Add rule) 或 gh CLI：

```bash
gh api repos/{owner}/{repo}/rulesets -X POST -F '
{
  "name": "main-protection",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/heads/main"], "exclude": [] } },
  "rules": [
    { "type": "pull_request", "parameters": { "required_approving_review_count": 1, "dismiss_stale_reviews_on_push": true, "require_last_push_approval": false } },
    { "type": "required_status_checks", "parameters": { "strict_required_status_checks_policy": true, "required_status_checks": [{ "context": "lint-gateway" }, { "context": "lint-web" }, { "context": "test-gateway" }, { "context": "test-web" }, { "context": "gitleaks" }, { "context": "ai-review" }] } },
    { "type": "non_fast_forward" },
    { "type": "deletion" }
  ]
}'
```

> 注意：required_status_checks 的 context 名称需要在第一次 CI 运行后才能精确确认。上述为预期名称，实际配置时根据 Actions 运行结果调整。建议先通过 GitHub UI 手动配置。

- [ ] **Step 3: 配置 develop 分支保护**

与 main 相同规则。

- [ ] **Step 4: 配置 test 分支保护**

与 main 类似，但 required_status_checks 不包含 ai-review。

- [ ] **Step 5: 验证保护规则**

尝试直接 push 到 main：

```bash
git push origin main
```

Expected: 被拒绝（若保护规则已生效）。

---

## Task 11: 端到端验证

**Files:** 无新文件

- [ ] **Step 1: 创建测试 feature 分支**

```bash
git checkout develop
git checkout -b feature/test-ci-pipeline
```

- [ ] **Step 2: 做一个小改动**

在 `packages/gateway/src/index.ts` 添加一个 `/version` 端点：

```ts
app.get("/version", (c) => c.json({ version: "0.0.1" }));
```

在 `packages/gateway/src/index.test.ts` 添加对应测试：

```ts
it("GET /version returns version", async () => {
  const res = await app.request("/version");
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body).toEqual({ version: "0.0.1" });
});
```

- [ ] **Step 3: 本地验证**

```bash
cd packages/gateway && bun test
```

Expected: 2 tests passed。

- [ ] **Step 4: 提交并推送**

```bash
git add packages/gateway/
git commit -m "feat(#<issue号>): 添加 /version 端点"
git push -u origin feature/test-ci-pipeline
```

- [ ] **Step 5: 创建 PR 到 develop**

```bash
gh pr create --base develop --title "feat: 添加 /version 端点" --body "CI 端到端验证测试 PR"
```

- [ ] **Step 6: 观察 CI 结果**

检查 PR 页面：
- `lint-gateway` ✅
- `test-gateway` ✅
- `gitleaks` ✅
- `ai-review` ✅（或 pending，取决于 ANTHROPIC_API_KEY 是否配置）

Expected: 所有 check 通过。

- [ ] **Step 7: 清理测试 PR**

验证完成后关闭或合并该 PR，删除测试分支。

---

## 前置条件

在开始实现前，需确认以下 GitHub Secrets 已配置：

| Secret | 用途 |
|--------|------|
| `ANTHROPIC_API_KEY` | Claude AI Review 使用 |

GitHub Secret Scanning 需在仓库 Settings → Code security 中手动开启。
