import { describe, expect, it } from 'vitest';
import { formatMoney, fromFen, parseAmount, round2, sumYuan, toFen } from '../money.js';

describe('money', () => {
  it('元分转换', () => {
    expect(toFen(10)).toBe(1000);
    expect(toFen(40.55)).toBe(4055);
    expect(fromFen(4055)).toBe(40.55);
  });

  it('四舍五入到分', () => {
    expect(round2(10.005)).toBe(10.01);
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it('浮点累加无误差', () => {
    expect(sumYuan([0.1, 0.2, 0.3])).toBe(0.6);
  });

  it('格式化金额', () => {
    expect(formatMoney(12345.678)).toBe('¥12,345.68');
    expect(formatMoney(-9.5)).toBe('-¥9.50');
    expect(formatMoney(26)).toBe('¥26.00');
  });

  it('解析金额', () => {
    expect(parseAmount('40.55')).toBe(40.55);
    expect(parseAmount('¥112.00')).toBe(112);
    expect(parseAmount('1,234.50')).toBe(1234.5);
    expect(parseAmount('已退款(¥0.85)')).toBe(0.85);
    expect(parseAmount('abc')).toBeNull();
  });
});
