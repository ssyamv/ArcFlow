/**
 * Plane webhook payload 解析工具
 * 处理 Plane CE 真实 webhook 格式 → Gateway 内部触发参数
 */

/** Plane webhook 完整 payload 结构 */
export interface PlaneWebhookPayload {
  event: string; // "issue", "project", "cycle", etc.
  action: string; // "create", "update", "delete"
  webhook_id: string;
  workspace_id: string;
  data: PlaneIssueData;
}

export interface PlaneIssueData {
  id: string;
  project_id?: string;
  project?: string;
  name?: string;
  description_html?: string;
  description_text?: string;
  state_id?: string;
  priority?: string;
  labels?: string[];
  assignees?: string[];
  parent_id?: string;
  [key: string]: unknown;
}

/**
 * 从 Issue 描述中提取 PRD 文件路径
 *
 * 约定：PRD 路径以 prd/ 开头，如 prd/2026-04/login.md
 * 支持从 description_text（纯文本）或 description_html（HTML）中提取
 */
export function extractPrdPath(data: PlaneIssueData): string | undefined {
  // 优先从纯文本描述中匹配
  const text = data.description_text ?? "";
  const htmlText = data.description_html ?? "";

  // 匹配 prd/ 开头的路径，支持中文和常见字符
  const prdPattern = /(?:^|\s|["'>])(prd\/[\w\-/]+\.md)(?:\s|["'<]|$)/;

  const textMatch = text.match(prdPattern);
  if (textMatch) return textMatch[1];

  const htmlMatch = htmlText.match(prdPattern);
  if (htmlMatch) return htmlMatch[1];

  return undefined;
}

/**
 * 判断 webhook 是否应该触发 prd_to_tech 工作流
 *
 * 触发条件：
 * 1. event === "issue"
 * 2. action === "update"（状态变更是 update 事件）
 * 3. state_id 匹配配置的 Approved 状态 ID
 *
 * 注意：Plane CE webhook 只给 state_id，不给 state name。
 * 需要在 env 中配置 PLANE_APPROVED_STATE_ID。
 */
export function shouldTriggerWorkflow(
  payload: PlaneWebhookPayload,
  approvedStateId: string,
): boolean {
  if (payload.event !== "issue") return false;
  if (!payload.data?.id) return false;
  if (!approvedStateId) return false;

  // Plane CE 实际有两种 action 命名（旧 "create"/"update"，新 "created"/"updated"），都接受
  const action = payload.action;
  const isCreate = action === "create" || action === "created";
  const isUpdate = action === "update" || action === "updated";
  if (!isCreate && !isUpdate) return false;

  // state 在 webhook payload 中可能是：
  //   - 扁平的 data.state_id（旧契约）
  //   - 嵌套的 data.state.id（Plane CE 实际格式）
  //   - 活动条目 activity.new_value（state 变更事件）
  const flatStateId = payload.data.state_id;
  const nestedState = (payload.data as { state?: { id?: string } }).state;
  const nestedStateId = nestedState?.id;
  const activity = (payload as { activity?: { field?: string; new_value?: string } }).activity;
  const activityNewState = activity?.field === "state" ? activity.new_value : undefined;

  const candidates = [flatStateId, nestedStateId, activityNewState].filter(Boolean);
  return candidates.includes(approvedStateId);
}
