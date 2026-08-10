import { describe, expect, it } from 'vitest';
import { buildCategoryTree, categoryDescendants, defaultCategories } from '../categories.js';

describe('categories', () => {
  it('生成默认分类', () => {
    const cats = defaultCategories();
    expect(cats.length).toBe(14); // 5 收入 + 9 支出
    expect(cats.filter((c) => c.kind === 'income').length).toBe(5);
    expect(cats.every((c, i) => c.sortOrder === i)).toBe(true);
  });

  it('构建分类树', () => {
    const cats = [
      ...defaultCategories(),
      { id: 'cat-100', name: '早餐', kind: 'expense' as const, parentId: 'cat-6', icon: '🥣', sortOrder: 0 },
      { id: 'cat-101', name: '正餐', kind: 'expense' as const, parentId: 'cat-6', icon: '🍚', sortOrder: 1 },
    ];
    const tree = buildCategoryTree(cats);
    const food = tree.find((c) => c.id === 'cat-6') as (typeof tree)[number] & { children?: unknown[] };
    expect(food?.children?.length).toBe(2);
  });

  it('后代集合', () => {
    const cats = [
      ...defaultCategories(),
      { id: 'cat-100', name: '早餐', kind: 'expense' as const, parentId: 'cat-6', icon: '', sortOrder: 0 },
      { id: 'cat-101', name: '包子', kind: 'expense' as const, parentId: 'cat-100', icon: '', sortOrder: 0 },
    ];
    expect(categoryDescendants(cats, 'cat-6').sort()).toEqual(['cat-100', 'cat-101', 'cat-6'].sort());
  });
});
