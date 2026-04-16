> 文档状态：历史参考。此文档记录阶段性设计或已被后续方案替代，不应单独作为当前架构依据。当前事实请先看 `README.md`、`docs/AI研发运营一体化平台_技术架构方案.md`、`docs/documentation-status.md`。

# 各端 CLAUDE.md 规范设计规格文档

> 版本：v1.0 · 2026-04-02

---

## 一、设计背景

### 问题

ArcFlow 涉及 5 个仓库（docs、后端、Vue3、Flutter、Android），Claude Code 在各仓库生成代码时需要了解该仓库的技术栈、分层规范、命名约定等上下文。目前缺少这些规范定义。

### 目标

为每个仓库定义 CLAUDE.md，让 Claude Code 在 headless 模式下也能生成符合团队规范的代码。

### 设计决策

采用**骨架 + 引用型**方案：CLAUDE.md 只写 Claude Code 必须知道的核心约束（分层规则、命名约定、关键命令），项目中已有的信息（目录结构、依赖版本）让 Claude Code 自己从项目中读取。

---

## 二、docs 仓库 CLAUDE.md

```markdown
# 项目知识库 — Claude 上下文

## 项目概况

ArcFlow AI 研发运营一体化平台的文档仓库。所有文档以 Markdown 存储，与 Wiki.js 双向同步。

- 后端：Java 17 + Spring Boot 3.x + MyBatis-Plus + MySQL 8.0
- Web 前端：Vue3 + Element Plus + shadcn-vue + Pinia + Vue Router + Vite
- 移动端：Flutter 3.x + GetX + Dio
- 客户端：Kotlin（支持 Jetpack Compose 和传统 XML）
- 接口规范：RESTful，统一返回 Result<T>

## 文档目录说明

| 目录 | 内容 | 负责方 | AI 权限 |
|------|------|--------|---------|
| /prd | PRD 产品需求文档 | 产品 PM | 只读，不得修改 |
| /tech-design | 技术设计文档 | AI 生成，研发 Review | 可写 |
| /api | OpenAPI yaml 规范 | AI 生成 | 可写 |
| /arch | 系统架构文档 | 研发维护 | 只读 |
| /ops | 运营 SOP | 运营维护 | 只读 |
| /market | 市场材料 | 市场维护 | 只读 |

## AI 操作规范

- 生成技术设计文档时，保存至 `/tech-design/{yyyy-MM}/{功能名}.md`
- 生成 OpenAPI 规范时，保存至 `/api/{yyyy-MM}/{功能名}.yaml`
- 所有生成的文档必须包含 frontmatter（参见 /prd/_template-feature.md 和 /prd/_template-module.md）
- 不得修改 /prd、/arch、/ops、/market 目录下的文件
- 文档内容使用中文

## 文档 Frontmatter 规范

所有 .md 文件必须包含：

- title、status（draft/active/deprecated）、owner、last_updated
- PRD 额外需要：type（module/feature）、created、sprint
- 技术设计文档额外需要：source_prd、generated_by、generated_at、reviewer

```

---

## 三、后端仓库 CLAUDE.md

```markdown
# 后端项目 — Claude 上下文

## 技术栈

- Java 17 + Spring Boot 3.x + MyBatis-Plus + MySQL 8.0
- 构建工具：Maven
- 首次操作前先阅读 pom.xml 了解依赖版本和模块结构

## 分层架构

Controller → Service（接口） → ServiceImpl → Mapper → Entity

| 层 | 职责 | 命名规则 |
|----|------|----------|
| Controller | 参数校验、调用 Service、统一返回 | XxxController |
| Service | 业务接口定义 | XxxService |
| ServiceImpl | 业务逻辑实现 | XxxServiceImpl |
| Mapper | 数据库操作（MyBatis-Plus BaseMapper） | XxxMapper |
| Entity | 数据库实体，与表一一对应 | Xxx |
| DTO | 请求/响应数据传输对象 | XxxReqDTO / XxxRespDTO |
| VO | 视图对象（如需与 DTO 区分） | XxxVO |

## 包结构约定

```

com.公司.项目
├── controller/
├── service/
│   └── impl/
├── mapper/
├── entity/
├── dto/
├── vo/
├── config/          # 配置类
├── common/          # 公共工具、常量、枚举
│   ├── result/      # 统一返回 Result<T>
│   ├── exception/   # 全局异常处理
│   └── enums/
└── interceptor/     # 拦截器

```text

## 接口规范

- RESTful 风格，路径以 `/api/v1/` 开头
- 统一返回 `Result<T>`，包含 code、message、data 三个字段
- 成功：code=200，失败：业务错误码从 1000 起
- 分页查询统一使用 MyBatis-Plus 的 IPage<T>
- 请求参数：GET 用 @RequestParam，POST/PUT 用 @RequestBody
- 路径命名：小写中划线，如 `/api/v1/user-roles`

## 数据库规范

- 表名：小写下划线，如 `user_role`
- 字段名：小写下划线，如 `created_at`
- 每张表必须包含：id（主键，BIGINT AUTO_INCREMENT）、created_at、updated_at
- 逻辑删除字段：deleted（TINYINT，0 未删除 / 1 已删除）
- MyBatis-Plus 自动填充 created_at、updated_at

## 代码规范

- 禁止在 Controller 层写业务逻辑，只做参数校验和调用 Service
- Service 之间可以互相调用，但禁止循环依赖
- 所有数据库操作通过 Mapper 层，禁止在 Service 中直接写 SQL
- 异常统一通过全局异常处理器捕获，不在 Controller 中 try-catch
- 参数校验使用 @Valid + JSR 303 注解
- 日志使用 SLF4J，注入方式 `@Slf4j`（Lombok），禁止使用 `System.out.println`

```

---

## 四、Vue3 前端仓库 CLAUDE.md

```markdown
# Vue3 前端项目 — Claude 上下文

## 技术栈

- Vue 3 + TypeScript + Vite
- 组件库：Element Plus + shadcn-vue
- 状态管理：Pinia
- 路由：Vue Router
- HTTP 请求：Axios
- 首次操作前先阅读 package.json 了解依赖版本，阅读 src/ 目录结构了解项目组织

## 目录结构约定

```

src/
├── api/              # 接口请求（按模块拆分文件）
├── assets/           # 静态资源
├── components/       # 全局公共组件
├── composables/      # 组合式函数（useXxx）
├── layouts/          # 布局组件
├── pages/            # 页面组件（按模块分目录）
│   └── user/
│       ├── index.vue
│       └── components/   # 页面级私有组件
├── router/           # 路由配置
├── stores/           # Pinia 状态管理（按模块拆分）
├── styles/           # 全局样式
├── types/            # TypeScript 类型定义
└── utils/            # 工具函数

```text

## 组件规范

- 使用 `<script setup lang="ts">` + Composition API，不使用 Options API
- 组件文件名：PascalCase，如 `UserProfile.vue`
- 全局公共组件放 `src/components/`，页面私有组件放在页面目录下的 `components/`
- Element Plus 用于表单、表格、弹窗等后台管理类组件
- shadcn-vue 用于需要高度定制样式的组件
- 两套组件库的使用边界：Element Plus 优先，shadcn-vue 仅在 Element Plus 无法满足定制需求时使用

## 接口请求规范

- 按模块拆分文件，如 `src/api/user.ts`
- 每个接口函数返回类型明确定义
- 统一使用封装后的 Axios 实例（含 token 注入、错误拦截、Result<T> 解包）
- 接口函数命名：`getXxx` / `createXxx` / `updateXxx` / `deleteXxx`

## 状态管理规范

- 一个模块一个 store 文件，如 `src/stores/user.ts`
- 使用 `defineStore` + Setup Store 风格（组合式写法）
- 只有跨组件共享的状态才放 store，组件内部状态用 `ref` / `reactive`

## 样式规范

- 组件样式使用 `<style scoped>`，避免全局污染
- 全局样式变量定义在 `src/styles/` 中
- 如果 package.json 中包含 tailwindcss 依赖，则优先使用 Tailwind CSS 工具类；否则使用 scoped CSS

## 代码规范

- 所有变量和函数使用 TypeScript 类型标注
- 组合式函数命名以 `use` 开头，如 `useUserList`
- 页面组件负责组装和布局，业务逻辑抽到 composables 中
- 路由使用懒加载：`() => import('@/pages/xxx/index.vue')`

## Figma MCP 使用规范

- Claude Code 通过 Figma MCP Server 读取设计稿生成 UI 代码
- Figma 组件优先映射到 Element Plus 组件，Element Plus 无法满足时映射到 shadcn-vue
- 从 Figma 提取的颜色和间距应映射到项目已有的 CSS 变量 / Tailwind token，不使用硬编码值
- 生成的代码必须遵守本文档中的组件规范和样式规范

```

---

## 五、Flutter 移动端仓库 CLAUDE.md

```markdown
# Flutter 移动端项目 — Claude 上下文

## 技术栈

- Flutter 3.x + Dart
- 状态管理 + 路由 + 依赖注入：GetX
- 网络请求：Dio
- 本地存储：shared_preferences（轻量）/ hive（结构化）
- 首次操作前先阅读 pubspec.yaml 了解依赖版本，阅读 lib/ 目录结构了解项目组织

## 目录结构约定

```

lib/
├── main.dart
├── app/
│   ├── routes/          # GetX 路由定义
│   ├── bindings/        # GetX 依赖绑定
│   └── theme/           # 主题配置
├── modules/             # 按业务模块划分
│   └── user/
│       ├── views/       # 页面 Widget
│       ├── controllers/ # GetX Controller
│       ├── models/      # 数据模型
│       ├── widgets/     # 模块私有组件
│       └── bindings.dart
├── api/                 # 接口请求（按模块拆分）
├── models/              # 全局共享数据模型
├── widgets/             # 全局公共组件
├── utils/               # 工具函数
└── constants/           # 常量定义

```text

## 分层规范

View → Controller → API / Repository

| 层 | 职责 | 命名规则 |
|----|------|----------|
| View | UI 渲染，监听 Controller 状态 | XxxPage / XxxView |
| Controller | 业务逻辑、状态管理 | XxxController（extends GetxController） |
| API | 网络请求封装 | XxxApi |
| Model | 数据模型，含 fromJson / toJson | XxxModel |
| Binding | 依赖注入声明 | XxxBinding |

## GetX 使用规范

- 状态管理使用 `.obs` + `Obx()` 响应式方式
- 路由使用 GetX 命名路由，统一在 `app/routes/` 中定义
- 依赖注入使用 Binding 模式，不在页面内直接 `Get.put()`
- Controller 生命周期：`onInit()` 初始化数据，`onClose()` 释放资源
- 页面间传参通过 `Get.arguments` 或 `Get.parameters`

## 网络请求规范

- 统一 Dio 实例封装（含 BaseUrl、Token 拦截器、错误处理、Result<T> 解包）
- 按模块拆分 API 文件，如 `api/user_api.dart`
- 接口函数命名：`getXxx` / `createXxx` / `updateXxx` / `deleteXxx`
- Model 类必须实现 `fromJson` 工厂构造函数和 `toJson` 方法

## 代码规范

- 文件名：小写下划线，如 `user_controller.dart`
- 类名：PascalCase，如 `UserController`
- Widget 拆分原则：超过 80 行的 build 方法必须拆分子 Widget
- 页面级 Widget 放 `views/`，可复用组件放 `widgets/`
- 常量统一定义在 `constants/` 中，禁止硬编码字符串和数字

## 错误处理规范

- 网络异常统一在 Dio 拦截器中转换为业务错误对象
- Controller 中使用 try-catch 捕获异常，更新错误状态（如 `isError.value = true`）
- 用户提示统一使用 `Get.snackbar()` 展示错误信息
- loading 状态在 Controller 中通过 `isLoading.obs` 管理，View 层 `Obx()` 响应

## Figma MCP 使用规范

- Claude Code 通过 Figma MCP Server 读取设计稿生成 Flutter UI 代码
- Figma 组件映射到 Flutter 原生 Widget 或项目 `widgets/` 中的自定义组件
- 从 Figma 提取的颜色和间距应映射到 `app/theme/` 中定义的主题变量，不使用硬编码值
- 生成的代码必须遵守本文档中的分层规范和代码规范

```

---

## 六、Android 客户端仓库 CLAUDE.md

```markdown
# Android 客户端项目 — Claude 上下文

## 技术栈

- Kotlin + Android SDK
- UI：支持 Jetpack Compose 和传统 XML 两种方式（新页面优先 Compose，维护旧页面保持 XML）
- 架构：MVVM
- 网络请求：Retrofit + OkHttp + Kotlin Coroutines
- 依赖注入：Hilt
- 图片加载：Coil
- 本地存储：DataStore（轻量）/ Room（结构化）
- 首次操作前先阅读 build.gradle.kts 了解依赖版本，阅读模块和包结构了解项目组织

## 目录结构约定

```

app/src/main/java/com/公司/项目/
├── ui/                   # UI 层
│   └── user/
│       ├── UserActivity.kt 或 UserScreen.kt（Compose）
│       ├── UserViewModel.kt
│       └── components/   # 页面级私有组件
├── data/                 # 数据层
│   ├── api/              # Retrofit 接口定义（按模块拆分）
│   ├── model/            # 数据模型（DTO / Entity）
│   ├── repository/       # 数据仓库（协调远程和本地）
│   └── local/            # 本地数据源（Room DAO、DataStore）
├── di/                   # Hilt 依赖注入模块
├── common/               # 公共工具、扩展函数、常量
│   ├── base/             # 基类（BaseActivity、BaseViewModel）
│   ├── ext/              # Kotlin 扩展函数
│   └── constants/
└── widget/               # 全局公共 UI 组件

```text

## 分层规范

View（Activity/Fragment/Compose Screen） → ViewModel → Repository → API / Local

| 层 | 职责 | 命名规则 |
|----|------|----------|
| View | UI 渲染，观察 ViewModel 状态 | XxxActivity / XxxFragment / XxxScreen（Compose） |
| ViewModel | 业务逻辑、UI 状态管理 | XxxViewModel（@HiltViewModel） |
| Repository | 协调远程和本地数据源 | XxxRepository |
| API | Retrofit 接口定义 | XxxApi（interface） |
| Model | 数据模型 | XxxDTO（网络）/ XxxEntity（本地）/ XxxUiState（UI） |

## MVVM + Compose 规范

- UI 状态使用 `StateFlow`，ViewModel 中暴露为 `val uiState: StateFlow<XxxUiState>`
- Compose 页面通过 `collectAsStateWithLifecycle()` 收集状态
- 事件从 View → ViewModel 通过函数调用，不用 Event Channel（简单场景）
- 一次性事件（Toast、导航）使用 `SharedFlow` 或 `Channel`
- Compose 组件拆分原则：单个 Composable 函数不超过 60 行

## MVVM + XML 规范（维护旧页面）

- UI 状态使用 `LiveData` 或 `StateFlow` + `lifecycleScope.launch { flow.collect {} }`
- ViewBinding 替代 findViewById，禁止使用 kotlin-android-extensions
- 布局文件命名：`activity_xxx.xml` / `fragment_xxx.xml` / `item_xxx.xml`

## 网络请求规范

- Retrofit 接口按模块拆分，如 `data/api/UserApi.kt`
- 统一 OkHttp 拦截器处理 Token 注入、日志、错误转换
- 接口返回统一包装类 `Result<T>`（与后端 code/message/data 对应）
- 所有网络请求在 Repository 层通过 Coroutines 调用，ViewModel 中使用 `viewModelScope.launch`
- Retrofit BaseUrl 配置读取自 BuildConfig，所有接口路径遵循 `/api/v1/` 前缀 + 小写中划线约定

## 代码规范

- 文件名与类名一致：PascalCase
- 函数名 / 变量名：camelCase
- 常量：UPPER_SNAKE_CASE，定义在 `companion object` 或 `constants/` 中
- Hilt 注入：Repository 和 API 通过 `@Module` + `@Provides` 或 `@Binds` 提供
- 禁止在 View 层直接调用 API，必须通过 ViewModel → Repository

## Figma MCP 使用规范

- Claude Code 通过 Figma MCP Server 读取设计稿生成 Android UI 代码
- Figma 组件优先映射到 Material 3 Compose 组件，其次映射到项目 `widget/` 中的自定义组件
- 从 Figma 提取的颜色和间距应映射到 MaterialTheme 主题变量，不使用硬编码值
- 生成的代码必须遵守本文档中的 MVVM + Compose 规范

```

---

## 七、跨仓库一致性约定

以下约定在所有仓库中保持一致：

| 约定 | 说明 |
|------|------|
| 接口返回格式 | 统一 `Result<T>`，包含 code、message、data |
| 接口路径 | `/api/v1/` 前缀，小写中划线命名 |
| 接口函数命名 | `getXxx` / `createXxx` / `updateXxx` / `deleteXxx` |
| 网络层封装 | 各端各自封装（Axios / Dio / OkHttp），但统一处理 Token 注入、错误拦截、Result 解包 |
| 分层原则 | UI → 业务逻辑 → 数据访问，禁止跨层调用 |
| 业务错误码 | HTTP 200 时，Result.code=200 为成功，业务错误码从 1000 起，各端统一按此区分处理逻辑 |
| 文档语言 | 中文 |
