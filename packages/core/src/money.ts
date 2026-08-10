/**
 * 金额工具。记账金额以「元」为单位的 number 存储，内部运算统一转「分」（整数）避免浮点误差。
 */

/** 元 → 分（四舍五入到整数分） */
export function toFen(yuan: number): number {
  return Math.round(yuan * 100);
}

/** 分 → 元 */
export function fromFen(fen: number): number {
  return fen / 100;
}

/** 四舍五入到分 */
export function round2(yuan: number): number {
  return Math.round(yuan * 100) / 100;
}

/** 金额相加（以分为单位累加，避免浮点误差），返回元 */
export function sumYuan(values: number[]): number {
  return values.reduce((acc, v) => acc + toFen(v), 0) / 100;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  CNY: '¥',
  USD: '$',
  EUR: '€',
  JPY: '¥',
  HKD: 'HK$',
};

/** 格式化金额：千分位 + 两位小数 + 货币符号，如 ¥12,345.67 */
export function formatMoney(yuan: number, currency = 'CNY'): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? '';
  const sign = yuan < 0 ? '-' : '';
  const abs = Math.abs(round2(yuan));
  const [int, dec] = abs.toFixed(2).split('.');
  const grouped = (int ?? '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}${symbol}${grouped}.${dec}`;
}

/** 解析金额字符串（可能含货币符号、千分位、全角字符、尾部退款括号），失败返回 null */
export function parseAmount(input: string): number | null {
  const cleaned = input.replace(/[¥￥$€£\s,，]/g, '');
  // 提取字符串尾部的金额数字，容忍尾部右括号（如 "已退款(0.85)"）
  const m = cleaned.match(/([-+]?\d+(?:\.\d{1,2})?)[)）]?$/);
  if (!m) return null;
  return round2(parseFloat(m[1] ?? ''));
}
