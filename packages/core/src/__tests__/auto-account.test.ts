import { describe, expect, it } from 'vitest';
import type { Account, Transaction } from '../types.js';
import { accountNameSimilarity, applyAutoAccount, guessAccount } from '../auto-account.js';

const accounts: Account[] = [
  { id: 'wechat', name: '微信', type: 'ewallet', currency: 'CNY', createdAt: '' },
  { id: 'cmb', name: '招商银行', type: 'bank', currency: 'CNY', createdAt: '' },
  { id: 'icbc', name: '（温医大）工商银行', type: 'bank', currency: 'CNY', createdAt: '' },
  { id: 'alipay', name: '支付宝（含余额宝）', type: 'ewallet', currency: 'CNY', createdAt: '' },
];

function tx(partial: Partial<Transaction>): Transaction {
  return {
    id: '1', date: '2026-01-01T10:00:00+08:00', type: 'expense', amount: 10,
    currency: 'CNY', categoryId: null, accountId: null, counterparty: '', note: '',
    status: 'completed', source: 'wechat', createdAt: '', updatedAt: '', ...partial,
  };
}

describe('账户自动匹配', () => {
  it('忽略银行卡类型、尾号和账户名前缀', () => {
    expect(guessAccount('招商银行储蓄卡(8278)', accounts)?.id).toBe('cmb');
    expect(guessAccount('工商银行储蓄卡(7634)', accounts)?.id).toBe('icbc');
    expect(accountNameSimilarity('工商银行储蓄卡(7634)', '（温医大）工商银行')).toBeGreaterThan(0.55);
  });

  it('把支付产品别名匹配到电子钱包账户', () => {
    expect(guessAccount('零钱', accounts)?.id).toBe('wechat');
    expect(guessAccount('余额宝', accounts)?.id).toBe('alipay');
  });

  it('微信按支付方式、支付宝按来源匹配，且不覆盖已有账户', () => {
    const out = applyAutoAccount([
      tx({ id: 'wx', paymentMethod: '招商银行储蓄卡(8278)' }),
      tx({ id: 'ali', source: 'alipay' }),
      tx({ id: 'keep', accountId: 'wechat', paymentMethod: '招商银行储蓄卡(8278)' }),
      tx({ id: 'unknown', paymentMethod: '/' }),
    ], accounts);
    expect(out.map((item) => item.accountId)).toEqual(['cmb', 'alipay', 'wechat', null]);
  });
});
