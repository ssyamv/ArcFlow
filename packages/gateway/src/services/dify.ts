import { getConfig } from "../config";

interface DifyWorkflowResponse {
  data: {
    id: string;
    workflow_id: string;
    status: string;
    outputs: Record<string, string>;
    error?: string;
  };
}

async function callDifyWorkflow(inputs: Record<string, string>, retries = 2): Promise<string> {
  const config = getConfig();
  const url = `${config.difyBaseUrl}/v1/workflows/run`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.difyApiKey}`,
        },
        body: JSON.stringify({
          inputs,
          response_mode: "blocking",
          user: "gateway-service",
        }),
      });

      if (!res.ok) {
        throw new Error(`Dify API error: ${res.status} ${await res.text()}`);
      }

      const json = (await res.json()) as DifyWorkflowResponse;

      if (json.data.status !== "succeeded") {
        throw new Error(`Dify workflow failed: ${json.data.error ?? "unknown error"}`);
      }

      // Return the first output value (Dify workflows typically have one main output)
      const outputs = json.data.outputs;
      const outputKey = Object.keys(outputs)[0];
      return outputs[outputKey] ?? "";
    } catch (error) {
      if (attempt < retries) {
        const delay = attempt === 0 ? 5000 : 15000;
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }

  throw new Error("Dify workflow call failed after all retries");
}

export async function generateTechDoc(prdContent: string): Promise<string> {
  return callDifyWorkflow({ prd_content: prdContent });
}

export async function generateOpenApi(techDocContent: string): Promise<string> {
  return callDifyWorkflow({ tech_doc_content: techDocContent });
}

export async function analyzeBug(ciLog: string, context: string): Promise<string> {
  return callDifyWorkflow({ ci_log: ciLog, context });
}
