import { describe, expect, it, vi, afterEach } from 'vitest';
import { ensureLedgerRepo, fetchGithubUser, pollAccessToken, requestDeviceCode } from '../github-oauth.js';

function mockPost(status: number, body: Record<string, unknown>) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('GitHub 设备流', () => {
  it('请求设备码：form-urlencoded + JSON 响应', async () => {
    const fetchMock = mockPost(200, {
      device_code: 'dc-123',
      user_code: 'ABCD-EFGH',
      verification_uri: 'https://github.com/login/device',
      expires_in: 900,
      interval: 5,
    });
    vi.stubGlobal('fetch', fetchMock);

    const res = await requestDeviceCode('client-1', 'repo');
    expect(res.user_code).toBe('ABCD-EFGH');
    expect(res.interval).toBe(5);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://github.com/login/device/code');
    expect(init.method).toBe('POST');
    // 简单请求：不触发 CORS preflight
    expect(new Headers(init.headers).get('Accept')).toContain('application/json');
    expect(String(init.body)).toContain('client_id=client-1');
  });

  it('轮询成功返回 token', async () => {
    vi.stubGlobal('fetch', mockPost(200, { access_token: 'gho_xxx', token_type: 'bearer', scope: 'repo' }));
    const r = await pollAccessToken('client-1', 'dc-123');
    expect(r).toEqual({ status: 'ok', accessToken: 'gho_xxx' });
  });

  it('轮询各状态：pending / slow_down / expired / denied', async () => {
    vi.stubGlobal('fetch', mockPost(200, { error: 'authorization_pending' }));
    expect(await pollAccessToken('c', 'd')).toEqual({ status: 'pending' });

    vi.stubGlobal('fetch', mockPost(200, { error: 'slow_down', interval: 10 }));
    expect(await pollAccessToken('c', 'd')).toEqual({ status: 'slow_down', interval: 15 });

    vi.stubGlobal('fetch', mockPost(200, { error: 'expired_token' }));
    expect(await pollAccessToken('c', 'd')).toEqual({ status: 'expired' });

    vi.stubGlobal('fetch', mockPost(200, { error: 'access_denied' }));
    expect(await pollAccessToken('c', 'd')).toEqual({ status: 'denied' });
  });

  it('设备码响应异常抛错', async () => {
    vi.stubGlobal('fetch', mockPost(200, { foo: 'bar' }));
    await expect(requestDeviceCode('c')).rejects.toThrow('响应异常');
  });

  it('HTTP 错误抛错', async () => {
    vi.stubGlobal('fetch', mockPost(400, { error: 'bad_client' }));
    await expect(requestDeviceCode('c')).rejects.toThrow('HTTP 400');
  });
});

describe('GitHub 一键连接 API', () => {
  it('获取用户信息', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ login: 'testuser', name: '测试' }),
    } as Response);
    vi.stubGlobal('fetch', fetchMock);
    const user = await fetchGithubUser('gho_x');
    expect(user.login).toBe('testuser');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.github.com/user');
    expect(String(new Headers(init.headers).get('Authorization'))).toBe('Bearer gho_x');
  });

  it('仓库已存在则不创建', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as Response);
    vi.stubGlobal('fetch', fetchMock);
    await ensureLedgerRepo('gho_x', 'testuser', 'ac-ledger-data');
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  it('仓库不存在则创建私有仓库', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) } as Response)
      .mockResolvedValueOnce({ ok: true, status: 201, json: async () => ({}) } as Response);
    vi.stubGlobal('fetch', fetchMock);
    await ensureLedgerRepo('gho_x', 'testuser', 'ac-ledger-data');

    const createCall = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(createCall[0]).toBe('https://api.github.com/user/repos');
    expect(createCall[1]?.method).toBe('POST');
    expect(JSON.parse(String(createCall[1]?.body))).toMatchObject({ name: 'ac-ledger-data', private: true });
  });
});
