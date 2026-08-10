import { describe, expect, it, vi } from 'vitest';
import { GitHubAdapter } from '../github.js';
import { StorageAuthError, StorageConflictError, StorageNotFoundError } from '../types.js';

function mockFetchOnce(status: number, body: unknown) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

function makeAdapter() {
  return new GitHubAdapter({
    owner: 'test-owner',
    repo: 'test-repo',
    token: 'ghp_test',
    branch: 'main',
    basePath: 'data',
  });
}

describe('GitHubAdapter', () => {
  it('读取文件：base64 解码 + basePath 拼接', async () => {
    const fetchMock = mockFetchOnce(200, {
      content: Buffer.from('{"hello":"世界"}', 'utf8').toString('base64'),
      sha: 'abc123',
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = makeAdapter();
    const content = await adapter.readFile('ledger.json');

    expect(content).toBe('{"hello":"世界"}');
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain('/repos/test-owner/test-repo/contents/data/ledger.json');
    expect(fetchMock.mock.calls[0]?.[1]?.headers.Authorization).toBe('Bearer ghp_test');
  });

  it('文件不存在返回 null', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(404, { message: 'Not Found' }));
    const adapter = makeAdapter();
    expect(await adapter.readFile('nope.json')).toBeNull();
  });

  it('写入文件：PUT 带 base64 内容与 sha', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchOnce(200, { content: {}, sha: 'old-sha' }) // 第一次 GET 查询当前 sha
    );
    const putMock = mockFetchOnce(200, { content: {}, sha: 'new-sha' });
    vi.stubGlobal('fetch', putMock);
    putMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ content: {}, sha: 'old-sha' }),
    } as Response);

    const adapter = makeAdapter();
    await adapter.writeFile('accounts.json', '[]');

    const putCall = putMock.mock.calls.find((c) => c[1]?.method === 'PUT')!;
    const body = JSON.parse(putCall[1].body as string);
    expect(body.content).toBe(Buffer.from('[]', 'utf8').toString('base64'));
    expect(body.branch).toBe('main');
    expect(body.sha).toBe('old-sha');
  });

  it('写入命中 sha 缓存时不再查询 GET', async () => {
    const fetchMock = vi
      .fn()
      // readFile：GET 返回内容 + sha（同时填充缓存）
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ content: Buffer.from('[]', 'utf8').toString('base64'), sha: 'cached-sha' }),
      } as Response)
      // writeFile：应只发 PUT（sha 用缓存），PUT 成功返回新 sha
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ content: { sha: 'new-sha' } }),
      } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = makeAdapter();
    await adapter.readFile('accounts.json');
    await adapter.writeFile('accounts.json', '[]');

    const methods = fetchMock.mock.calls.map((c) => (c[1]?.method as string) ?? 'GET');
    expect(methods).toEqual(['GET', 'PUT']);
    const putBody = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    expect(putBody.sha).toBe('cached-sha');

    // 第二次写入：缓存已更新为 new-sha，仍然只有 PUT
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ content: { sha: 'newer-sha' } }),
    } as Response);
    await adapter.writeFile('accounts.json', '[1]');
    const methods2 = fetchMock.mock.calls.slice(2).map((c) => (c[1]?.method as string) ?? 'GET');
    expect(methods2).toEqual(['PUT']);
    const putBody2 = JSON.parse(fetchMock.mock.calls[2]![1]!.body as string);
    expect(putBody2.sha).toBe('new-sha');
  });

  it('getCommitDates：从 commits API 提取文件最后提交时间（含 basePath 剥离）', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        {
          commit: { committer: { date: '2026-08-01T10:00:00Z' } },
          files: [{ filename: 'data/ledger.json' }, { filename: 'data/transactions/2026-08.json' }],
        },
        {
          commit: { committer: { date: '2026-07-01T10:00:00Z' } },
          files: [{ filename: 'data/ledger.json' }],
        },
      ],
    } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = makeAdapter(); // basePath: 'data'
    const dates = await adapter.getCommitDates();
    // 最新提交时间胜出；路径剥离 basePath
    expect(dates.get('ledger.json')).toBe(Date.parse('2026-08-01T10:00:00Z'));
    expect(dates.get('transactions/2026-08.json')).toBe(Date.parse('2026-08-01T10:00:00Z'));
    const url = fetchMock.mock.calls[0]?.[0] as string;
    expect(url).toContain('/commits?sha=main&per_page=50');
  });

  it('写入冲突抛 StorageConflictError', async () => {
    // 第一次调用（GET 查当前 sha）成功，第二次调用（PUT）返回 409
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ content: '', sha: 'remote-sha' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ message: 'sha mismatch' }),
      } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = makeAdapter();
    await expect(adapter.writeFile('a.json', 'x')).rejects.toBeInstanceOf(StorageConflictError);
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe('PUT');
  });

  it('认证失败抛 StorageAuthError', async () => {
    vi.stubGlobal('fetch', mockFetchOnce(401, { message: 'Bad credentials' }));
    const adapter = makeAdapter();
    await expect(adapter.testConnection()).rejects.toBeInstanceOf(StorageAuthError);
  });

  it('列目录过滤 basePath 前缀', async () => {
    const tree = {
      tree: [
        { path: 'data/ledger.json', sha: 's1', type: 'blob' },
        { path: 'data/transactions/2026-08.json', sha: 's2', type: 'blob' },
        { path: 'other/x.txt', sha: 's3', type: 'blob' },
      ],
      truncated: false,
    };
    vi.stubGlobal('fetch', mockFetchOnce(200, tree));
    const adapter = makeAdapter();
    const files = await adapter.listFiles('transactions');
    expect(files).toEqual([{ path: '2026-08.json', sha: 's2', size: undefined }]);
  });

  it('空仓库首次写入不携带尚不存在的分支', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ default_branch: 'main', size: 0 }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 409,
        json: async () => ({ message: 'Git Repository is empty.' }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ content: {}, commit: {} }),
      } as Response);
    vi.stubGlobal('fetch', fetchMock);

    const adapter = makeAdapter();
    await adapter.testConnection();
    expect(await adapter.readFile('ledger.json')).toBeNull();
    await adapter.writeFile('ledger.json', '{}');

    const body = JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string);
    expect(body.branch).toBeUndefined();
  });
});
