/**
 * 账单导入统一入口：自动识别微信 / 支付宝账单。
 */
import { BillParseOptions, BillParseResult } from './types.js';
import { decodeCsvBytes, parseCsv, stripBom } from './csv.js';
import { readXlsxRows } from './xlsx-reader.js';
import { parseAlipayRows, parseAlipaySummary, rowFromAlipayCells } from './alipay/parser.js';
import { parseWechatBill, parseWechatTextRows } from './wechat/bill.js';

export type {
  BillParseOptions,
  BillParseResult,
  WechatBillHeader,
  AlipayBillSummary,
  WechatParseOptions,
  WechatParseResult,
} from './types.js';
export * from './csv.js';
export * from './wechat/index.js';
export * from './alipay/parser.js';

export type BillKind = 'wechat' | 'alipay' | 'xlsx';

export interface ParseBillFileOptions extends BillParseOptions {
  /** 强制指定账单类型；不指定时按内容自动识别 */
  kind?: BillKind;
  /** 严格校验统计笔数（微信），默认 true */
  verifyCount?: boolean;
}

/** 从文件内容识别账单类型 */
export function detectBillKind(text: string, filename?: string): 'wechat' | 'alipay' | 'xlsx' {
  if (filename && /\.(xlsx|xls)$/i.test(filename)) return 'xlsx';
  if (text.includes('微信支付账单明细')) return 'wechat';
  if (text.includes('支付宝交易记录明细查询') || text.includes('交易记录明细列表')) return 'alipay';
  // 表头特征：交易号 + 交易创建时间 + 资金状态
  if (text.includes('交易号') && text.includes('交易创建时间') && text.includes('资金状态')) return 'alipay';
  if (text.includes('交易时间') && text.includes('交易单号')) return 'wechat';
  throw new Error('无法识别账单类型（非微信/支付宝导出文件）');
}

/**
 * 解析账单文件（微信 CSV/xlsx、支付宝 CSV）。
 * @param data 文件内容（文本或二进制）
 * @param filename 文件名（用于格式判断）
 */
export async function parseBill(
  data: string | Uint8Array | ArrayBuffer,
  filename?: string,
  opts: ParseBillFileOptions = {}
): Promise<BillParseResult> {
  if (typeof data !== 'string') {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    // xlsx 是 ZIP 二进制，不能先解码成文本；直接交给 ExcelJS 读取工作表。
    const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
    if (opts.kind === 'xlsx' || (filename && /\.(xlsx|xls)$/i.test(filename)) || isZip) {
      return parseWechatBill(bytes, filename, opts);
    }
    // 先尝试 UTF-8（微信）；含替换符时按 GBK（支付宝）解码
    const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    const text = utf8.includes('\uFFFD') ? decodeCsvBytes(bytes) : utf8;
    return parseBillText(text, filename, opts);
  }
  return parseBillText(stripBom(data), filename, opts);
}

/** 解析账单文本（CSV 内容） */
export function parseBillText(text: string, filename?: string, opts: ParseBillFileOptions = {}): BillParseResult {
  if (opts.kind === 'xlsx' || detectBillKind(text, filename) === 'xlsx') {
    throw new Error('xlsx 请使用 parseBill 并传入文件字节');
  }
  const kind = opts.kind ?? detectBillKind(text, filename);
  const rows = parseCsv(stripBom(text));

  if (kind === 'wechat') {
    return parseWechatTextRows(rows, { ...opts, verifyCount: opts.verifyCount ?? true });
  }

  // 支付宝：定位表头行（「交易号」与「交易创建时间」在不同列）
  let headerIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    const hasTradeNo = cells.some((c) => c.includes('交易号'));
    const hasCreateTime = cells.some((c) => c.includes('交易创建时间'));
    if (hasTradeNo && hasCreateTime) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) throw new Error('未找到支付宝账单表头（缺少「交易号」列）');

  const rawRows = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const raw = rowFromAlipayCells(rows[i] ?? []);
    if (raw) rawRows.push(raw);
  }
  const result = parseAlipayRows(rawRows, opts);

  // 尾部汇总（从原始文本行解析——汇总行含逗号，不能经过 parseCsv 拆分再 join）
  const summary = parseAlipaySummary(
    text
      .split(/\r?\n/)
      .filter((l) => /笔|导出时间|用户:/.test(l))
  );

  return { ...result, summary };
}

/** 便捷：微信 xlsx 入口（字节输入） */
export { parseWechatBill } from './wechat/bill.js';

/** 便捷：xlsx → 字符串行（供微信解析） */
export { readXlsxRows } from './xlsx-reader.js';
