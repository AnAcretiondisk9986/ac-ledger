import { useMemo, useState } from 'react';
import { Card, Statistic, Select, Empty, Table, Typography, DatePicker, Segmented } from 'antd';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
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

const { RangePicker } = DatePicker;

const PIE_COLORS = ['#1677ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2', '#eb2f96', '#fa8c16', '#a0d911'];
const ACCOUNT_COLORS = ['#237a57', '#3b6f8f', '#b06f2e', '#8a5a88', '#a94f4a', '#657a3b', '#637085'];

interface SummaryValues {
  income: number;
  expense: number;
  balance: number;
  count: number;
}

function SummaryGrid({ values }: { values: SummaryValues }) {
  return (
    <div className="stat-grid">
      <div className="stat-cell">
        <Statistic title="收入" value={values.income} precision={2} prefix="¥" valueStyle={{ color: '#237a57' }} />
      </div>
      <div className="stat-cell">
        <Statistic title="支出" value={values.expense} precision={2} prefix="¥" valueStyle={{ color: '#b7443e' }} />
      </div>
      <div className="stat-cell">
        <Statistic title="结余" value={values.balance} precision={2} prefix="¥" valueStyle={{ color: values.balance >= 0 ? '#3b6f8f' : '#b7443e' }} />
      </div>
      <div className="stat-cell">
        <Statistic title="笔数" value={values.count} />
      </div>
    </div>
  );
}

/** 交易日期（YYYY-MM-DD）是否在范围内；范围为空表示全部 */
function inRange(date: string, range: [Dayjs, Dayjs] | null): boolean {
  if (!range) return true;
  const d = date.slice(0, 10);
  return d >= range[0].format('YYYY-MM-DD') && d <= range[1].format('YYYY-MM-DD');
}

export default function StatsPage() {
  const transactions = useStore((s) => s.transactions);
  const categories = useStore((s) => s.categories);
  const accounts = useStore((s) => s.accounts);
  const months = useStore((s) => s.months);

  // —— 全局日期范围筛选（空 = 全部账单） ——
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [accountId, setAccountId] = useState<string>('all');

  const dateRangeTx = useMemo(
    () => transactions.filter((t) => inRange(t.date, range)),
    [transactions, range]
  );
  const rangeTx = useMemo(
    () => dateRangeTx.filter((t) => accountId === 'all' || (accountId === 'unassigned' ? !t.accountId : t.accountId === accountId)),
    [dateRangeTx, accountId]
  );
  const selectedAccountName = accountId === 'all'
    ? '全部账户'
    : accountId === 'unassigned'
      ? '未指定账户'
      : accounts.find((account) => account.id === accountId)?.name ?? '未知账户';
  const rangeLabel = range
    ? `${range[0].format('YYYY-MM-DD')} ~ ${range[1].format('YYYY-MM-DD')}`
    : '全部账单';

  // 范围内有交易的月份（月度统计/趋势图的下钻与跨度）
  const rangeMonths = useMemo(
    () =>
      months.filter(
        (m) => !range || (m >= range[0].format('YYYY-MM') && m <= range[1].format('YYYY-MM'))
      ),
    [months, range]
  );

  const [month, setMonth] = useState<string | undefined>();
  const current = month; // undefined = 全部月份
  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const monthTx = useMemo(
    () => rangeTx.filter((t) => !current || monthKey(t.date) === current),
    [rangeTx, current]
  );
  const summary = useMemo(() => summarize(monthTx), [monthTx]);

  const trendFrom = range ? range[0].format('YYYY-MM') : rangeMonths[0] ?? currentMonth();
  const trendTo = range ? range[1].format('YYYY-MM') : rangeMonths[rangeMonths.length - 1] ?? currentMonth();
  const series = useMemo(
    () => monthlySeries(rangeTx, trendFrom, trendTo),
    [rangeTx, trendFrom, trendTo]
  );

  const expenseBreakdown = useMemo(() => {
    const map = categoryBreakdown(rangeTx, 'expense');
    return [...map.entries()]
      .map(([catId, amount]) => ({
        name: catId === 'uncategorized' ? '未分类' : (catMap.get(catId)?.name ?? '未分类'),
        value: Math.round(amount * 100) / 100,
      }))
      .sort((a, b) => b.value - a.value);
  }, [rangeTx, catMap]);

  // —— 年度统计（范围内按年） ——
  const years = useMemo(
    () => [...new Set(rangeTx.map((t) => yearOf(t.date)))].sort((a, b) => b - a),
    [rangeTx]
  );
  const [year, setYear] = useState<number | undefined>();
  const currentYear = year ?? years[0];
  const yearTx = useMemo(
    () => rangeTx.filter((t) => yearOf(t.date) === currentYear),
    [rangeTx, currentYear]
  );
  const yearSummary = useMemo(() => summarize(yearTx), [yearTx]);

  // —— 支出商户统计 ——
  const merchants = useMemo(() => counterpartyBreakdown(rangeTx, 'expense'), [rangeTx]);
  const totalExpense = useMemo(() => summarize(rangeTx).expense, [rangeTx]);

  // —— 全账单收支统计 ——
  const allSummary = useMemo(() => summarize(rangeTx), [rangeTx]);

  // —— 账户对比（只受日期范围影响，便于在同一范围内横向比较） ——
  const accountRows = useMemo(() => {
    const rows = new Map<string, { id: string; name: string; income: number; expense: number; count: number }>();
    for (const tx of dateRangeTx) {
      const id = tx.accountId ?? 'unassigned';
      const name = tx.accountId ? accounts.find((account) => account.id === tx.accountId)?.name ?? '未知账户' : '未指定账户';
      const row = rows.get(id) ?? { id, name, income: 0, expense: 0, count: 0 };
      if (tx.type === 'income') row.income += tx.amount;
      if (tx.type === 'expense') row.expense += tx.amount;
      row.count++;
      rows.set(id, row);
    }
    return [...rows.values()].map((row) => ({ ...row, balance: row.income - row.expense })).sort((a, b) => b.expense - a.expense);
  }, [dateRangeTx, accounts]);
  const accountExpenseTotal = useMemo(() => accountRows.reduce((sum, row) => sum + row.expense, 0), [accountRows]);
  const accountExpenseData = useMemo(() => accountRows.filter((row) => row.expense > 0).map((row) => ({ name: row.name, value: Math.round(row.expense * 100) / 100 })), [accountRows]);
  const accountTrendFrom = range ? trendFrom : rangeMonths[Math.max(0, rangeMonths.length - 12)] ?? trendFrom;
  const accountTrendRows = useMemo(() => {
    const result = new Map<string, Record<string, string | number>>();
    for (const row of monthlySeries([], accountTrendFrom, trendTo)) result.set(row.month, { month: row.month });
    for (const account of accountRows.filter((row) => row.expense > 0)) {
      const tx = dateRangeTx.filter((item) => (item.accountId ?? 'unassigned') === account.id);
      for (const point of monthlySeries(tx, accountTrendFrom, trendTo)) result.get(point.month)![account.id] = point.expense;
    }
    return [...result.values()];
  }, [accountRows, dateRangeTx, accountTrendFrom, trendTo]);

  // —— 图表类型切换 ——
  const [trendType, setTrendType] = useState<'bar' | 'line'>('bar');
  const [catType, setCatType] = useState<'pie' | 'bar'>('pie');

  return (
    <div className="page-stack">
      <Card className="filter-card" size="small">
        <div className="filter-row">
          <Typography.Text strong>日期范围</Typography.Text>
          <RangePicker
            value={range}
            onChange={(dates) => setRange(dates as [Dayjs, Dayjs] | null)}
            allowClear
            presets={[
              { label: '本月', value: [dayjs().startOf('month'), dayjs()] },
              { label: '本年', value: [dayjs().startOf('year'), dayjs()] },
              { label: '近一年', value: [dayjs().subtract(1, 'year').add(1, 'day'), dayjs()] },
            ]}
          />
          <Select
            value={accountId}
            onChange={setAccountId}
            style={{ width: 180 }}
            options={[
              { value: 'all', label: '全部账户' },
              ...accounts.map((account) => ({ value: account.id, label: account.name })),
              { value: 'unassigned', label: '未指定账户' },
            ]}
          />
          <Typography.Text className="filter-context">
            {rangeLabel} · {selectedAccountName} · {rangeTx.length} 笔
          </Typography.Text>
        </div>
      </Card>

      <Card
        className="surface-card"
        title="月度统计"
        extra={
          <Select
            style={{ width: 140 }}
            value={month}
            allowClear
            placeholder="全部月份"
            onChange={setMonth}
            options={[...rangeMonths].reverse().map((m) => ({ value: m, label: m }))}
          />
        }
      >
        <SummaryGrid values={summary} />
      </Card>

      <Card className="surface-card" title="年度统计" extra={
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
          <SummaryGrid values={yearSummary} />
        )}
      </Card>

      <Card className="surface-card" title="支出商户统计">
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

      <Card className="surface-card" title="全账单收支统计">
        {allSummary.count === 0 ? (
          <Empty description="暂无数据" />
        ) : (
          <>
            <SummaryGrid values={allSummary} />
            <Typography.Text type="secondary" style={{ display: 'block', marginTop: 12 }}>
              统计范围：{rangeLabel}（含转账 {formatMoney(allSummary.transfer)}、中性 {formatMoney(allSummary.neutral)}）
            </Typography.Text>
          </>
        )}
      </Card>

      <Card className="surface-card" title="账户收支对比">
        {accountRows.length === 0 ? (
          <Empty description="暂无账户数据" />
        ) : (
          <Table
            rowKey="id"
            size="small"
            pagination={false}
            dataSource={accountRows}
            columns={[
              { title: '账户', dataIndex: 'name', ellipsis: true },
              { title: '笔数', dataIndex: 'count', width: 80, align: 'right' as const },
              { title: '收入', dataIndex: 'income', width: 140, align: 'right' as const, render: (value: number) => <span className="amount-income">{formatMoney(value)}</span> },
              { title: '支出', dataIndex: 'expense', width: 140, align: 'right' as const, render: (value: number) => <span className="amount-expense">{formatMoney(value)}</span> },
              { title: '结余', dataIndex: 'balance', width: 140, align: 'right' as const, render: (value: number) => formatMoney(value) },
              { title: '支出占比', width: 100, align: 'right' as const, render: (_: unknown, row: (typeof accountRows)[number]) => accountExpenseTotal > 0 ? `${((row.expense / accountExpenseTotal) * 100).toFixed(1)}%` : '-' },
            ]}
          />
        )}
      </Card>

      <div className="page-grid page-grid-two">
        <Card className="surface-card chart-card" title="账户支出占比">
          {accountExpenseData.length === 0 ? (
            <Empty description="暂无支出" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={accountExpenseData} dataKey="value" nameKey="name" cx="50%" cy="48%" innerRadius={52} outerRadius={92} paddingAngle={2}>
                  {accountExpenseData.map((_, index) => <Cell key={index} fill={ACCOUNT_COLORS[index % ACCOUNT_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(value) => formatMoney(Number(value))} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="surface-card chart-card" title="账户支出趋势">
          {accountExpenseData.length === 0 ? (
            <Empty description="暂无支出" />
          ) : (
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={accountTrendRows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(value) => formatMoney(Number(value))} />
                <Legend />
                {accountRows.filter((row) => row.expense > 0).map((account, index) => (
                  <Line key={account.id} type="monotone" dataKey={account.id} name={account.name} stroke={ACCOUNT_COLORS[index % ACCOUNT_COLORS.length]} strokeWidth={2} dot={false} connectNulls />
                ))}
              </LineChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card
        className="surface-card chart-card"
        title="收支趋势"
        extra={
          <Segmented
            value={trendType}
            onChange={(v) => setTrendType(v as 'bar' | 'line')}
            options={[
              { label: '柱状图', value: 'bar' },
              { label: '折线图', value: 'line' },
            ]}
          />
        }
      >
        {series.length === 0 ? (
          <Empty description="暂无数据" />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            {trendType === 'line' ? (
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(v) => formatMoney(Number(v))} />
                <Legend />
                <Line type="monotone" dataKey="income" name="收入" stroke="#52c41a" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="expense" name="支出" stroke="#f5222d" strokeWidth={2} dot={false} />
              </LineChart>
            ) : (
              <BarChart data={series}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip formatter={(v) => formatMoney(Number(v))} />
                <Legend />
                <Bar dataKey="income" name="收入" fill="#52c41a" />
                <Bar dataKey="expense" name="支出" fill="#f5222d" />
              </BarChart>
            )}
          </ResponsiveContainer>
        )}
      </Card>

      <Card
        className="surface-card chart-card"
        title={`${current ?? rangeLabel} 支出分类占比`}
        extra={
          <Segmented
            value={catType}
            onChange={(v) => setCatType(v as 'pie' | 'bar')}
            options={[
              { label: '饼图', value: 'pie' },
              { label: '柱状图', value: 'bar' },
            ]}
          />
        }
      >
        {expenseBreakdown.length === 0 ? (
          <Empty description="暂无支出" />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            {catType === 'bar' ? (
              <BarChart data={expenseBreakdown} layout="vertical" margin={{ left: 40, right: 24 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="name" width={80} />
                <Tooltip formatter={(v) => formatMoney(Number(v))} />
                <Legend />
                <Bar dataKey="value" name="金额" radius={[0, 4, 4, 0]}>
                  {expenseBreakdown.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            ) : (
              <PieChart>
                <Pie data={expenseBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={(e) => `${e.name} ${formatMoney(e.value)}`}>
                  {expenseBreakdown.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => formatMoney(Number(v))} />
                <Legend />
              </PieChart>
            )}
          </ResponsiveContainer>
        )}
      </Card>
    </div>
  );
}
