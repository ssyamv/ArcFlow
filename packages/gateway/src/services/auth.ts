import { SignJWT, jwtVerify } from "jose";
import { getConfig } from "../config";

export function generateOAuthUrl(): string {
  const config = getConfig();
  const params = new URLSearchParams({
    app_id: config.feishuAppId,
    redirect_uri: config.oauthRedirectUri,
    state: crypto.randomUUID(),
  });
  return `${config.feishuBaseUrl}/open-apis/authen/v1/authorize?${params}`;
}

export async function exchangeCodeForUser(code: string): Promise<{
  open_id: string;
  union_id?: string;
  name: string;
  avatar_url?: string;
  email?: string;
}> {
  const config = getConfig();
  const tokenRes = await fetch(
    `${config.feishuBaseUrl}/open-apis/auth/v3/app_access_token/internal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: config.feishuAppId, app_secret: config.feishuAppSecret }),
    },
  );
  const tokenData = (await tokenRes.json()) as { app_access_token: string };

  const authRes = await fetch(`${config.feishuBaseUrl}/open-apis/authen/v1/oidc/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${tokenData.app_access_token}`,
    },
    body: JSON.stringify({ grant_type: "authorization_code", code }),
  });
  const authData = (await authRes.json()) as {
    data: {
      access_token: string;
      open_id: string;
      union_id?: string;
      name: string;
      avatar_url?: string;
      email?: string;
    };
  };

  return {
    open_id: authData.data.open_id,
    union_id: authData.data.union_id,
    name: authData.data.name,
    avatar_url: authData.data.avatar_url,
    email: authData.data.email,
  };
}

export async function signJwt(payload: { sub: number; role: string }): Promise<string> {
  const config = getConfig();
  const secret = new TextEncoder().encode(config.jwtSecret);
  return new SignJWT({ sub: payload.sub, role: payload.role })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(config.jwtExpiresIn)
    .sign(secret);
}

export async function verifyJwt(token: string): Promise<{ sub: number; role: string }> {
  const config = getConfig();
  const secret = new TextEncoder().encode(config.jwtSecret);
  const { payload } = await jwtVerify(token, secret);
  return { sub: payload.sub as number, role: payload.role as string };
}
