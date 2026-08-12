/**
 * 微信账单解析。兼容两种来源：
 * - 官方导出的 CSV（加密 zip 解压后）
 * - 手动保存的 xlsx（列结构一致）
 *
 * 文件结构（参考真实样本）：
 * R1  微信支付账单明细
 * R2  微信昵称：[xxx]
 * R3  起始时间：[...] 终止时间：[...]
 * R4  导出类型：[...]
 * R5  导出时间：[...]
 * R7  共 N 笔记录
 * R8  收入：x笔 y元
 * R9  支出：x笔 y元
 * R10 中性交易：x笔 y元
 * ...注释...
 * 表头行：交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注
 * 数据行...（缺失字段用 "/" 占位）
 */

import { Transaction, TransactionStatus, TransactionType, uuid } from '@ac-ledger/core';
import { BillParseOptions, BillParseResult, WechatBillHeader } from '../types.js';

export type { BillParseOptions as WechatParseOptions, BillParseResult as WechatParseResult };


/** 解析后的单条原始记录（字符串形式） */
export interface WechatRawRow {
  /** 交易时间 "2026-08-10 07:17:06" */
  time: string;
  type: string;
  counterparty: string;
  goods: string;
  /** 收入 / 支出 / / */
  inOut: string;
  /** 金额（字符串，可能来自 CSV 或 xlsx） */
  amount: string;
  payMethod: string;
  status: string;
  /** 交易单号（微信侧） */
  tradeNo: string;
  /** 商户单号 */
  merchantNo: string;
  remark: string;
}

export const WECHAT_HEADER_COLUMNS = [
  '交易时间',
  '交易类型',
  '交易对方',
  '商品',
  '收/支',
  '金额(元)',
  '支付方式',
  '当前状态',
  '交易单号',
  '商户单号',
  '备注',
] as const;

export function isWechatBillText(text: string): boolean {
  return text.includes('微信支付账单明细');
}

/** 将原始文本行（CSV 已拆列）转为 RawRow；空行返回 null */
export function rowFromCells(cells: string[]): WechatRawRow | null {
  if (!cells[0] || !cells[0].trim()) return null;
  const get = (i: number): string => (cells[i] ?? '').trim();
  return {
    time: get(0),
    type: get(1),
    counterparty: get(2),
    goods: get(3),
    inOut: get(4),
    amount: get(5),
    payMethod: get(6),
    status: get(7),
    tradeNo: get(8),
    merchantNo: get(9),
    remark: get(10),
  };
}

/** 解析头部统计信息（R1-R10 区域） */
export function parseHeader(metaLines: string[]): WechatBillHeader {
  const header: WechatBillHeader = {
    nickname: '',
    total: 0,
    income: 0,
    expense: 0,
    neutral: 0,
  };
  for (const line of metaLines) {
    const nickname = line.match(/微信昵称：\[(.*?)\]/);
    if (nickname) header.nickname = nickname[1] ?? '';
    const total = line.match(/共(\d+)笔记录/);
    if (total) header.total = Number(total[1]);
    const income = line.match(/收入：(\d+)笔/);
    if (income) header.income = Number(income[1]);
    const expense = line.match(/支出：(\d+)笔/);
    if (expense) header.expense = Number(expense[1]);
    const neutral = line.match(/中性交易：(\d+)笔/);
    if (neutral) header.neutral = Number(neutral[1]);
  }
  return header;
}

/** 状态文本 → TransactionStatus */
export function mapStatus(raw: string): TransactionStatus {
  if (/已全额退款/.test(raw)) return 'refunded';
  if (/^已退款/.test(raw)) return 'partially_refunded';
  if (/失败/.test(raw)) return 'failed';
  return 'completed';
}

/** 收/支 → TransactionType */
export function mapType(inOut: string): TransactionType {
  if (inOut === '收入') return 'income';
  if (inOut === '支出') return 'expense';
  return 'neutral';
}

/** 将原始行转为核心 Transaction */
export function rowToTransaction(row: WechatRawRow, opts: BillParseOptions): Transaction {
  const amount = parseFloat(row.amount);
  const time = row.time.replace(' ', 'T') + '+08:00'; // 账单时间为东八区
  const transactionType = mapType(row.inOut);
  const paymentMethod = row.payMethod !== '/'
    ? row.payMethod
    : transactionType === 'income' && /已存入零钱|已到账/.test(row.status)
      ? '微信'
      : undefined;
  return {
    id: uuid(),
    date: time,
    type: transactionType,
    amount: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0,
    currency: 'CNY',
    categoryId: opts.defaultCategoryId ?? null,
    accountId: null,
    paymentMethod,
    counterparty: row.counterparty === '/' ? '' : row.counterparty,
    note: buildNote(row),
    status: mapStatus(row.status),
    source: opts.source ?? 'wechat',
    refId: row.tradeNo === '/' ? undefined : row.tradeNo,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** 商品 + 备注合并为备注 */
function buildNote(row: WechatRawRow): string {
  const parts = [row.goods, row.remark].filter((p) => p && p !== '/');
  return parts.join(' | ');
}

/**
 * 核心解析：从「原始行数组」解析交易。
 * @param rows 已定位表头后的数据行
 */
export function parseWechatRows(rows: WechatRawRow[], opts: BillParseOptions = {}): BillParseResult {
  const transactions: Transaction[] = [];
  let skipped = 0;
  for (const row of rows) {
    if (!row.time) {
      skipped++;
      continue;
    }
    transactions.push(rowToTransaction(row, opts));
  }
  return { transactions, skipped };
}
