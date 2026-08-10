import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseBill, parseWechatBill, parseWechatTextRows } from '../index.js';
import { parseCsv } from '../csv.js';

const FIXTURE = fileURLToPath(new URL('./fixtures/wechat-bill-sample.xlsx', import.meta.url));
const HAS_FIXTURE = existsSync(FIXTURE);

/** 构造小 CSV 样本（覆盖：收入/支出/中性/退款/全角状态） */
const CSV_SAMPLE = `微信支付账单明细
微信昵称：[测试用户]
起始时间：[2026-01-01 00:00:00] 终止时间：[2026-02-01 00:00:00]
导出类型：[全部]
导出时间：[2026-02-01 00:00:00]
共4笔记录
收入：1笔 100.00元
支出：2笔 18.00元
中性交易：1笔 500.00元
注：
1. 充值/提现/理财通购买/零钱通存取/信用卡还款等交易，将计入中性交易
2. 本明细仅供个人对账使用

交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注
2026-01-15 10:00:00,转账,张三,转账备注:红包,收入,100,零钱,已存入零钱,1000050001202601150000000000001,/,/
2026-01-16 11:30:00,商户消费,超市,购物消费,支出,9,零钱,支付成功,4200003153202601160000000000002,0000000000000001,/
2026-01-17 12:00:00,零钱充值,/,/,/,500,招商银行储蓄卡(1234),充值完成,2072601170000000000000000003,/,/
2026-01-18 13:00:00,商户消费-退款,超市,退款,支出,9,零钱,已退款(¥9.00),4200003153202601180000000000004,0000000000000002,/
`;

describe('微信账单 CSV 解析', () => {
  it('解析完整文件：类型/状态/中性/退款', async () => {
    const result = await parseWechatBill(CSV_SAMPLE, 'wechat.csv');
    expect(result.transactions.length).toBe(4); // 与头部声明一致
    const [t1, t2, t3] = result.transactions;

    expect(t1?.type).toBe('income');
    expect(t1?.amount).toBe(100);
    expect(t1?.counterparty).toBe('张三');
    expect(t1?.status).toBe('completed');
    expect(t1?.refId).toBe('1000050001202601150000000000001');
    expect(t1?.date).toBe('2026-01-15T10:00:00+08:00');

    expect(t2?.type).toBe('expense');
    expect(t2?.amount).toBe(9);

    expect(t3?.type).toBe('neutral');
    expect(t3?.status).toBe('completed');

    expect(result.header).toMatchObject({ nickname: '测试用户', total: 4, income: 1, expense: 2, neutral: 1 });
  });

  it('状态映射：退款两种写法', async () => {
    const rows = parseCsv(CSV_SAMPLE);
    const result = parseWechatTextRows(rows, { verifyCount: false });
    const refund = result.transactions.find((t) => t.refId?.endsWith('0004'));
    expect(refund?.status).toBe('partially_refunded');
    expect(refund?.type).toBe('expense');
    expect(refund?.note).toContain('退款');
  });

  it('校验失败：笔数不符抛错', async () => {
    const bad = CSV_SAMPLE.replace('共4笔记录', '共99笔记录');
    await expect(parseWechatBill(bad, 'wechat.csv')).rejects.toThrow('账单校验失败');
  });

  it('非账单文件报错', async () => {
    await expect(parseWechatBill('a,b\n1,2', 'x.csv')).rejects.toThrow('未找到账单表头');
  });
});

describe.skipIf(!HAS_FIXTURE)('真实 xlsx 样本（983 笔，本地 fixture）', () => {
  it('解析笔数、统计与头部一致', async () => {
    const bytes = readFileSync(FIXTURE);
    const result = await parseWechatBill(bytes, 'wechat-bill-sample.xlsx');
    expect(result.header?.total).toBe(983);
    expect(result.transactions.length).toBe(983);
    expect(result.header?.income).toBe(167);
    expect(result.header?.expense).toBe(797);

    const income = result.transactions.filter((t) => t.type === 'income').length;
    const expense = result.transactions.filter((t) => t.type === 'expense').length;
    const neutral = result.transactions.filter((t) => t.type === 'neutral').length;
    expect(income).toBe(167);
    expect(expense).toBe(797);
    expect(neutral).toBe(19);

    // 抽查字段映射
    const first = result.transactions[0]!;
    expect(first.counterparty).toBe('。。');
    expect(first.amount).toBe(10);
    expect(first.source).toBe('wechat');
    expect(first.currency).toBe('CNY');

    // 退款状态存在两种写法
    const statuses = new Set(result.transactions.map((t) => t.status));
    expect(statuses.has('partially_refunded')).toBe(true);
    expect(statuses.has('refunded')).toBe(true);

    // refId 全部唯一（微信交易单号不重复）
    const refIds = result.transactions.map((t) => t.refId);
    expect(new Set(refIds).size).toBe(refIds.length);
  });

});

describe('微信 xlsx 统一入口', () => {
  it('接收 xlsx 字节并转给微信解析器', async () => {
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Sheet1').addRows([
      ['微信支付账单明细'],
      ['共1笔记录'],
      ['交易时间', '交易类型', '交易对方', '商品', '收/支', '金额(元)', '支付方式', '当前状态', '交易单号', '商户单号', '备注'],
      ['2026-08-10 10:00:00', '商户消费', '测试商户', '测试', '支出', '1.23', '零钱', '支付成功', 'xlsx-test-1', '/', '/'],
    ]);
    const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
    const result = await parseBill(bytes, 'wechat.xlsx');
    expect(result.transactions).toHaveLength(1);
    expect(result.transactions[0]?.amount).toBe(1.23);
  });
});
