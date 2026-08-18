import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MemoryAdapter } from '../memory.js';
import { createNodeLocalAdapter } from '../local-node.js';
import { LedgerSync } from '../sync.js';

const TX_FILE = 'transactions/2026-08.json';
const txFile = (transactions: unknown[]) =>
  JSON.stringify({ version: 1, month: '2026-08', transactions }, null, 2);

async function filled(files: Record<string, string>): Promise<MemoryAdapter> {
  const adapter = new MemoryAdapter();
  for (const [k, v] of Object.entries(files)) await adapter.writeFile(k, v);
  return adapter;
}

describe('LedgerSync', () => {
  it('pushAll：本地新增文件上传（远端无 → 不带 sha）', async () => {
    const remote = new MemoryAdapter();
    const local = await filled({ 'ledger.json': '{"v":1}' });
    const r = await new LedgerSync(remote, local).pushAll();
    expect(r.pushed).toEqual(['ledger.json']);
    expect(r.failed).toEqual([]);
    expect(await remote.readFile('ledger.json')).toBe('{"v":1}');
  });

  it('pushAll：sha 相同跳过，本地更新则带远端 sha 上传', async () => {
    const remote = await filled({ 'ledger.json': 'old', 'same.json': 'same' });
    const local = await filled({ 'ledger.json': 'new', 'same.json': 'same' });
    const r = await new LedgerSync(remote, local).pushAll();
    expect(r.pushed).toEqual(['ledger.json']);
    expect(r.failed).toEqual([]);
    expect(await remote.readFile('ledger.json')).toBe('new');
  });

  it('pushAll：远端被其他端修改时交易并集合并后上传', async () => {
    const remote = await filled({ [TX_FILE]: txFile([{ id: 'a', date: '2026-08-01T10:00:00+08:00', amount: 1 }]) });
    const local = await filled({ [TX_FILE]: txFile([{ id: 'b', date: '2026-08-02T10:00:00+08:00', amount: 2 }]) });
    const r = await new LedgerSync(remote, local).pushAll();
    expect(r.merged).toEqual([TX_FILE]);
    const remoteContent = await remote.readFile(TX_FILE);
    expect(remoteContent).toContain('"id": "a"');
    expect(remoteContent).toContain('"id": "b"');
    expect(await local.readFile(TX_FILE)).toBe(remoteContent);
  });

  it('syncAll：远端新增下载、本地新增上传', async () => {
    const remote = await filled({ 'accounts.json': '[]', [TX_FILE]: txFile([]) });
    const local = await filled({ 'categories.json': '{}' });
    const r = await new LedgerSync(remote, local).syncAll();
    expect(r.pulled.sort()).toEqual(['accounts.json', TX_FILE]);
    expect(r.pushed).toEqual(['categories.json']);
    expect(await local.readFile('accounts.json')).toBe('[]');
    expect(await remote.readFile('categories.json')).toBe('{}');
  });

  it('syncAll：交易并集合并写两端', async () => {
    const remote = await filled({ [TX_FILE]: txFile([{ id: 'r1', date: '2026-08-01T10:00:00+08:00', amount: 1 }]) });
    const local = await filled({
      [TX_FILE]: txFile([
        { id: 'l1', date: '2026-08-02T10:00:00+08:00', amount: 2 },
        { id: 'r1', date: '2026-08-01T10:00:00+08:00', amount: 1 },
      ]),
    });
    const r = await new LedgerSync(remote, local).syncAll();
    expect(r.merged).toEqual([TX_FILE]);
    const content = await remote.readFile(TX_FILE);
    expect(content).toContain('"id": "l1"');
    expect(content).toContain('"id": "r1"');
    expect(await local.readFile(TX_FILE)).toBe(content);
  });

  it('真实本地目录：启动合并且退出上传嵌套的交易文件', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'ac-ledger-sync-test-'));
    try {
      const remote = await filled({
        [TX_FILE]: txFile([{ id: 'remote', date: '2026-08-01T10:00:00+08:00', amount: 1 }]),
      });
      const local = createNodeLocalAdapter(dir);
      await local.writeFile(
        TX_FILE,
        txFile([{ id: 'local', date: '2026-08-02T10:00:00+08:00', amount: 2 }])
      );

      const startup = await new LedgerSync(remote, local).syncAll();
      expect(startup.merged).toEqual([TX_FILE]);
      expect(startup.pulled).toEqual([]);
      const afterStartup = await local.readFile(TX_FILE);
      expect(afterStartup).toContain('"id": "remote"');
      expect(afterStartup).toContain('"id": "local"');

      const localFile = JSON.parse(afterStartup!) as { transactions: unknown[] };
      await local.writeFile(
        TX_FILE,
        txFile([
          ...localFile.transactions,
          { id: 'local-after-start', date: '2026-08-03T10:00:00+08:00', amount: 3 },
        ])
      );

      const shutdown = await new LedgerSync(remote, local).pushAll();
      expect(shutdown.merged).toEqual([TX_FILE]);
      expect(await remote.readFile(TX_FILE)).toContain('"id": "local-after-start"');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('适配器漏报嵌套文件时二次探测，禁止远端直接覆盖本地', async () => {
    const remote = await filled({
      [TX_FILE]: txFile([{ id: 'remote', date: '2026-08-01T10:00:00+08:00', amount: 1 }]),
    });
    const local = await filled({
      [TX_FILE]: txFile([{ id: 'local', date: '2026-08-02T10:00:00+08:00', amount: 2 }]),
    });
    local.listFiles = async () => [];

    const result = await new LedgerSync(remote, local).syncAll();
    expect(result.merged).toEqual([TX_FILE]);
    expect(result.pulled).toEqual([]);
    expect(await local.readFile(TX_FILE)).toContain('"id": "local"');
    expect(await remote.readFile(TX_FILE)).toContain('"id": "local"');
  });

  it('交易文件损坏时保留本地现场，不用远端版本覆盖', async () => {
    const remote = await filled({
      [TX_FILE]: txFile([{ id: 'remote', date: '2026-08-01T10:00:00+08:00', amount: 1 }]),
    });
    const local = await filled({ [TX_FILE]: '{broken json' });

    const result = await new LedgerSync(remote, local).syncAll();
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.path).toBe(TX_FILE);
    expect(result.failed[0]?.error).toContain('已停止同步以避免数据被覆盖');
    expect(await local.readFile(TX_FILE)).toBe('{broken json');
    expect(await remote.readFile(TX_FILE)).toContain('"id": "remote"');
  });

  it('syncAll：配置取较新（远端提交时间晚 → 下载；本地晚 → 上传）', async () => {
    const base = Date.parse('2026-08-01T00:00:00Z');
    const remote = await filled({ 'settings.json': 'remote-version' });
    const local = await filled({ 'settings.json': 'local-version' });

    // 远端较新（远端提交 base+1000 > 本地修改 base+500）→ 下载
    local.mtimes.set('settings.json', base + 500);
    const r1 = await new LedgerSync(remote, local, new Map([['settings.json', base + 1000]])).syncAll();
    expect(r1.pulled).toEqual(['settings.json']);
    expect(await local.readFile('settings.json')).toBe('remote-version');

    // 本地较新（远端提交 base-1000 < 本地修改 base+500）→ 上传
    await local.writeFile('settings.json', 'local-version-2');
    local.mtimes.set('settings.json', base + 500);
    const r2 = await new LedgerSync(remote, local, new Map([['settings.json', base - 1000]])).syncAll();
    expect(r2.pushed).toEqual(['settings.json']);
    expect(await remote.readFile('settings.json')).toBe('local-version-2');
  });

  it('syncAll：无日期信息且内容不同时以本地为准（上传）', async () => {
    const remote = await filled({ 'settings.json': 'remote-version' });
    const local = await filled({ 'settings.json': 'local-version' });
    const r = await new LedgerSync(remote, local).syncAll();
    expect(r.pushed).toEqual(['settings.json']);
    expect(await remote.readFile('settings.json')).toBe('local-version');
  });

  it('两端一致时无操作', async () => {
    const content = '{"v":1}';
    const remote = await filled({ 'ledger.json': content });
    const local = await filled({ 'ledger.json': content });
    const r = await new LedgerSync(remote, local).syncAll();
    expect(r.pushed).toEqual([]);
    expect(r.pulled).toEqual([]);
    expect(r.merged).toEqual([]);
    expect(r.failed).toEqual([]);
  });
});
