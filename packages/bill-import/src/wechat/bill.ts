import { WechatParseOptions, WechatParseResult, WechatRawRow, isWechatBillText, parseHeader, parseWechatRows, rowFromCells } from './parser.js';
import { decodeCsvBytes, parseCsv, stripBom } from '../csv.js';
import { readXlsxRows } from '../xlsx-reader.js';

/** 文件类型 */
export type WechatBillFormat = 'csv' | 'xlsx';

export function detectFormat(filename?: string, head?: string): WechatBillFormat {
  if (filename) {
    const lower = filename.toLowerCase();
    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx';
    if (lower.endsWith('.csv') || lower.endsWith('.txt')) return 'csv';
  }
  return (head?.includes(',') ?? false) ? 'csv' : 'xlsx';
}

export interface ParseBillOptions extends WechatParseOptions {
  /** 严格校验头部统计笔数与实际数据行数，默认 true */
  verifyCount?: boolean;
}

/**
 * 解析微信账单文件。
 * @param data 文件内容（CSV 文本或 xlsx 二进制）
 * @param filename 文件名（用于判断格式）
 */
export async function parseWechatBill(
  data: string | Uint8Array | ArrayBuffer,
  filename?: string,
  opts: ParseBillOptions = {}
): Promise<WechatParseResult> {
  const verifyCount = opts.verifyCount ?? true;

  let textRows: string[][];
  if (typeof data === 'string') {
    textRows = parseCsv(stripBom(data));
  } else {
    const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    const format = detectFormat(filename);
    if (format === 'xlsx') {
      textRows = await readXlsxRows(bytes);
    } else {
      textRows = parseCsv(stripBom(decodeCsvBytes(bytes)));
    }
  }

  return parseWechatTextRows(textRows, { ...opts, verifyCount });
}

/** 从二维字符串数组解析（表头定位 + 数据行转换 + 头部统计校验） */
export function parseWechatTextRows(
  textRows: string[][],
  opts: ParseBillOptions = {}
): WechatParseResult {
  const verifyCount = opts.verifyCount ?? true;

  // 表头定位：找包含「交易时间」的行
  let headerIdx = -1;
  for (let i = 0; i < textRows.length; i++) {
    const cells = textRows[i] ?? [];
    if (cells.some((c) => c.includes('交易时间'))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    throw new Error('未找到账单表头（缺少「交易时间」列），请确认是微信账单导出文件');
  }

  // 头部区域（表头之前）解析统计信息
  const metaLines = textRows.slice(0, headerIdx).map((r) => r.join(' '));
  if (!isWechatBillText(metaLines.join('\n'))) {
    // 宽容：不强制校验标题，但保留统计解析
  }
  const header = parseHeader(metaLines);

  const rawRows: WechatRawRow[] = [];
  for (let i = headerIdx + 1; i < textRows.length; i++) {
    const row = rowFromCells(textRows[i] ?? []);
    if (row) rawRows.push(row);
  }

  const result = parseWechatRows(rawRows, opts);

  if (verifyCount && header && header.total > 0 && result.transactions.length !== header.total) {
    throw new Error(
      `账单校验失败：头部声明 ${header.total} 笔，实际解析 ${result.transactions.length} 笔，文件可能不完整`
    );
  }

  return { ...result, header };
}
