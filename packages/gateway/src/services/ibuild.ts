import { getConfig } from "../config";
import type { IBuildDetail, IBuildModule } from "../types";

let cachedToken: string | null = null;
let tokenExpiresAt: number = 0;

const TOKEN_EXPIRE_MINUTES = 1440;
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

export function _resetTokenCache(): void {
  cachedToken = null;
  tokenExpiresAt = 0;
}

export async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - TOKEN_REFRESH_BUFFER_MS) {
    return cachedToken;
  }

  const config = getConfig();
  const res = await fetch(`${config.ibuildBaseUrl}/restapi/cs/v1/auth/accessToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientKey: config.ibuildClientKey,
      user: config.ibuildUser,
      expire: String(TOKEN_EXPIRE_MINUTES),
    }),
  });

  if (!res.ok) {
    throw new Error(`iBuild token request failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { token: string };
  cachedToken = data.token;
  tokenExpiresAt = Date.now() + TOKEN_EXPIRE_MINUTES * 60 * 1000;

  return cachedToken;
}

export async function getBuildDetail(
  projectId: string,
  appId: string,
  buildSid: string,
): Promise<IBuildDetail> {
  const config = getConfig();
  const token = await getAccessToken();
  const url = `${config.ibuildBaseUrl}/restapi/ibuild/v1/projects/${projectId}/applications/${appId}/buildstatusdetail?buildSid=${buildSid}`;
  const res = await fetch(url, { headers: { accessToken: token } });
  if (!res.ok) throw new Error(`iBuild getBuildDetail failed: ${res.status}`);
  const data = (await res.json()) as { resCode: string; obj: IBuildDetail | null };
  if (!data.obj) throw new Error(`Build ${buildSid} not found`);
  return data.obj;
}

const MAX_LOG_SIZE = 100 * 1024;

export async function getBuildLog(logUrl: string): Promise<string> {
  const config = getConfig();
  const token = await getAccessToken();
  const fullUrl = `${config.ibuildBaseUrl}${logUrl}`;
  const res = await fetch(fullUrl, { headers: { accessToken: token } });
  if (!res.ok) throw new Error(`iBuild getBuildLog failed: ${res.status}`);
  let text = await res.text();
  if (text.length > MAX_LOG_SIZE) {
    text = `[日志已截断，仅保留最后 100KB]\n${text.slice(-MAX_LOG_SIZE)}`;
  }
  return text;
}

export function getFailedModules(modules: IBuildModule[] | null): string[] {
  if (!modules) return [];
  return modules.filter((m) => m.status === "FAIL").map((m) => m.modulekey);
}

const BRANCH_ISSUE_REGEX = /^(?:feat|fix|hotfix|feature)\/([A-Z]+-\d+)/;

export function extractIssueIdFromBranch(branch: string): string | null {
  const match = branch.match(BRANCH_ISSUE_REGEX);
  return match ? match[1] : null;
}
