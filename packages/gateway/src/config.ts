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
  planeApiToken: string;
  planeWorkspaceSlug: string;

  // Git
  docsGitRepo: string;
  backendGitRepo: string;
  vue3GitRepo: string;
  flutterGitRepo: string;
  androidGitRepo: string;
  gitWorkDir: string;

  // Webhook secrets
  planeWebhookSecret: string;
  gitWebhookSecret: string;
  cicdWebhookSecret: string;

  // 飞书
  feishuAppId: string;
  feishuAppSecret: string;
  feishuVerificationToken: string;
  feishuEncryptKey: string;

  // Wiki.js
  wikijsBaseUrl: string;
  wikijsApiKey: string;

  // Claude Code
  claudeCodeTimeout: number;
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
    planeApiToken: process.env.PLANE_API_TOKEN ?? "",
    planeWorkspaceSlug: process.env.PLANE_WORKSPACE_SLUG ?? "",

    docsGitRepo: process.env.DOCS_GIT_REPO ?? "",
    backendGitRepo: process.env.BACKEND_GIT_REPO ?? "",
    vue3GitRepo: process.env.VUE3_GIT_REPO ?? "",
    flutterGitRepo: process.env.FLUTTER_GIT_REPO ?? "",
    androidGitRepo: process.env.ANDROID_GIT_REPO ?? "",
    gitWorkDir: process.env.GIT_WORK_DIR ?? "/tmp/gateway-git",

    planeWebhookSecret: process.env.PLANE_WEBHOOK_SECRET ?? "",
    gitWebhookSecret: process.env.GIT_WEBHOOK_SECRET ?? "",
    cicdWebhookSecret: process.env.CICD_WEBHOOK_SECRET ?? "",

    feishuAppId: process.env.FEISHU_APP_ID ?? "",
    feishuAppSecret: process.env.FEISHU_APP_SECRET ?? "",
    feishuVerificationToken: process.env.FEISHU_VERIFICATION_TOKEN ?? "",
    feishuEncryptKey: process.env.FEISHU_ENCRYPT_KEY ?? "",

    wikijsBaseUrl: process.env.WIKIJS_BASE_URL ?? "",
    wikijsApiKey: process.env.WIKIJS_API_KEY ?? "",

    claudeCodeTimeout: Number(process.env.CLAUDE_CODE_TIMEOUT) || 600000,
  };
}
