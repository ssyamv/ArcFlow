export const workflowTypeLabels: Record<string, string> = {
  prd_to_tech: "PRD → 技术文档",
  tech_to_openapi: "技术文档 → OpenAPI",
  bug_analysis: "Bug 分析",
  code_gen: "代码生成",
};

export function typeLabel(type: string): string {
  return workflowTypeLabels[type] ?? type;
}

export const statusColors: Record<string, string> = {
  pending: "text-gray-400",
  running: "text-blue-500",
  success: "text-green-500",
  failed: "text-red-500",
};
