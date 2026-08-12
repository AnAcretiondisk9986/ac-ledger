import type { Transaction } from '@ac-ledger/core';

export type OcrBillPlatform = 'wechat' | 'alipay';

export interface OcrBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
/** OCR 引擎返回的一行文字及其在原图中的位置。 */
export interface OcrTextLine {
  text: string;
  confidence: number;
  bbox: OcrBox;
}

export type OcrIssue =
  | 'low-confidence'
  | 'missing-time'
  | 'inferred-date'
  | 'ambiguous-type'
  | 'missing-counterparty';

export interface OcrTransactionCandidate {
  transaction: Transaction;
  confidence: number;
  issues: OcrIssue[];
  sourceName: string;
  /** 金额锚点纵坐标，主要用于测试与排查版式。 */
  sourceY: number;
}

export interface ParseOcrScreenshotOptions {
  platform: OcrBillPlatform;
  sourceName: string;
  imageWidth: number;
  imageHeight: number;
  /** 用于解释「今天/昨天」和缺少年份的日期，通常取图片最后修改时间。 */
  referenceDate: Date;
}
