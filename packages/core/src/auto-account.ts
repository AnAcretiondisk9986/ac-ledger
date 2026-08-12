import type { Account, Transaction } from './types.js';

const PAYMENT_ALIASES: Array<[RegExp, string]> = [
  [/零钱通|零钱|微信支付|wechat/i, '微信'],
  [/支付宝|余额宝|alipay/i, '支付宝'],
];

function canonicalize(value: string): string {
  let text = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/储蓄卡|借记卡|信用卡|银行卡|账户|账号|支付/g, '')
    .replace(/[\s\-_·]/g, '');
  for (const [pattern, replacement] of PAYMENT_ALIASES) {
    if (pattern.test(text)) return replacement;
  }
  return text;
}

function bigrams(value: string): Set<string> {
  if (value.length < 2) return new Set(value ? [value] : []);
  return new Set(Array.from({ length: value.length - 1 }, (_, i) => value.slice(i, i + 2)));
}

/** 归一化名称后的 Dice 相似度；包含关系给予较高置信度。 */
export function accountNameSimilarity(paymentMethod: string, accountName: string): number {
  const hint = canonicalize(paymentMethod);
  const name = canonicalize(accountName);
  if (!hint || !name) return 0;
  if (hint === name) return 1;
  if (hint.includes(name) || name.includes(hint)) return 0.9;
  const a = bigrams(hint);
  const b = bigrams(name);
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap++;
  return (2 * overlap) / (a.size + b.size);
}

/** 返回最接近的账户；低于阈值时不猜测。 */
export function guessAccount(paymentMethod: string, accounts: Account[], threshold = 0.55): Account | null {
  let best: Account | null = null;
  let bestScore = threshold;
  for (const account of accounts) {
    const score = accountNameSimilarity(paymentMethod, account.name);
    if (score > bestScore || (score === bestScore && best === null)) {
      best = account;
      bestScore = score;
    }
  }
  return best;
}

/**
 * 为尚未指定账户的交易匹配账户。微信优先使用原始支付方式；
 * 支付宝账单没有扣款账户字段，因此按来源统一匹配支付宝账户。
 */
export function applyAutoAccount(transactions: Transaction[], accounts: Account[]): Transaction[] {
  return transactions.map((tx) => {
    if (tx.accountId) return tx;
    const hint = tx.paymentMethod || (tx.source === 'alipay' ? '支付宝' : '');
    if (!hint || hint === '/') return tx;
    const account = guessAccount(hint, accounts);
    return account ? { ...tx, accountId: account.id, updatedAt: new Date().toISOString() } : tx;
  });
}
