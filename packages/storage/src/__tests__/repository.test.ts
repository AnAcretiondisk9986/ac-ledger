import { describe, expect, it } from 'vitest';
import { MemoryAdapter } from '../memory.js';
import { LedgerRepository } from '../repository.js';
import type { Transaction } from '@ac-ledger/core';

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

describe('LedgerRepository', () => {
  it('初始化账本与默认分类', async () => {
    const adapter = new MemoryAdapter();
    const repo = new LedgerRepository(adapter);
    const ledger = await repo.initLedger({ name: '我的账本' });
    expect(ledger.ledger.name).toBe('我的账本');
    expect(ledger.ledger.currency).toBe('CNY');

    const cats = await repo.getCategories();
    expect(cats.length).toBe(14);
    // 幂等：再次 init 返回同一账本
    const again = await repo.initLedger({ name: '另一个' });
    expect(again.ledger.id).toBe(ledger.ledger.id);
    expect(await adapter.readFile('accounts.json')).toContain('"accounts": []');
  });

  it('修复只有 ledger.json 的半初始化仓库', async () => {
    const adapter = new MemoryAdapter();
    const repo = new LedgerRepository(adapter);
    await adapter.writeFile('ledger.json', JSON.stringify({
      version: 1,
      ledger: { id: 'ledger-existing', name: '旧账本', currency: 'CNY', createdAt: '', updatedAt: '' },
    }));
    const ledger = await repo.initLedger({ name: '不应覆盖' });
    expect(ledger.ledger.id).toBe('ledger-existing');
    expect((await repo.getCategories()).length).toBe(14);
    expect(await adapter.readFile('accounts.json')).toContain('"accounts": []');
  });

  it('按 id/refId 去重写入', async () => {
    const adapter = new MemoryAdapter();
    const repo = new LedgerRepository(adapter);
    await repo.initLedger({ name: 't' });

    const a = tx({ id: '1', refId: 'wx-001', date: '2026-08-01T10:00:00+08:00', amount: 10 });
    const b = tx({ id: '2', refId: 'wx-002', date: '2026-08-02T10:00:00+08:00', amount: 20 });
    const dup1 = tx({ id: '3', refId: 'wx-001', date: '2026-08-03T10:00:00+08:00', amount: 30 });
    const dup2 = { ...a };

    const r1 = await repo.addTransactions([a, b, dup1, dup2]);
    expect(r1).toEqual({ added: 2, skipped: 2 });

    const month = await repo.getMonthTransactions('2026-08');
    expect(month.length).toBe(2);
  });

  it('跨月分片与范围查询', async () => {
    const adapter = new MemoryAdapter();
    const repo = new LedgerRepository(adapter);
    await repo.initLedger({ name: 't' });

    await repo.addTransactions([
      tx({ id: '1', date: '2026-07-15T10:00:00+08:00', amount: 1 }),
      tx({ id: '2', date: '2026-08-15T10:00:00+08:00', amount: 2 }),
      tx({ id: '3', date: '2026-09-15T10:00:00+08:00', amount: 3 }),
    ]);

    expect(await repo.listMonths()).toEqual(['2026-07', '2026-08', '2026-09']);
    expect((await repo.getTransactions('2026-08', '2026-08')).map((t) => t.id)).toEqual(['2']);
    expect((await repo.getTransactions('2026-08')).length).toBe(2);
  });

  it('更新与删除', async () => {
    const adapter = new MemoryAdapter();
    const repo = new LedgerRepository(adapter);
    await repo.initLedger({ name: 't' });

    const a = tx({ id: '1', date: '2026-08-01T10:00:00+08:00', amount: 10 });
    await repo.addTransaction(a);
    await repo.updateTransaction({ ...a, amount: 99, categoryId: 'cat-6' });

    let month = await repo.getMonthTransactions('2026-08');
    expect(month[0]?.amount).toBe(99);
    expect(month[0]?.categoryId).toBe('cat-6');

    await repo.removeTransaction('1');
    month = await repo.getMonthTransactions('2026-08');
    expect(month.length).toBe(0);
  });

  it('账户保存与读取', async () => {
    const adapter = new MemoryAdapter();
    const repo = new LedgerRepository(adapter);
    await repo.initLedger({ name: 't' });
    await repo.saveAccounts([
      { id: 'acc-1', name: '零钱', type: 'ewallet', currency: 'CNY', createdAt: '' },
      { id: 'acc-2', name: '招商银行', type: 'bank', currency: 'CNY', createdAt: '' },
    ]);
    const accounts = await repo.getAccounts();
    expect(accounts.length).toBe(2);
    expect(accounts[1]?.name).toBe('招商银行');
  });
});
