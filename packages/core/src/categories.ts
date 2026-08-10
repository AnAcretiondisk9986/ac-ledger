import type { Category, Transaction, TransactionType } from './types.js';

/** 默认支出分类 */
export const DEFAULT_EXPENSE_CATEGORIES: Omit<Category, 'id' | 'sortOrder'>[] = [
  { name: '餐饮', kind: 'expense', parentId: null, icon: '🍜' },
  { name: '交通', kind: 'expense', parentId: null, icon: '🚌' },
  { name: '购物', kind: 'expense', parentId: null, icon: '🛍️' },
  { name: '居住', kind: 'expense', parentId: null, icon: '🏠' },
  { name: '娱乐', kind: 'expense', parentId: null, icon: '🎮' },
  { name: '医疗', kind: 'expense', parentId: null, icon: '💊' },
  { name: '教育', kind: 'expense', parentId: null, icon: '📚' },
  { name: '人情', kind: 'expense', parentId: null, icon: '🧧' },
  { name: '其他', kind: 'expense', parentId: null, icon: '📦' },
];

/** 默认收入分类 */
export const DEFAULT_INCOME_CATEGORIES: Omit<Category, 'id' | 'sortOrder'>[] = [
  { name: '工资', kind: 'income', parentId: null, icon: '💰' },
  { name: '理财', kind: 'income', parentId: null, icon: '📈' },
  { name: '红包', kind: 'income', parentId: null, icon: '🧧' },
  { name: '兼职', kind: 'income', parentId: null, icon: '💼' },
  { name: '其他', kind: 'income', parentId: null, icon: '📦' },
];

/** 生成默认分类列表（带 ID） */
export function defaultCategories(): Category[] {
  const cats: Category[] = [];
  let order = 0;
  for (const c of [...DEFAULT_INCOME_CATEGORIES, ...DEFAULT_EXPENSE_CATEGORIES]) {
    cats.push({
      ...c,
      id: `cat-${order + 1}`,
      sortOrder: order,
    });
    order++;
  }
  return cats;
}

/** 把扁平分类列表构造成树 */
export function buildCategoryTree(categories: Category[]): Category[] {
  const map = new Map<string, Category>();
  const roots: Category[] = [];
  for (const c of categories) map.set(c.id, c);
  for (const c of categories) {
    if (c.parentId && map.has(c.parentId)) {
      // 子分类
      const parent = map.get(c.parentId)!;
      (parent as Category & { children?: Category[] }).children ??= [];
      (parent as Category & { children: Category[] }).children.push(c);
    } else {
      roots.push(c);
    }
  }
  const sort = (list: Category[]) => {
    list.sort((a, b) => a.sortOrder - b.sortOrder);
    for (const item of list) {
      const withChildren = item as Category & { children?: Category[] };
      if (withChildren.children) sort(withChildren.children);
    }
  };
  sort(roots);
  return roots;
}

/** 获取某分类的所有后代 ID（含自身） */
export function categoryDescendants(categories: Category[], id: string): string[] {
  const result: string[] = [id];
  for (const c of categories) {
    if (c.parentId === id) result.push(...categoryDescendants(categories, c.id));
  }
  return result;
}

/** 按交易类型给出默认分类候选 kind */
export function categoryKindFor(type: TransactionType): 'income' | 'expense' | null {
  switch (type) {
    case 'income':
      return 'income';
    case 'expense':
      return 'expense';
    default:
      return null;
  }
}

/** 校验交易金额/方向的一致性：金额必须为正数 */
export function validateTransaction(tx: Transaction): string[] {
  const errors: string[] = [];
  if (!tx.id) errors.push('id 不能为空');
  if (!Number.isFinite(tx.amount) || tx.amount <= 0) errors.push('amount 必须为正数');
  if (tx.type === 'transfer' || tx.type === 'neutral') {
    // 转账/中性交易不参与收支统计，方向由分类/账户表达
  }
  return errors;
}
