import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBill } from '../index.js';
import { mapAlipayStatus, mapAlipayType, parseAlipaySummary, splitAlipayRow } from '../alipay/parser.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/alipay-bill-sample.csv', import.meta.url));
const HAS_FIXTURE = existsSync(FIXTURE);

/** 构造小样本（GBK 字节）：覆盖 收入/支出/不计收支/退款/交易关闭 */
const GBK_SAMPLE = `支付宝交易记录明细查询
账号:[15267331998]
起始日期:[2026-01-01 00:00:00]    终止日期:[2026-01-31 23:59:59]
---------------------------------交易记录明细列表------------------------------------
交易号                  ,商家订单号               ,交易创建时间              ,付款时间                ,最近修改时间              ,交易来源地     ,类型              ,交易对方            ,商品名称                ,金额（元）   ,收/支     ,交易状态    ,服务费（元）   ,成功退款（元）  ,备注                  ,资金状态     ,
202601010001\t,ORDER-1\t,2026-01-01 10:00:00 ,2026-01-01 10:00:01 ,2026-01-01 10:00:01 ,淘宝        ,支付宝担保交易         ,淘宝商家            ,测试商品A               ,100.00  ,支出      ,交易成功    ,0.00     ,0.00     ,                    ,已支出      ,
202601010002\t,ORDER-2\t,2026-01-02 11:00:00 ,2026-01-02 11:00:01 ,2026-01-02 11:00:01 ,支付宝网站     ,即时到账交易          ,朋友                ,转账                   ,50.00   ,收入      ,交易成功    ,0.00     ,0.00     ,                    ,已收入      ,
202601010003\t,ORDER-3\t,2026-01-03 12:00:00 ,2026-01-03 12:00:01 ,2026-01-03 12:00:01 ,支付宝网站     ,即时到账交易          ,余额宝               ,余额宝-收益发放          ,0.03    ,不计收支   ,交易成功    ,0.00     ,0.00     ,                    ,已收入      ,
202601010004\t,ORDER-4\t,2026-01-04 13:00:00 ,2026-01-04 13:00:01 ,2026-01-04 13:00:01 ,支付宝网站     ,即时到账交易          ,淘宝商家            ,退款-测试商品A           ,100.00  ,支出      ,退款成功    ,0.00     ,100.00   ,                    ,已支出      ,
202601010005\t,ORDER-5\t,2026-01-05 14:00:00 ,2026-01-05 14:00:01 ,2026-01-05 14:00:01 ,支付宝网站     ,即时到账交易          ,淘宝商家            ,测试商品B               ,20.00   ,支出      ,交易关闭    ,0.00     ,0.00     ,                    ,已支出      ,
已支出:2笔,120.00元
待支出:0笔,0.00元
已收入:1笔,50.00元
待收入:0笔,0.00元
导出时间:[2026-08-10 12:27:03]    用户:黄映焜
`;

function gbkBytes(text: string): Uint8Array {
  // Node 无内置 GBK 编码器，用 iconv 逻辑替代：这里直接返回 UTF-8 字节（内容解析不依赖编码，编码测试在真实样本上验证）
  return new TextEncoder().encode(text);
}

describe('支付宝解析（构造样本）', () => {
  it('统一入口 parseBill 自动识别并解析', async () => {
    const result = await parseBill(gbkBytes(GBK_SAMPLE), 'alipay.csv');
    expect(result.transactions.length).toBe(5);
    const [t1, t2, t3, t4, t5] = result.transactions;

    expect(t1?.type).toBe('expense');
    expect(t1?.amount).toBe(100);
    expect(t1?.counterparty).toBe('淘宝商家');
    expect(t1?.refId).toBe('202601010001');
    expect(t1?.source).toBe('alipay');
    expect(t1?.status).toBe('completed');
    expect(t1?.date).toBe('2026-01-01T10:00:00+08:00');

    expect(t2?.type).toBe('income');
    expect(t2?.note).toBe('转账');

    expect(t3?.type).toBe('neutral'); // 不计收支
    expect(t3?.status).toBe('completed');

    expect(t4?.type).toBe('expense');
    expect(t4?.status).toBe('refunded'); // 退款成功

    expect(t5?.status).toBe('failed'); // 交易关闭

    // 尾部汇总
    expect(result.summary).toMatchObject({
      paidCount: 2,
      paidAmount: 120,
      pendingCount: 0,
      incomeCount: 1,
      incomeAmount: 50,
      user: '黄映焜',
    });
  });

  it('容错拆分：含逗号的商品名', () => {
    const line = 'T001\t,ORDER-1\t,2026-01-01 10:00:00 ,2026-01-01 10:00:01 ,2026-01-01 10:00:01 ,淘宝,即时到账交易,商家,商品,含,逗号,名字,10.00,支出,交易成功,0.00,0.00,,已支出,';
    const cells = splitAlipayRow(line);
    expect(cells.length).toBe(17); // 16 列 + 行尾逗号的空 cell
    expect(cells[8]).toBe('商品,含,逗号,名字');
    expect(cells[9]).toBe('10.00');
    expect(cells[15]).toBe('已支出');
  });

  it('状态映射单元', () => {
    expect(mapAlipayType('支出')).toBe('expense');
    expect(mapAlipayType('收入')).toBe('income');
    expect(mapAlipayType('不计收支')).toBe('neutral');
    expect(mapAlipayStatus('退款成功', '0')).toBe('refunded');
    expect(mapAlipayStatus('交易关闭', '0')).toBe('failed');
    expect(mapAlipayStatus('交易成功', '44.90')).toBe('partially_refunded');
  });

  it('汇总解析', () => {
    const s = parseAlipaySummary(['已收入:8笔,5728.00元', '待收入:0笔,0.00元', '已支出:455笔,13727.52元', '待支出:0笔,0.00元', '导出时间:[2026-08-10 12:27:03]    用户:黄映焜']);
    expect(s).toEqual({
      incomeCount: 8,
      incomeAmount: 5728,
      pendingIncomeCount: 0,
      pendingIncomeAmount: 0,
      paidCount: 455,
      paidAmount: 13727.52,
      pendingCount: 0,
      pendingAmount: 0,
      exportTime: '2026-08-10 12:27:03',
      user: '黄映焜',
    });
  });
});

describe.skipIf(!HAS_FIXTURE)('真实支付宝样本（611 笔，本地 fixture）', () => {
  it('解析统计与尾部汇总一致', async () => {
    const bytes = readFileSync(FIXTURE); // GBK 编码真实文件
    const result = await parseBill(bytes, 'alipay-bill-sample.csv');

    // 618 行 = 611 交易 + 7 行尾部汇总（分隔线/共N笔/收入/支出/导出时间）
    expect(result.transactions.length).toBe(611);
    expect(result.skipped).toBe(0);

    // 收支分布与文件统计吻合：支出455 / 收入8 / 不计收支148
    const income = result.transactions.filter((t) => t.type === 'income').length;
    const expense = result.transactions.filter((t) => t.type === 'expense').length;
    const neutral = result.transactions.filter((t) => t.type === 'neutral').length;
    expect(expense).toBe(455);
    expect(income).toBe(8);
    expect(neutral).toBe(148);

    // 尾部汇总：共611笔 / 已支出 455 笔 13727.52 元 / 已收入 8 笔 5728 元
    expect(result.summary?.paidCount).toBe(455);
    expect(result.summary?.paidAmount).toBe(13727.52);
    expect(result.summary?.incomeCount).toBe(8);
    expect(result.summary?.incomeAmount).toBe(5728);
    expect(result.summary?.user).toBe('黄映焜');

    // 状态覆盖：退款成功 → refunded；交易关闭 → failed；部分退款 → partially_refunded
    const statuses = new Set(result.transactions.map((t) => t.status));
    expect(statuses.has('refunded')).toBe(true);
    expect(statuses.has('failed')).toBe(true);
    expect(statuses.has('partially_refunded')).toBe(true);

    // 字段抽查：首条为驾校 400 元支出
    const first = result.transactions[0]!;
    expect(first.amount).toBe(400);
    expect(first.counterparty).toBe('义乌市恒风汽车驾驶员培训有限公司');
    expect(first.refId).toBe('2026080923001484981409007997');

    // refId 唯一（退款行交易号带后缀，天然不同）
    const refIds = result.transactions.map((t) => t.refId);
    expect(new Set(refIds).size).toBe(refIds.length);
  });
});
