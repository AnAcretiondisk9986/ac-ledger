import { describe, expect, it } from 'vitest';
import type { Category, Transaction } from '../types.js';
import { applyAutoCategory, guessCategoryName } from '../auto-category.js';
import { defaultCategories } from '../categories.js';

function tx(partial: Partial<Transaction> & { id: string; date: string; type: Transaction['type']; amount: number; counterparty: string }): Transaction {
  return {
    currency: 'CNY',
    categoryId: null,
    accountId: null,
    note: '',
    status: 'completed',
    source: 'manual',
    createdAt: '',
    updatedAt: '',
    ...partial,
  };
}

describe('自动分类', () => {
  it('按商户名猜支出分类（不区分大小写）', () => {
    expect(guessCategoryName('美团外卖订单', 'expense')).toBe('餐饮');
    expect(guessCategoryName('滴滴出行-快车', 'expense')).toBe('交通');
    expect(guessCategoryName('淘宝-天猫超市', 'expense')).toBe('购物');
    expect(guessCategoryName('中国移动-话费充值', 'expense')).toBe('其他');
    expect(guessCategoryName('某医院挂号费', 'expense')).toBe('医疗');
    expect(guessCategoryName('STEAM GAMES', 'expense')).toBe('娱乐');
  });

  it('按商户名猜收入分类', () => {
    expect(guessCategoryName('某某公司工资代发', 'income')).toBe('工资');
    expect(guessCategoryName('余额宝收益', 'income')).toBe('理财');
    expect(guessCategoryName('微信红包', 'income')).toBe('红包');
    expect(guessCategoryName('劳务报酬', 'income')).toBe('兼职');
  });

  it('未命中返回 null，转账/中性不参与', () => {
    expect(guessCategoryName('随便一个名字', 'expense')).toBeNull();
    expect(guessCategoryName('美团外卖', 'transfer')).toBeNull();
    expect(guessCategoryName('美团外卖', 'neutral')).toBeNull();
  });

  it('批量应用：只填未分类的收支交易', () => {
    const cats: Category[] = defaultCategories();
    const list = [
      tx({ id: '1', date: '2026-08-01T10:00:00+08:00', type: 'expense', amount: 20, counterparty: '美团外卖' }),
      tx({ id: '2', date: '2026-08-02T10:00:00+08:00', type: 'income', amount: 5000, counterparty: '某某公司' }),
      tx({ id: '3', date: '2026-08-03T10:00:00+08:00', type: 'expense', amount: 10, counterparty: '无规则商户' }),
      tx({ id: '4', date: '2026-08-04T10:00:00+08:00', type: 'transfer', amount: 100, counterparty: '美团外卖' }),
      tx({ id: '5', date: '2026-08-05T10:00:00+08:00', type: 'expense', amount: 30, counterparty: '滴滴出行', categoryId: 'cat-2' }),
    ];
    const out = applyAutoCategory(list, cats);
    expect(out[0]!.categoryId).toBe(cats.find((c) => c.name === '餐饮')!.id);
    expect(out[1]!.categoryId).toBe(cats.find((c) => c.name === '工资')!.id);
    expect(out[2]!.categoryId).toBeNull();
    expect(out[3]!.categoryId).toBeNull(); // 转账不参与
    expect(out[4]!.categoryId).toBe('cat-2'); // 已分类不动
    // 入参不被修改
    expect(list[0]!.categoryId).toBeNull();
  });

  it('分类被重命名/删除时保持未分类', () => {
    const cats: Category[] = defaultCategories().filter((c) => c.name !== '餐饮');
    const out = applyAutoCategory(
      [tx({ id: '1', date: '2026-08-01T10:00:00+08:00', type: 'expense', amount: 20, counterparty: '美团外卖' })],
      cats
    );
    expect(out[0]!.categoryId).toBeNull();
  });

  it('自定义规则优先于内置规则', () => {
    const cats: Category[] = defaultCategories();
    // 自定义：把「美团外卖」改归到「娱乐」
    const custom = { expense: [{ category: '娱乐', keywords: ['美团外卖'] }] };
    expect(guessCategoryName('美团外卖订单', 'expense', custom)).toBe('娱乐');
    // 自定义未命中时仍走内置规则
    expect(guessCategoryName('滴滴出行', 'expense', custom)).toBe('交通');
    // 自定义收入规则只影响收入
    expect(guessCategoryName('美团外卖', 'income', custom)).toBeNull();

    const out = applyAutoCategory(
      [tx({ id: '1', date: '2026-08-01T10:00:00+08:00', type: 'expense', amount: 20, counterparty: '美团外卖' })],
      cats,
      custom
    );
    expect(out[0]!.categoryId).toBe(cats.find((c) => c.name === '娱乐')!.id);
  });
});
