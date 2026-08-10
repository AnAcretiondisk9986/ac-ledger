import { useMemo, useState } from 'react';
import { Card, Row, Col, Statistic, Select, Empty, Table, Typography } from 'antd';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import {
  counterpartyBreakdown,
  currentMonth,
  formatMoney,
  monthKey,
  monthlySeries,
  summarize,
  categoryBreakdown,
  yearOf,
} from '@ac-ledger/core';
import { useStore } from '../store';

const PIE_COLORS = ['#1677ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2', '#eb2f96', '#fa8c16', '#a0d911'];

export default function StatsPage() {
  const transactions = useStore((s) => s.transactions);
  const categories = useStore((s) => s.categories);
  const months = useStore((s) => s.months);

  const [month, setMonth] = useState<string | undefined>();
  const current = month ?? currentMonth();
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const monthTx = useMemo(() => transactions.filter((t) => monthKey(t.date) === current), [transactions, current]);
  const summary = useMemo(() => summarize(monthTx), [monthTx]);

  const rangeFrom = months.length > 0 ? months[0]! : current;
  const rangeTo = months.length > 0 ? months[months.length - 1]! : current;
  const series = useMemo(
    () => monthlySeries(transactions, rangeFrom, rangeTo),
    [transactions, rangeFrom, rangeTo]
  );

  const expenseBreakdown = useMemo(() => {
    const map = categoryBreakdown(monthTx, 'expense');
    return [...map.entries()]
      .map(([catId, amount]) => ({
        name: catId === 'uncategorized' ? '未分类' : (catMap.get(catId)?.name ?? '未分类'),
        value: Math.round(amount * 100) / 100,
      }))
      .sort((a, b) => b.value - a.value);
  }, [monthTx, catMap]);

  // —— 年度统计 ——
  const years = useMemo(
    () => [...new Set(transactions.map((t) => yearOf(t.date)))].sort((a, b) => b - a),
    [transactions]
  );
  const [year, setYear] = useState<number | undefined>();
  const currentYear = year ?? years[0];
  const yearTx = useMemo(
    () => transactions.filter((t) => yearOf(t.date) === currentYear),
    [transactions, currentYear]
  );
  const yearSummary = useMemo(() => summarize(yearTx), [yearTx]);

  // —— 支出商户统计 ——
  const merchants = useMemo(() => counterpartyBreakdown(transactions, 'expense'), [transactions]);
  const totalExpense = useMemo(() => summarize(transactions).expense, [transactions]);

  // —— 全账单收支统计 ——
  const allSummary = useMemo(() => summarize(transactions), [transactions]);

  return (
    <div>
      <Card
        title="月度统计"
        extra={
          <Select
            style={{ width: 140 }}
            value={month}
            allowClear
            placeholder="选择月份"
            onChange={setMonth}
            options={[...months].reverse().map((m) => ({ value: m, label: m }))}
          />
        }
      >
        <Row gutter={16}>
          <Col span={6}>
            <Statistic title="收入" value={summary.income} precision={2} prefix="¥" valueStyle={{ color: '#52c41a' }} />
          </Col>
          <Col span={6}>
            <Statistic title="支出" value={summary.expense} precision={2} prefix="¥" valueStyle={{ color: '#f5222d' }} />
          </Col>
          <Col span={6}>
            <Statistic
              title="结余"
              value={summary.balance}
              precision={2}
              prefix="¥"
              valueStyle={{ color: summary.balance >= 0 ? '#1677ff' : '#f5222d' }}
            />
          </Col>
          <Col span={6}>
            <Statistic title="笔数" value={summary.count} />
          </Col>
        </Row>
      </Card>

      <Card title="年度统计" style={{ marginTop: 16 }} extra={
        <Select
          style={{ width: 140 }}
          value={year}
          allowClear
          placeholder="选择年份"
          onChange={setYear}
          options={years.map((y) => ({ value: y, label: `${y}年` }))}
        />
      }>
        {years.length === 0 ? (
          <Empty description="暂无数据" />
        ) : (
          <Row gutter={16}>
            <Col span={6}>
              <Statistic title="收入" value={yearSummary.income} precision={2} prefix="¥" valueStyle={{ color: '#52c41a' }} />
            </Col>
            <Col span={6}>
              <Statistic title="支出" value={yearSummary.expense} precision={2} prefix="¥" valueStyle={{ color: '#f5222d' }} />
            </Col>
            <Col span={6}>
              <Statistic
                title="结余"
                value={yearSummary.balance}
                precision={2}
                prefix="¥"
                valueStyle={{ color: yearSummary.balance >= 0 ? '#1677ff' : '#f5222d' }}
              />
            </Col>
            <Col span={6}>
              <Statistic title="笔数" value={yearSummary.count} />
            </Col>
          </Row>
        )}
      </Card>

      <Card title="支出商户统计" style={{ marginTop: 16 }}>
        {merchants.length === 0 ? (
          <Empty description="暂无支出记录" />
        ) : (
          <Table
            rowKey="name"
            size="small"
            dataSource={merchants}
            pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 个商户` }}
            columns={[
              {
                title: '排名',
                width: 70,
                render: (_: unknown, __: (typeof merchants)[number], index: number) => index + 1,
              },
              { title: '商户', dataIndex: 'name', ellipsis: true },
              { title: '笔数', dataIndex: 'count', width: 90, align: 'right' as const },
              {
                title: '金额',
                dataIndex: 'amount',
                width: 140,
                align: 'right' as const,
                render: (v: number) => <b>{formatMoney(v)}</b>,
              },
              {
                title: '占比',
                width: 120,
                align: 'right' as const,
                render: (_: unknown, r: (typeof merchants)[number]) =>
                  totalExpense > 0 ? `${((r.amount / totalExpense) * 100).toFixed(1)}%` : '-',
              },
            ]}
          />
        )}
      </Card>

      <Card title="全账单收支统计" style={{ marginTop: 16 }}>
        {allSummary.count === 0 ? (
          <Empty description="暂无数据" />
        ) : (
          <>
            <Row gutter={16}>
              <Col span={6}>
                <Statistic title="收入" value={allSummary.income} precision={2} prefix="¥" valueStyle={{ color: '#52c41a' }} />
              </Col>
              <Col span={6}>
                <Statistic title="支出" value={allSummary.expense} precision={2} prefix="¥" valueStyle={{ color: '#f5222d' }} />
              </Col>
              <Col span={6}>
                <Statistic
                  title="结余"
                  value={allSummary.balance}
                  precision={2}
                  prefix="¥"
                  valueStyle={{ color: allSummary.balance >= 0 ? '#1677ff' : '#f5222d' }}
                />
              </Col>
              <Col span={6}>
                <Statistic title="笔数" value={allSummary.count} />
              </Col>
            </Row>
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
              统计范围：全部账单（含转账 {formatMoney(allSummary.transfer)}、中性 {formatMoney(allSummary.neutral)}）
            </Typography.Text>
          </>
        )}
      </Card>

      <Card title="收支趋势" style={{ marginTop: 16 }}>
        {series.length === 0 ? (
          <Empty description="暂无数据" />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={series}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(v) => formatMoney(Number(v))} />
              <Legend />
              <Bar dataKey="income" name="收入" fill="#52c41a" />
              <Bar dataKey="expense" name="支出" fill="#f5222d" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </Card>

      <Card title={`${current} 支出分类占比`} style={{ marginTop: 16 }}>
        {expenseBreakdown.length === 0 ? (
          <Empty description="本月暂无支出" />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie data={expenseBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={(e) => `${e.name} ${formatMoney(e.value)}`}>
                {expenseBreakdown.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(v) => formatMoney(Number(v))} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  );
}
