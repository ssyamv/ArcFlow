import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { getConfig } from "../config";
import { getUserById, listUserWorkspaces } from "../db/queries";

export interface UserContext {
  userId: number;
  displayName: string;
  workspaceId: number;
  expiresAt: number;
}

export async function resolveUserContext(token: string): Promise<UserContext> {
  const config = getConfig();
  const secret = new TextEncoder().encode(config.jwtSecret);
  let payload;
  try {
    const result = await jwtVerify(token, secret);
    payload = result.payload;
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) throw new Error("AUTH_EXPIRED");
    throw new Error("AUTH_INVALID");
  }
  const user = getUserById(payload.sub as number);
  if (!user) throw new Error("AUTH_INVALID");
  const workspaces = listUserWorkspaces(user.id);
  return {
    userId: user.id,
    displayName: user.name,
    workspaceId: workspaces[0]?.id ?? 0,
    expiresAt: Number(payload.exp ?? 0),
  };
}

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
  // Step 1: 获取 app_access_token
  const tokenRes = await fetch(
    `${config.feishuBaseUrl}/open-apis/auth/v3/app_access_token/internal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: config.feishuAppId, app_secret: config.feishuAppSecret }),
    },
  );
  const tokenJson = await tokenRes.json();
  console.log("[auth] app_access_token response:", JSON.stringify(tokenJson));
  const appAccessToken = tokenJson.app_access_token ?? tokenJson.tenant_access_token;
  if (!appAccessToken) {
    throw new Error(`Failed to get app_access_token: ${JSON.stringify(tokenJson)}`);
  }

  // Step 2: 用 code 换取 user_access_token + 用户信息
  // 尝试 OIDC 端点（标准飞书）和旧版端点（私有化可能用旧版）
  let userData: {
    open_id: string;
    union_id?: string;
    name: string;
    avatar_url?: string;
    email?: string;
  } | null = null;

  // 尝试 OIDC 端点
  const oidcRes = await fetch(`${config.feishuBaseUrl}/open-apis/authen/v1/oidc/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${appAccessToken}`,
    },
    body: JSON.stringify({ grant_type: "authorization_code", code }),
  });
  const oidcJson = await oidcRes.json();
  console.log("[auth] OIDC response:", JSON.stringify(oidcJson));

  if (oidcJson.data?.open_id) {
    // 标准飞书：OIDC 直接返回用户信息
    userData = {
      open_id: oidcJson.data.open_id,
      union_id: oidcJson.data.union_id,
      name: oidcJson.data.name ?? oidcJson.data.en_name ?? "用户",
      avatar_url: oidcJson.data.avatar_url ?? oidcJson.data.avatar?.avatar_origin,
      email: oidcJson.data.email,
    };
  } else if (oidcJson.data?.access_token) {
    // 私有化飞书：OIDC 只返回 user_access_token，需要额外调 user_info
    const userInfoRes = await fetch(`${config.feishuBaseUrl}/open-apis/authen/v1/user_info`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${oidcJson.data.access_token}`,
      },
    });
    const userInfoJson = await userInfoRes.json();
    console.log("[auth] user_info response:", JSON.stringify(userInfoJson));

    const d = userInfoJson.data;
    if (d?.open_id) {
      userData = {
        open_id: d.open_id,
        union_id: d.union_id,
        name: d.name ?? d.en_name ?? "用户",
        avatar_url: d.avatar_url ?? d.avatar?.avatar_origin,
        email: d.email,
      };
    }
  }

  // 如果 OIDC 没拿到，尝试旧版端点
  if (!userData) {
    const legacyRes = await fetch(`${config.feishuBaseUrl}/open-apis/authen/v1/access_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${appAccessToken}`,
      },
      body: JSON.stringify({ grant_type: "authorization_code", code }),
    });
    const legacyJson = await legacyRes.json();
    console.log("[auth] Legacy response:", JSON.stringify(legacyJson));

    const d = legacyJson.data;
    if (d?.open_id) {
      userData = {
        open_id: d.open_id,
        union_id: d.union_id,
        name: d.name ?? d.en_name ?? "用户",
        avatar_url: d.avatar_url ?? d.avatar?.avatar_origin,
        email: d.email,
      };
    }
  }

  if (!userData || !userData.open_id) {
    throw new Error(`Failed to get user info from Feishu. OIDC: ${JSON.stringify(oidcJson)}`);
  }

  return userData;
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
