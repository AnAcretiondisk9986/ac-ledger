import { describe, expect, it } from 'vitest';
import type { Transaction } from '../types.js';
import { counterpartyBreakdown, currentMonth, monthKey, monthlySeries, nextMonth, summarize } from '../stats.js';

function tx(partial: Partial<Transaction> & { id: string; date: string; type: Transaction['type']; amount: number }): Transaction {
  return {
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

describe('stats', () => {
  it('收支汇总', () => {
    const s = summarize([
      tx({ id: '1', date: '2026-08-01T10:00:00+08:00', type: 'income', amount: 100 }),
      tx({ id: '2', date: '2026-08-02T10:00:00+08:00', type: 'expense', amount: 30.5 }),
      tx({ id: '3', date: '2026-08-03T10:00:00+08:00', type: 'expense', amount: 9.5 }),
      tx({ id: '4', date: '2026-08-04T10:00:00+08:00', type: 'transfer', amount: 500 }),
      tx({ id: '5', date: '2026-08-05T10:00:00+08:00', type: 'neutral', amount: 200 }),
    ]);
    expect(s.income).toBe(100);
    expect(s.expense).toBe(40);
    expect(s.balance).toBe(60);
    expect(s.transfer).toBe(500);
    expect(s.neutral).toBe(200);
    expect(s.count).toBe(5);
  });

  it('月份键与递增', () => {
    expect(monthKey('2026-08-10T07:17:06+08:00')).toBe('2026-08');
    expect(nextMonth('2026-12')).toBe('2027-01');
    expect(nextMonth('2026-08')).toBe('2026-09');
    expect(currentMonth()).toMatch(/^\d{4}-\d{2}$/);
  });

  it('月度序列补全空月', () => {
    const series = monthlySeries(
      [
        tx({ id: '1', date: '2026-08-01T10:00:00+08:00', type: 'income', amount: 100 }),
        tx({ id: '2', date: '2026-09-15T10:00:00+08:00', type: 'expense', amount: 50 }),
      ],
      '2026-08',
      '2026-10'
    );
    expect(series).toEqual([
      { month: '2026-08', income: 100, expense: 0 },
      { month: '2026-09', income: 0, expense: 50 },
      { month: '2026-10', income: 0, expense: 0 },
    ]);
  });

  it('商户聚合按金额降序', () => {
    const rows = counterpartyBreakdown(
      [
        tx({ id: '1', date: '2026-08-01T10:00:00+08:00', type: 'expense', amount: 10, counterparty: '便利店' }),
        tx({ id: '2', date: '2026-08-02T10:00:00+08:00', type: 'expense', amount: 99.5, counterparty: '超市' }),
        tx({ id: '3', date: '2026-08-03T10:00:00+08:00', type: 'expense', amount: 20, counterparty: '便利店' }),
        tx({ id: '4', date: '2026-08-04T10:00:00+08:00', type: 'income', amount: 5000, counterparty: '公司' }),
        tx({ id: '5', date: '2026-08-05T10:00:00+08:00', type: 'expense', amount: 0.5, counterparty: '  ' }),
      ],
      'expense'
    );
    expect(rows).toEqual([
      { name: '超市', count: 1, amount: 99.5 },
      { name: '便利店', count: 2, amount: 30 },
      { name: '（无对方）', count: 1, amount: 0.5 },
    ]);
  });
});
