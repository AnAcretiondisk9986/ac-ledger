import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNodeLocalAdapter } from '../local-node.js';
import { LedgerRepository } from '../repository.js';
import { StorageError } from '../types.js';
import type { Transaction } from '@ac-ledger/core';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'ac-ledger-test-'));
}

function tx(partial: Partial<Transaction> & { id: string; date: string; amount: number }): Transaction {
  return {
    type: 'expense',
    currency: 'CNY',
    categoryId: null,
    accountId: null,
    counterparty: '',
    note: '',
    status: 'completed',
    source: 'manual',
    createdAt: '',
    updatedAt: '',
    ...partial,
  };
}

describe('LocalAdapter', () => {
  it('读写/列目录/删除', async () => {
    const dir = makeTmp();
    const adapter = createNodeLocalAdapter(dir);
    await adapter.testConnection();
    await adapter.writeFile('ledger.json', '{"v":1}');
    expect(await adapter.readFile('ledger.json')).toBe('{"v":1}');
    expect(await adapter.readFile('nope.json')).toBeNull();

    await adapter.writeFile('transactions/2026-08.json', '[]');
    const files = await adapter.listFiles('transactions');
    expect(files).toEqual([{ path: '2026-08.json', size: 2, mtimeMs: expect.any(Number) }]);

    await adapter.deleteFile('ledger.json');
    expect(await adapter.readFile('ledger.json')).toBeNull();
    rmSync(dir, { recursive: true, force: true });
  });

  it('拒绝路径逃逸', async () => {
    const dir = makeTmp();
    const adapter = createNodeLocalAdapter(dir);
    await expect(adapter.readFile('../secret.txt')).rejects.toBeInstanceOf(StorageError);
    await expect(adapter.writeFile('a/../../b.json', 'x')).rejects.toBeInstanceOf(StorageError);
    rmSync(dir, { recursive: true, force: true });
  });

  it('与 LedgerRepository 集成：初始化 + 记账 + 持久化到磁盘', async () => {
    const dir = makeTmp();
    const adapter = createNodeLocalAdapter(dir);
    const repo = new LedgerRepository(adapter);

    await repo.initLedger({ name: '本地账本' });
    await repo.addTransactions([
      tx({ id: '1', date: '2026-08-01T10:00:00+08:00', amount: 12.34 }),
    ]);

    // 磁盘上真实存在文件
    expect(existsSync(join(dir, 'ledger.json'))).toBe(true);
    expect(existsSync(join(dir, 'transactions', '2026-08.json'))).toBe(true);

    // 重新打开（模拟重启）数据仍在
    const repo2 = new LedgerRepository(createNodeLocalAdapter(dir));
    expect((await repo2.getLedger())?.ledger.name).toBe('本地账本');
    const txs = await repo2.getMonthTransactions('2026-08');
    expect(txs[0]?.amount).toBe(12.34);
    expect(readFileSync(join(dir, 'transactions', '2026-08.json'), 'utf8')).toContain('12.34');

    rmSync(dir, { recursive: true, force: true });
  });
});
