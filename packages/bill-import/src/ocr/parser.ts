import { uuid, type Transaction, type TransactionType } from '@ac-ledger/core';
import type {
  OcrIssue,
  OcrTextLine,
  OcrTransactionCandidate,
  ParseOcrScreenshotOptions,
} from './types.js';

interface AmountAnchor {
  line: OcrTextLine;
  amount: number;
  sign: '' | '+' | '-';
  matchedText: string;
}

interface DateParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  inferred: boolean;
  missingTime: boolean;
}

const SUMMARY_RE = /总支出|总入账|支出\s*[¥￥Yf]?\s*[\d,.]+\s*收入|本月已省|累计已省|收支分析|出\s*[¥￥Yf]?\s*[\d,.]+\s*入/;
const CHROME_RE = /记账本|账单|全部类型|全部账单|查找交易|搜索交易|收支统计|我的消费图鉴|自动分类/;
const AMOUNT_RE = /([+\-−]?)\s*[¥￥Yf]?\s*(\d[\d,]*[.．]\d{1,2})/g;

function cleanText(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[−—–]/g, '-')
    .replace(/．/g, '.')
    .replace(/\s+/g, ' ')
    .replace(/\b(\d{1,2})\s*:\s*(\d)\s+(\d)\b/g, '$1:$2$3')
    .trim();
}

function centerY(line: OcrTextLine): number {
  return (line.bbox.y0 + line.bbox.y1) / 2;
}

function parseAmountMatches(text: string): Array<{ amount: number; sign: '' | '+' | '-'; matchedText: string }> {
  const matches: Array<{ amount: number; sign: '' | '+' | '-'; matchedText: string }> = [];
  for (const match of cleanText(text).matchAll(AMOUNT_RE)) {
    const amount = Number((match[2] ?? '').replace(/,/g, ''));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const rawSign = match[1] ?? '';
    matches.push({ amount, sign: rawSign === '-' ? '-' : rawSign === '+' ? '+' : '', matchedText: match[0] });
  }
  return matches;
}

function findContentTop(lines: OcrTextLine[], imageHeight: number): number {
  const monthSummary = lines.find((line) => /\d{4}年\s*\d{1,2}月/.test(cleanText(line.text)));
  const savingSummary = lines.find((line) => /本月已省/.test(cleanText(line.text)));
  if (savingSummary) return savingSummary.bbox.y1;
  if (monthSummary) return monthSummary.bbox.y1;
  return imageHeight * 0.2;
}

function amountAnchors(lines: OcrTextLine[], options: ParseOcrScreenshotOptions): AmountAnchor[] {
  const contentTop = findContentTop(lines, options.imageHeight);
  const candidates: AmountAnchor[] = [];

  for (const line of lines) {
    const text = cleanText(line.text);
    if (!text || line.bbox.y0 <= contentTop || SUMMARY_RE.test(text) || /^(?:出|入)\s*[¥￥Yf]?\s*[\d,.]+/.test(text)) continue;
    const matches = parseAmountMatches(text);
    if (matches.length === 0) continue;

    const rightAligned = line.bbox.x1 >= options.imageWidth * 0.72;
    const signed = matches.some((match) => match.sign !== '');
    if (options.platform === 'alipay' && !signed) continue;
    if (options.platform === 'wechat' && !rightAligned && !signed) continue;

    // 同一行可能同时含商品价和右侧流水金额，取最后一个带符号金额，否则取最后一个金额。
    const match = [...matches].reverse().find((item) => item.sign !== '') ?? matches[matches.length - 1];
    if (!match) continue;
    candidates.push({ line, ...match });
  }

  candidates.sort((a, b) => centerY(a.line) - centerY(b.line));
  return candidates.filter((candidate, index) => {
    const previous = candidates[index - 1];
    if (!previous) return true;
    return Math.abs(centerY(previous.line) - centerY(candidate.line)) > Math.max(8, options.imageHeight * 0.004);
  });
}

function isUsefulText(text: string): boolean {
  if (!text || text.length < 2 || CHROME_RE.test(text) || SUMMARY_RE.test(text)) return false;
  if (/^[<>@©CQYf\s]+$/i.test(text)) return false;
  return !/^\d{1,2}:\d{2}(?:\s+[六日一二三四五])?$/.test(text);
}

function stripAmount(text: string, matchedText: string): string {
  return cleanMerchant(text.replace(matchedText, '').replace(/[¥￥]\s*$/, ''));
}

function cleanMerchant(text: string): string {
  const cleaned = cleanText(text)
    .replace(/^[()（）|丨/\s]+/, '')
    .replace(/^口\s+(?=[A-Za-z0-9])/i, '')
    .replace(/^[A-Z0-9]\s+(?=[A-Z][A-Za-z])/i, '')
    .replace(/\s+[¥￥]?\d[\d,]*[.,]\d{2}\s*(?:CNY|RMB)$/i, '')
    .replace(/[\s_—-]+$/, '')
    .trim();
  const transactionStart = cleaned.search(/零钱提现|转账-|杭州深度求索/);
  return transactionStart > 0 ? cleaned.slice(transactionStart) : cleaned;
}

function pickMerchant(anchor: AmountAnchor, lines: OcrTextLine[], imageWidth: number): OcrTextLine | null {
  const rowHeight = Math.max(26, anchor.line.bbox.y1 - anchor.line.bbox.y0);
  const sameRow = lines
    .filter((line) => {
      const text = line === anchor.line ? stripAmount(line.text, anchor.matchedText) : cleanText(line.text);
      const dy = Math.abs(centerY(line) - centerY(anchor.line));
      return isUsefulText(text) && dy <= rowHeight * 1.25 && line.bbox.x0 < imageWidth * 0.82;
    })
    .sort((a, b) => {
      const aText = a === anchor.line ? stripAmount(a.text, anchor.matchedText) : cleanText(a.text);
      const bText = b === anchor.line ? stripAmount(b.text, anchor.matchedText) : cleanText(b.text);
      const aScore = aText.length * 4 - Math.abs(centerY(a) - centerY(anchor.line));
      const bScore = bText.length * 4 - Math.abs(centerY(b) - centerY(anchor.line));
      return bScore - aScore;
    });
  return sameRow[0] ?? null;
}

function referenceDateAt(reference: Date, deltaDays = 0): Date {
  const date = new Date(reference);
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + deltaDays);
  return date;
}

function findGlobalYearMonth(lines: OcrTextLine[], reference: Date): { year: number; month: number } {
  for (const line of lines) {
    const match = cleanText(line.text).match(/(20\d{2})年\s*(\d{1,2})月/);
    if (match) return { year: Number(match[1]), month: Number(match[2]) };
  }
  return { year: reference.getFullYear(), month: reference.getMonth() + 1 };
}

function parseDateLine(text: string, base: { year: number; month: number }, reference: Date): DateParts | null {
  const normalized = cleanText(text);
  const timeMatch = normalized.match(/(\d{1,2}):(\d{2})/);
  let date: Date | null = null;
  let inferred = false;

  const full = normalized.match(/(?:(20\d{2})年\s*)?(\d{1,2})月\s*(\d{1,2})(?:日)?/);
  if (full) {
    date = new Date(Number(full[1] ?? base.year), Number(full[2]) - 1, Number(full[3]), 12);
    inferred = !full[1];
  } else if (/今天/.test(normalized)) {
    date = referenceDateAt(reference);
    inferred = true;
  } else if (/昨天/.test(normalized)) {
    date = referenceDateAt(reference, -1);
    inferred = true;
  }

  if (!date && !timeMatch) return null;
  date ??= new Date(base.year, base.month - 1, reference.getDate(), 12);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: timeMatch ? Number(timeMatch[1]) : 12,
    minute: timeMatch ? Number(timeMatch[2]) : 0,
    inferred: inferred || !full,
    missingTime: !timeMatch,
  };
}

function dateForAnchor(
  anchor: AmountAnchor,
  next: AmountAnchor | undefined,
  lines: OcrTextLine[],
  options: ParseOcrScreenshotOptions
): DateParts {
  const global = findGlobalYearMonth(lines, options.referenceDate);
  const y = centerY(anchor.line);
  const nextY = next ? centerY(next.line) : options.imageHeight + 1;
  const isWechatBook = options.platform === 'wechat' && lines.some((line) => /记账本/.test(cleanText(line.text)));
  const before = [...lines]
    .filter((line) => centerY(line) < y)
    .sort((a, b) => centerY(b) - centerY(a));

  // 微信记账本按日期分组，标题只约束其下方流水，必须先向上寻找。
  if (isWechatBook) {
    for (const line of before) {
      const parsed = parseDateLine(line.text, global, options.referenceDate);
      if (parsed && /月|今天|昨天/.test(cleanText(line.text))) {
        const timeLine = lines
          .filter((candidate) => centerY(candidate) > y + 8 && centerY(candidate) < nextY - 8)
          .find((candidate) => /\d{1,2}:\d{2}/.test(cleanText(candidate.text)));
        const time = timeLine?.text.match(/(\d{1,2}):(\d{2})/);
        return time
          ? { ...parsed, hour: Number(time[1]), minute: Number(time[2]), missingTime: false }
          : { ...parsed, missingTime: true };
      }
    }
  }
  const after = lines
    .filter((line) => centerY(line) >= y - 12 && centerY(line) < nextY - 8)
    .sort((a, b) => centerY(a) - centerY(b));
  for (const line of after) {
    const parsed = parseDateLine(line.text, global, options.referenceDate);
    if (parsed) return parsed;
  }

  // 微信记账本按日期分组，日期标题位于流水之前，取最近一个明确的日期行。
  for (const line of before) {
    const parsed = parseDateLine(line.text, global, options.referenceDate);
    if (parsed && /月|今天|昨天/.test(cleanText(line.text))) return { ...parsed, missingTime: true };
  }

  return {
    year: global.year,
    month: global.month,
    day: options.referenceDate.getDate(),
    hour: 12,
    minute: 0,
    inferred: true,
    missingTime: true,
  };
}

function metadataForAnchor(
  anchor: AmountAnchor,
  next: AmountAnchor | undefined,
  lines: OcrTextLine[]
): OcrTextLine[] {
  const y = centerY(anchor.line);
  const nextY = next ? centerY(next.line) : Number.POSITIVE_INFINITY;
  return lines
    .filter((line) => centerY(line) > y + 8 && centerY(line) < nextY - 8)
    .filter((line) => isUsefulText(cleanText(line.text)))
    .sort((a, b) => centerY(a) - centerY(b));
}

function classifyType(sign: AmountAnchor['sign'], text: string): { type: TransactionType; ambiguous: boolean } {
  if (sign === '-') return { type: 'expense', ambiguous: false };
  if (sign === '+') return { type: 'income', ambiguous: false };
  if (/提现|转入银行卡|信用卡还款|零钱充值|余额宝转入|余额宝转出/.test(text)) {
    return { type: 'neutral', ambiguous: false };
  }
  if (/转账[-—]?来自|收款/.test(text)) return { type: 'income', ambiguous: false };
  if (/转账[-—]?(?:给|到)|付款/.test(text)) return { type: 'expense', ambiguous: false };
  return { type: 'expense', ambiguous: true };
}

function formatDate(parts: DateParts): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}:00+08:00`;
}

export function createOcrRefId(platform: string, tx: Pick<Transaction, 'date' | 'type' | 'amount' | 'counterparty'>): string {
  const normalizedParty = tx.counterparty.normalize('NFKC').toLowerCase().replace(/[\s·_\-—()（）]/g, '');
  const source = `${platform}|${tx.date.slice(0, 16)}|${tx.type}|${tx.amount.toFixed(2)}|${normalizedParty}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `ocr:${platform}:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function detailFromMetadata(metadata: OcrTextLine[]): string {
  const candidates: string[] = [];
  for (const line of metadata) {
    const text = cleanText(line.text)
      .replace(/(?:20\d{2}年\s*)?\d{1,2}月\s*\d{1,2}(?:日)?/g, '')
      .replace(/今天|昨天/g, '')
      .replace(/\d{1,2}:\d{2}/g, '')
      .replace(/^[|丨/\s:：-]+/, '')
      .trim();
    if (isUsefulText(text) && !/^(餐饮美食|教育培训|文化休闲|交通出行|生活服务|服务|其他)$/.test(text)) {
      candidates.push(text);
    }
  }
  return candidates.sort((a, b) => {
    const score = (value: string) =>
      (value.match(/[\u3400-\u9fff]/g)?.length ?? 0) * 5
      + value.length
      + (/零钱提现|转账-|杭州深度求索/.test(value) ? 100 : 0);
    return score(b) - score(a);
  })[0] ?? '';
}

export function parseOcrScreenshot(
  rawLines: OcrTextLine[],
  options: ParseOcrScreenshotOptions
): OcrTransactionCandidate[] {
  const lines = rawLines
    .map((line) => ({ ...line, text: cleanText(line.text) }))
    .filter((line) => line.text)
    .sort((a, b) => centerY(a) - centerY(b) || a.bbox.x0 - b.bbox.x0);
  const anchors = amountAnchors(lines, options);
  const isWechatBook = options.platform === 'wechat' && lines.some((line) => /记账本/.test(line.text));

  return anchors.map((anchor, index) => {
    const next = anchors[index + 1];
    const merchantLine = pickMerchant(anchor, lines, options.imageWidth);
    const metadata = metadataForAnchor(anchor, next, lines);
    const rawMerchant = merchantLine
      ? merchantLine === anchor.line
        ? stripAmount(merchantLine.text, anchor.matchedText)
        : cleanMerchant(merchantLine.text)
      : '';
    const detail = detailFromMetadata(metadata);
    const counterparty = isWechatBook && detail ? detail : rawMerchant;
    const noteParts = metadata
      .map((line) => cleanText(line.text))
      .filter((text) => !/^(?:今天|昨天)?\s*\d{1,2}:\d{2}$/.test(text));
    if (isWechatBook && rawMerchant && rawMerchant !== counterparty) noteParts.unshift(rawMerchant);
    const note = [...new Set(noteParts)].join(' | ');
    const date = dateForAnchor(anchor, next, lines, options);
    const classified = classifyType(anchor.sign, `${counterparty} ${note}`);
    const issues: OcrIssue[] = [];
    const confidence = Math.round(Math.min(anchor.line.confidence, merchantLine?.confidence ?? 0));
    const unclosedParenthesis = (counterparty.match(/\(/g)?.length ?? 0) !== (counterparty.match(/\)/g)?.length ?? 0);
    if (confidence < 75 || unclosedParenthesis || /\.\.\.|…/.test(counterparty)) issues.push('low-confidence');
    if (date.missingTime) issues.push('missing-time');
    else if (date.inferred) issues.push('inferred-date');
    if (classified.ambiguous) issues.push('ambiguous-type');
    if (!counterparty) issues.push('missing-counterparty');

    const now = new Date().toISOString();
    const transaction: Transaction = {
      id: uuid(),
      date: formatDate(date),
      type: classified.type,
      amount: Math.round(anchor.amount * 100) / 100,
      currency: 'CNY',
      categoryId: null,
      accountId: null,
      paymentMethod: options.platform === 'wechat' ? '微信' : '支付宝',
      counterparty,
      note,
      status: /退款成功|已退款/.test(note) ? 'refunded' : /交易关闭|失败/.test(note) ? 'failed' : 'completed',
      source: options.platform,
      createdAt: now,
      updatedAt: now,
    };
    transaction.refId = createOcrRefId(options.platform, transaction);

    return {
      transaction,
      confidence,
      issues: [...new Set(issues)],
      sourceName: options.sourceName,
      sourceY: Math.round(centerY(anchor.line)),
    };
  });
}
