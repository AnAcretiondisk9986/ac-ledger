/**
 * GitHub OAuth 设备流（Device Flow）客户端。
 *
 * 纯前端即可完成授权（官方文档：设备流不需要 client_secret）：
 * 1. POST /login/device/code  → 获取 device_code + user_code
 * 2. 用户访问 https://github.com/login/device 输入 user_code 授权
 * 3. 轮询 POST /login/oauth/access_token → 拿到 access_token
 *
 * 注意：两个请求都用 application/x-www-form-urlencoded（简单请求，不触发
 * CORS preflight——GitHub 不支持 OPTIONS 预检），并请求 JSON 响应。
 */

const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const DEVICE_VERIFY_URL = 'https://github.com/login/device';

export interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  /** 秒；device_code 过期时间 */
  expires_in: number;
  /** 秒；轮询间隔 */
  interval: number;
}

export type DeviceFlowPollResult =
  | { status: 'ok'; accessToken: string }
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'expired' }
  | { status: 'denied' };

/**
 * 提交表单请求。
 * 桌面版：优先走主进程 IPC（net.fetch）——github.com 设备流端点无 CORS 头，
 * 渲染进程直接 fetch 必然被浏览器拦截（"Failed to fetch"）。
 * Web 版：fallback 到浏览器 fetch（受 GitHub CORS 限制，可能失败）。
 */
async function postForm(url: string, body: Record<string, string>): Promise<Record<string, unknown>> {
  const bridge = typeof window !== 'undefined' ? window.acLedgerDesktop?.deviceFlow : undefined;
  if (bridge) {
    if (url === DEVICE_CODE_URL) {
      return (await bridge.requestDeviceCode(body.client_id ?? '', body.scope)) as Record<string, unknown>;
    }
    return (await bridge.pollAccessToken(body.client_id ?? '', body.device_code ?? '')) as Record<string, unknown>;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    // URLSearchParams → application/x-www-form-urlencoded（简单请求，无 preflight）
    body: new URLSearchParams(body),
  });
  if (!res.ok) {
    throw new Error(`GitHub 请求失败（HTTP ${res.status}）`);
  }
  return (await res.json()) as Record<string, unknown>;
}

/** 第一步：请求设备码 */
export async function requestDeviceCode(clientId: string, scope = 'repo'): Promise<DeviceCodeResponse> {
  const data = await postForm(DEVICE_CODE_URL, { client_id: clientId, scope });
  const deviceCode = data.device_code;
  const userCode = data.user_code;
  const verificationUri = data.verification_uri;
  if (typeof deviceCode !== 'string' || typeof userCode !== 'string' || typeof verificationUri !== 'string') {
    throw new Error(`设备码请求响应异常: ${JSON.stringify(data)}`);
  }
  return {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri,
    expires_in: Number(data.expires_in ?? 900),
    interval: Number(data.interval ?? 5),
  };
}

/** 第二步：轮询访问令牌 */
export async function pollAccessToken(clientId: string, deviceCode: string): Promise<DeviceFlowPollResult> {
  const data = await postForm(ACCESS_TOKEN_URL, {
    client_id: clientId,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });

  if (typeof data.access_token === 'string' && data.access_token) {
    return { status: 'ok', accessToken: data.access_token };
  }
  switch (data.error) {
    case 'authorization_pending':
      return { status: 'pending' };
    case 'slow_down':
      return { status: 'slow_down', interval: Number(data.interval ?? 5) + 5 };
    case 'expired_token':
      return { status: 'expired' };
    case 'access_denied':
      return { status: 'denied' };
    default:
      throw new Error(`轮询失败: ${JSON.stringify(data)}`);
  }
}

/** 授权页面地址 */
export function deviceVerifyUrl(): string {
  return DEVICE_VERIFY_URL;
}

export interface GitHubUser {
  login: string;
  name?: string;
}

const API_HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'ac-ledger',
});

/** 获取当前用户信息（用于一键连接：自动取用户名） */
export async function fetchGithubUser(token: string): Promise<GitHubUser> {
  const res = await fetch('https://api.github.com/user', { headers: API_HEADERS(token) });
  if (!res.ok) throw new Error(`获取 GitHub 用户失败（HTTP ${res.status}）`);
  return (await res.json()) as GitHubUser;
}

/**
 * 确保数据仓库存在：不存在则创建私有仓库。
 * 一键连接流程的一部分——用户无需手动建仓库。
 */
export async function ensureLedgerRepo(token: string, owner: string, repoName: string): Promise<void> {
  const check = await fetch(`https://api.github.com/repos/${owner}/${repoName}`, {
    headers: API_HEADERS(token),
  });
  if (check.ok) return; // 已存在
  if (check.status === 404) {
    const create = await fetch('https://api.github.com/user/repos', {
      method: 'POST',
      headers: { ...API_HEADERS(token), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: repoName, private: true, description: 'Ac记账 数据仓库' }),
    });
    if (!create.ok) throw new Error(`创建数据仓库失败（HTTP ${create.status}）`);
    return;
  }
  throw new Error(`检查数据仓库失败（HTTP ${check.status}）`);
}
