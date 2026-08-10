/**
 * 账单导入通用类型（微信 / 支付宝共用）。
 */
import { Transaction } from '@ac-ledger/core';

export interface BillParseOptions {
  /** 导入来源标识，默认按账单类型（"wechat" | "alipay"） */
  source?: string;
  /** 未分类时分配的 categoryId，默认 null */
  defaultCategoryId?: string | null;
}

/** 微信账单头部统计（用于导入校验） */
export interface WechatBillHeader {
  nickname: string;
  total: number;
  income: number;
  expense: number;
  neutral: number;
}

/** 支付宝尾部汇总 */
export interface AlipayBillSummary {
  incomeCount?: number;
  incomeAmount?: number;
  pendingIncomeCount?: number;
  pendingIncomeAmount?: number;
  paidCount?: number;
  paidAmount?: number;
  pendingCount?: number;
  pendingAmount?: number;
  exportTime?: string;
  user?: string;
}

export interface BillParseResult {
  transactions: Transaction[];
  /** 被跳过的行数（空行等） */
  skipped: number;
  /** 微信账单头部统计（仅微信解析结果携带） */
  header?: WechatBillHeader;
  /** 支付宝账单尾部汇总（仅支付宝解析结果携带） */
  summary?: AlipayBillSummary;
}

/** 兼容旧名（wechat-import 时代） */
export type WechatParseOptions = BillParseOptions;
export type WechatParseResult = BillParseResult;
