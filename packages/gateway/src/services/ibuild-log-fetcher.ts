import { getBuildDetail, getBuildLog, getFailedModules } from "./ibuild";

export async function fetchBuildLogWithContext(
  projectId: string,
  appId: string,
  buildSid: string,
): Promise<string> {
  const detail = await getBuildDetail(projectId, appId, buildSid);

  if (!detail.logUrl) {
    throw new Error(`Build ${buildSid} has no logUrl`);
  }

  const rawLog = await getBuildLog(detail.logUrl);
  const failedModules = getFailedModules(detail.modules);

  if (failedModules.length > 0) {
    return `失败构建模块：${failedModules.join(", ")}\n---\n${rawLog}`;
  }

  return rawLog;
}
