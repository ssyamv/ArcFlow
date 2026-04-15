/**
 * 测试用的完整 Config 默认值。
 * 所有使用 mock.module("../config") 的测试文件都应该基于此扩展，
 * 避免返回不完整的 config 导致跨文件 mock 污染。
 */
import type { Config } from "./config";

export function createTestConfig(overrides?: Partial<Config>): Config {
  return {
    port: 3100,
    difyBaseUrl: "http://dify-test:3001",
    difyApiKey: "dify-shared-val",
    difyTechDocApiKey: "dify-tech-key",
    difyOpenApiApiKey: "dify-openapi-key",
    difyBugAnalysisApiKey: "dify-bug-key",
    planeBaseUrl: "http://plane-test:8080",
    planeExternalUrl: "http://plane-test:8080",
    planeApiToken: "test-plane-token",
    backendGitRepo: "git@example.com:org/backend.git",
    vue3GitRepo: "",
    flutterGitRepo: "",
    androidGitRepo: "",
    gitWorkDir: "/tmp/gateway-git",
    planeWebhookSecret: "",
    planeApprovedStateId: "state-approved",
    gitWebhookSecret: "",
    cicdWebhookSecret: "",
    feishuBaseUrl: "https://xfchat.iflytek.com",
    feishuAppId: "test-app-id",
    feishuAppSecret: "test-app-secret",
    feishuVerificationToken: "",
    feishuEncryptKey: "",
    feishuDefaultChatId: "oc_test_chat",
    difyPrdGenApiKey: "",
    difyRagApiKey: "",
    difyDatasetApiKey: "",
    difyDatasetId: "",
    difyDatasetMap: {},
    claudeCodeTimeout: 500,
    ibuildBaseUrl: "http://ibuild-test:8080",
    ibuildClientKey: "test-client-key",
    ibuildUser: "test-user",
    ibuildWebhookSecret: "",
    ibuildAppRepoMap: { default: "backend" },
    ibuildAppWorkspaceMap: {},
    jwtSecret: "test-jwt-secret-at-least-32-chars-long!!",
    jwtExpiresIn: "7d",
    oauthRedirectUri: "http://localhost:5173/auth/callback",
    webBaseUrl: "http://localhost:5173",
    siliconflowApiKey: "test-sf-key",
    siliconflowBaseUrl: "http://localhost:1",
    ragDbPath: ":memory:",
    ragEmbeddingModel: "BAAI/bge-m3",
    ragEmbeddingDim: 4,
    ragSyncIntervalMs: 600000,
    ...overrides,
  };
}
