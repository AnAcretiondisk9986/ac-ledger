import { describe, expect, it } from 'vitest';
import { createOcrRefId, parseOcrScreenshot, type OcrTextLine } from '../index.js';

function line(text: string, x0: number, y0: number, x1: number, y1: number, confidence = 92): OcrTextLine {
  return { text, confidence, bbox: { x0, y0, x1, y1 } };
}

const referenceDate = new Date('2026-08-12T12:53:00+08:00');

describe('截图账单 OCR 版式解析', () => {
  it('解析微信记账本的日期分组、提现和支出', () => {
    const result = parseOcrScreenshot([
      line('记账本', 310, 45, 403, 75),
      line('2026年8月', 46, 215, 200, 239),
      line('总支出￥2986.11 总入账￥2239.60', 226, 216, 611, 240),
      line('8月12日 今天', 45, 335, 205, 361),
      line('出 20.00', 465, 339, 561, 360),
      line('服务', 137, 458, 189, 483),
      line('12:46 | 杭州深度求索', 137, 500, 360, 526),
      line('-20.00', 595, 460, 685, 482),
      line('其他', 137, 595, 189, 619),
      line('12:45 | 零钱提现-到中国银行(4080)', 137, 635, 450, 660),
      line('20.02', 612, 596, 685, 618),
    ], {
      platform: 'wechat', sourceName: 'p1.png', imageWidth: 729, imageHeight: 1111, referenceDate,
    });

    expect(result).toHaveLength(2);
    expect(result[0]?.transaction).toMatchObject({
      counterparty: '杭州深度求索', amount: 20, type: 'expense', date: '2026-08-12T12:46:00+08:00',
    });
    expect(result[1]?.transaction).toMatchObject({
      counterparty: '零钱提现-到中国银行(4080)', amount: 20.02, type: 'neutral', date: '2026-08-12T12:45:00+08:00',
    });
  });

  it('解析微信账单列表并在截图缺少时间时标记问题', () => {
    const result = parseOcrScreenshot([
      line('账单', 552, 212, 649, 259),
      line('2026年8月', 51, 568, 355, 614),
      line('支出￥2986.11 收入￥2239.60', 622, 572, 1155, 610),
      line('杭州深度求索', 242, 740, 538, 786),
      line('-20.00', 1001, 745, 1155, 783),
      line('零钱提现-到中国银行(4080)', 242, 980, 883, 1030),
      line('20.02', 1031, 985, 1155, 1023),
      line('转账-来自陈禹翱', 242, 1700, 613, 1747),
      line('+374.20', 978, 1705, 1155, 1743),
    ], {
      platform: 'wechat', sourceName: 'p2.jpg', imageWidth: 1200, imageHeight: 2600, referenceDate,
    });

    expect(result.map((item) => [item.transaction.counterparty, item.transaction.type, item.transaction.amount])).toEqual([
      ['杭州深度求索', 'expense', 20],
      ['零钱提现-到中国银行(4080)', 'neutral', 20.02],
      ['转账-来自陈禹翱', 'income', 374.2],
    ]);
    expect(result.every((item) => item.issues.includes('missing-time'))).toBe(true);
  });

  it('解析支付宝列表中的相对日期、分类与自动扣款状态', () => {
    const result = parseOcrScreenshot([
      line('本月已省 0.00元', 92, 802, 433, 840),
      line('ToolCode 20.00 CNY', 214, 977, 595, 1020),
      line('-20.00', 978, 979, 1125, 1019),
      line('教育培训', 214, 1063, 363, 1098),
      line('今天 12:45', 214, 1140, 386, 1174),
      line('连续包月(夸克网盘SVIP会员)', 215, 2290, 772, 2332),
      line('-19.90', 986, 2292, 1125, 2332),
      line('文化休闲', 215, 2375, 363, 2410),
      line('自动扣款成功', 906, 2378, 1125, 2413),
      line('昨天 05:05', 215, 2452, 386, 2486),
    ], {
      platform: 'alipay', sourceName: 'p3.jpg', imageWidth: 1200, imageHeight: 2600, referenceDate,
    });

    expect(result).toHaveLength(2);
    expect(result[0]?.transaction).toMatchObject({
      counterparty: 'ToolCode', amount: 20, type: 'expense', date: '2026-08-12T12:45:00+08:00',
    });
    expect(result[1]?.transaction).toMatchObject({
      counterparty: '连续包月(夸克网盘SVIP会员)', amount: 19.9, date: '2026-08-11T05:05:00+08:00',
    });
    expect(result[1]?.transaction.note).toContain('自动扣款成功');
  });

  it('相同核心字段产生稳定指纹，编辑金额后指纹改变', () => {
    const transaction = {
      date: '2026-08-12T12:45:00+08:00',
      type: 'expense' as const,
      amount: 20,
      counterparty: '杭州深度求索',
    };
    expect(createOcrRefId('wechat', transaction)).toBe(createOcrRefId('wechat', { ...transaction }));
    expect(createOcrRefId('wechat', transaction)).not.toBe(createOcrRefId('wechat', { ...transaction, amount: 20.01 }));
  });
});
