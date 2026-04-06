import { getConfig } from "../config";

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
