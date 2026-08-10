import { describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../memory.js';
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
