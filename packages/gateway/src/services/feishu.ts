import { getConfig } from "../config";

let accessToken = "";
let tokenExpiresAt = 0;

async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiresAt) {
    return accessToken;
  }

  const config = getConfig();
  const res = await fetch(
    `${config.feishuBaseUrl}/open-apis/auth/v3/tenant_access_token/internal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_id: config.feishuAppId,
        app_secret: config.feishuAppSecret,
      }),
    },
  );

  const json = (await res.json()) as {
    code: number;
    tenant_access_token: string;
    expire: number;
  };

  if (json.code !== 0) {
    throw new Error(`Feishu auth failed: code ${json.code}`);
  }

  accessToken = json.tenant_access_token;
  // Refresh 5 minutes before expiry
  tokenExpiresAt = Date.now() + (json.expire - 300) * 1000;
  return accessToken;
}

async function sendMessage(
  chatId: string,
  msgType: string,
  content: string,
): Promise<{ message_id?: string }> {
  const token = await getAccessToken();

  const res = await fetch(
    `${getConfig().feishuBaseUrl}/open-apis/im/v1/messages?receive_id_type=chat_id`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        receive_id: chatId,
        msg_type: msgType,
        content,
      }),
    },
  );

  if (!res.ok) {
    console.error(`Feishu send message failed: ${res.status}`);
    return {};
  }

  try {
    const json = (await res.json()) as { data?: { message_id?: string } };
    return { message_id: json.data?.message_id };
  } catch {
    return {};
  }
}

export interface TechReviewCardParams {
  chatId: string;
  featureName: string;
  prdPath: string;
  techDocPath: string;
  openApiPath: string;
  issueId: string;
  workspaceSlug: string;
  planeWorkspaceSlug: string;
  planeProjectId: string;
  planeBaseUrl?: string;
}

export async function sendTechReviewCard(params: TechReviewCardParams): Promise<void> {
  const config = getConfig();
  const planeBase = params.planeBaseUrl || config.planeExternalUrl;
  const planeIssueUrl = `${planeBase}/${params.planeWorkspaceSlug}/projects/${params.planeProjectId}/issues/${params.issueId}`;
  const docUrl = (path: string) =>
    `${config.webBaseUrl}/docs?ws=${encodeURIComponent(params.workspaceSlug)}&path=${encodeURIComponent(path)}`;
  const prdLink = docUrl(params.prdPath);
  const techDocLink = docUrl(params.techDocPath);
  const openApiLink = docUrl(params.openApiPath);

  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: `📋 技术文档 Review: ${params.featureName}` },
      template: "blue",
    },
    elements: [
      {
        tag: "div",
        fields: [
          {
            is_short: true,
            text: { tag: "lark_md", content: `**PRD:** [查看](${prdLink})` },
          },
          {
            is_short: true,
            text: { tag: "lark_md", content: `**技术文档:** [查看](${techDocLink})` },
          },
          {
            is_short: true,
            text: { tag: "lark_md", content: `**OpenAPI:** [查看](${openApiLink})` },
          },
        ],
      },
      {
        tag: "div",
        text: {
          tag: "lark_md",
          content: `请在 Plane 中审批此 Issue，状态改为 **Done** 表示通过，改为 **Cancelled** 表示打回。`,
        },
      },
      {
        tag: "action",
        actions: [
          {
            tag: "button",
            text: { tag: "plain_text", content: "📝 前往 Plane 审批" },
            type: "primary",
            url: planeIssueUrl,
          },
        ],
      },
    ],
  };

  await sendMessage(params.chatId, "interactive", JSON.stringify(card));
}

export async function sendNotification(
  chatId: string,
  title: string,
  content: string,
): Promise<void> {
  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: title },
      template: "yellow",
    },
    elements: [{ tag: "div", text: { tag: "lark_md", content } }],
  };

  await sendMessage(chatId, "interactive", JSON.stringify(card));
}

/**
 * 将标准 Markdown 转为飞书 lark_md 兼容格式
 *
 * lark_md 不支持：### 标题、Markdown 表格、``` 代码块
 * lark_md 支持：**粗体**、*斜体*、~~删除线~~、[链接](url)、`行内代码`、- 列表
 */
function toLarkMd(md: string): string {
  return (
    md
      // ### 标题 → **粗体**
      .replace(/^#{1,6}\s+(.+)$/gm, "**$1**")
      // Markdown 表格：移除分隔行，数据行转为列表
      .replace(/^\|[-:|\s]+\|$/gm, "")
      .replace(/^\|(.+)\|$/gm, (_match, row: string) => {
        const cells = row
          .split("|")
          .map((c: string) => c.trim())
          .filter(Boolean);
        return `- ${cells.join(" | ")}`;
      })
      // ``` 代码块 → 缩进（lark_md 不支持围栏代码块）
      .replace(/```\w*\n([\s\S]*?)```/g, (_match, code: string) => {
        return code
          .split("\n")
          .map((line: string) => `  ${line}`)
          .join("\n");
      })
      .trim()
  );
}

export async function sendBugNotification(
  chatId: string,
  issueId: string,
  bugReport: string,
  severity: string,
): Promise<void> {
  const template = severity === "P0" || severity === "P1" ? "red" : "orange";
  const larkContent = toLarkMd(bugReport);
  const card = {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: "plain_text", content: `🐛 Bug [${severity}]: ${issueId}` },
      template,
    },
    elements: [{ tag: "div", text: { tag: "lark_md", content: larkContent } }],
  };

  await sendMessage(chatId, "interactive", JSON.stringify(card));
}

export async function updateCard(
  messageId: string,
  updatedCard: Record<string, unknown>,
): Promise<void> {
  const token = await getAccessToken();

  const res = await fetch(`${getConfig().feishuBaseUrl}/open-apis/im/v1/messages/${messageId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      msg_type: "interactive",
      content: JSON.stringify(updatedCard),
    }),
  });

  if (!res.ok) {
    console.error(`Feishu update card failed: ${res.status}`);
  }
}
