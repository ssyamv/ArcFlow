export interface Config {
  port: number;

  // Dify
  difyBaseUrl: string;
  difyApiKey: string;
  difyTechDocApiKey: string;
  difyOpenApiApiKey: string;
  difyBugAnalysisApiKey: string;

  // Plane
  planeBaseUrl: string;
  planeExternalUrl: string;
  planeApiToken: string;

  // Git
  backendGitRepo: string;
  vue3GitRepo: string;
  flutterGitRepo: string;
  androidGitRepo: string;
  gitWorkDir: string;

  // Webhook secrets
  planeWebhookSecret: string;
  gitWebhookSecret: string;
  cicdWebhookSecret: string;

  // Plane workflow
  planeApprovedStateId: string;

  // 飞书
  feishuBaseUrl: string;
  feishuAppId: string;
  feishuAppSecret: string;
  feishuVerificationToken: string;
  feishuEncryptKey: string;
  feishuDefaultChatId: string;

  // PRD 生成
  difyPrdGenApiKey: string;

  // RAG 知识库问答
  difyRagApiKey: string;

  // Dify Dataset API（知识库管理）
  difyDatasetApiKey: string;
  difyDatasetId: string;
  // 多项目知识库映射：project_id → { datasetId, ragApiKey? }
  difyDatasetMap: Record<string, { datasetId: string; ragApiKey?: string }>;

  // Claude Code
  claudeCodeTimeout: number;

  // iBuild
  ibuildBaseUrl: string;
  ibuildClientKey: string;
  ibuildUser: string;
  ibuildWebhookSecret: string;
  ibuildAppRepoMap: Record<string, string>;
  ibuildAppWorkspaceMap: Record<string, string>;

  // JWT / OAuth
  jwtSecret: string;
  jwtExpiresIn: string;
  oauthRedirectUri: string;

  // Web 前端
  webBaseUrl: string;

  // 硅基流动 Embedding + RAG
  siliconflowApiKey: string;
  siliconflowBaseUrl: string;
  ragDbPath: string;
  ragEmbeddingModel: string;
  ragEmbeddingDim: number;
  ragSyncIntervalMs: number;
}

export function getConfig(): Config {
  return {
    port: Number(process.env.PORT) || 3100,

    difyBaseUrl: process.env.DIFY_BASE_URL ?? "",
    difyApiKey: process.env.DIFY_API_KEY ?? "",
    difyTechDocApiKey: process.env.DIFY_TECH_DOC_API_KEY ?? process.env.DIFY_API_KEY ?? "",
    difyOpenApiApiKey: process.env.DIFY_OPENAPI_API_KEY ?? process.env.DIFY_API_KEY ?? "",
    difyBugAnalysisApiKey: process.env.DIFY_BUG_ANALYSIS_API_KEY ?? process.env.DIFY_API_KEY ?? "",

    planeBaseUrl: process.env.PLANE_BASE_URL ?? "",
    planeExternalUrl: process.env.PLANE_EXTERNAL_URL || process.env.PLANE_BASE_URL || "",
    planeApiToken: process.env.PLANE_API_TOKEN ?? "",

    backendGitRepo: process.env.BACKEND_GIT_REPO ?? "",
    vue3GitRepo: process.env.VUE3_GIT_REPO ?? "",
    flutterGitRepo: process.env.FLUTTER_GIT_REPO ?? "",
    androidGitRepo: process.env.ANDROID_GIT_REPO ?? "",
    gitWorkDir: process.env.GIT_WORK_DIR ?? "/tmp/gateway-git",

    planeWebhookSecret: process.env.PLANE_WEBHOOK_SECRET ?? "",
    planeApprovedStateId: process.env.PLANE_APPROVED_STATE_ID ?? "",
    gitWebhookSecret: process.env.GIT_WEBHOOK_SECRET ?? "",
    cicdWebhookSecret: process.env.CICD_WEBHOOK_SECRET ?? "",

    feishuBaseUrl: process.env.FEISHU_BASE_URL ?? "https://open.feishu.cn",
    feishuAppId: process.env.FEISHU_APP_ID ?? "",
    feishuAppSecret: process.env.FEISHU_APP_SECRET ?? "",
    feishuVerificationToken: process.env.FEISHU_VERIFICATION_TOKEN ?? "",
    feishuEncryptKey: process.env.FEISHU_ENCRYPT_KEY ?? "",
    feishuDefaultChatId: process.env.FEISHU_DEFAULT_CHAT_ID ?? "",

    difyPrdGenApiKey: process.env.DIFY_PRD_GEN_API_KEY ?? process.env.DIFY_API_KEY ?? "",

    difyRagApiKey: process.env.DIFY_RAG_API_KEY ?? process.env.DIFY_API_KEY ?? "",

    difyDatasetApiKey: process.env.DIFY_DATASET_API_KEY ?? "",
    difyDatasetId: process.env.DIFY_DATASET_ID ?? "",
    difyDatasetMap: JSON.parse(process.env.DIFY_DATASET_MAP || "{}"),

    claudeCodeTimeout: Number(process.env.CLAUDE_CODE_TIMEOUT) || 600000,

    ibuildBaseUrl: process.env.IBUILD_BASE_URL ?? "",
    ibuildClientKey: process.env.IBUILD_CLIENT_KEY ?? "",
    ibuildUser: process.env.IBUILD_USER ?? "",
    ibuildWebhookSecret: process.env.IBUILD_WEBHOOK_SECRET ?? "",
    ibuildAppRepoMap: JSON.parse(process.env.IBUILD_APP_REPO_MAP || '{"default":"backend"}'),
    ibuildAppWorkspaceMap: JSON.parse(process.env.IBUILD_APP_WORKSPACE_MAP || "{}"),

    jwtSecret: process.env.JWT_SECRET ?? "arcflow-dev-secret",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
    oauthRedirectUri: process.env.OAUTH_REDIRECT_URI ?? "http://localhost:5173/auth/callback",

    webBaseUrl: process.env.WEB_BASE_URL ?? "http://localhost:5173",

    siliconflowApiKey: process.env.SILICONFLOW_API_KEY ?? "",
    siliconflowBaseUrl: process.env.SILICONFLOW_BASE_URL ?? "https://api.siliconflow.cn/v1",
    ragDbPath: process.env.RAG_DB_PATH ?? "./data/rag.db",
    ragEmbeddingModel: process.env.RAG_EMBEDDING_MODEL ?? "BAAI/bge-m3",
    ragEmbeddingDim: Number(process.env.RAG_EMBEDDING_DIM) || 1024,
    ragSyncIntervalMs: Number(process.env.RAG_SYNC_INTERVAL_MS) || 300000,
  };
}
