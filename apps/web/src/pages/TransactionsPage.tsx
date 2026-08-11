import { useEffect, useMemo, useState } from 'react';
import { Card, Table, Select, Input, DatePicker, Tag, Space, Button, Modal, Popconfirm, App as AntApp, Typography } from 'antd';
import { DeleteOutlined, EditOutlined, TagsOutlined } from '@ant-design/icons';
import { formatMoney, summarize } from '@ac-ledger/core';
import type { Dayjs } from 'dayjs';
import dayjs from 'dayjs';
import { useStore } from '../store';
import TransactionForm, { toFormValues } from './TransactionForm';
import { Transaction, TransactionType } from '@ac-ledger/core';

const { RangePicker } = DatePicker;

const TYPE_TAG: Record<TransactionType, { color: string; label: string }> = {
  income: { color: 'green', label: '收入' },
  expense: { color: 'red', label: '支出' },
  transfer: { color: 'blue', label: '转账' },
  neutral: { color: 'default', label: '中性' },
};

/** 交易日期（YYYY-MM-DD）是否在范围内；范围为空表示全部 */
function inRange(date: string, range: [Dayjs, Dayjs] | null): boolean {
  if (!range) return true;
  const d = date.slice(0, 10);
  return d >= range[0].format('YYYY-MM-DD') && d <= range[1].format('YYYY-MM-DD');
}

export default function TransactionsPage() {
  const transactions = useStore((s) => s.transactions);
  const months = useStore((s) => s.months);
  const categories = useStore((s) => s.categories);
  const removeTransaction = useStore((s) => s.removeTransaction);
  const updateTransaction = useStore((s) => s.updateTransaction);
  const autoCategorizeUncategorized = useStore((s) => s.autoCategorizeUncategorized);
  const { message } = AntApp.useApp();

  const [autoCatLoading, setAutoCatLoading] = useState(false);

  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [keyword, setKeyword] = useState('');
  const [editing, setEditing] = useState<Transaction | null>(null);
  const [editOpen, setEditOpen] = useState(false);

  // 月份列表加载后默认选中最新月（转为该月起止日期范围）
  useEffect(() => {
    if (!range && months.length > 0) {
      const start = dayjs(`${months[months.length - 1]}-01`);
      setRange([start, start.endOf('month')]);
    }
  }, [months, range]);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const filtered = useMemo(() => {
    return transactions
      .filter((t) => inRange(t.date, range))
      .filter((t) => typeFilter === 'all' || t.type === typeFilter)
      .filter(
        (t) =>
          !keyword ||
          t.counterparty.includes(keyword) ||
          t.note.includes(keyword) ||
          t.refId?.includes(keyword)
      )
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [transactions, range, typeFilter, keyword]);

  const summary = useMemo(() => summarize(filtered), [filtered]);

  // 未分类的收支交易数（一键补分类的待处理量）
  const uncategorizedCount = useMemo(
    () => transactions.filter((t) => !t.categoryId && (t.type === 'income' || t.type === 'expense')).length,
    [transactions]
  );

  const handleAutoCategorize = async () => {
    setAutoCatLoading(true);
    try {
      const r = await autoCategorizeUncategorized();
      if (r.updated === 0) {
        message.info(r.unmatched > 0 ? `规则未命中，仍有 ${r.unmatched} 笔未分类` : '没有未分类的收支交易');
      } else {
        message.success(`已按商户名补全 ${r.updated} 笔分类${r.unmatched > 0 ? `，未匹配 ${r.unmatched} 笔` : ''}`);
      }
    } catch (e) {
      message.error(e instanceof Error ? e.message : '操作失败');
    } finally {
      setAutoCatLoading(false);
    }
  };

  const columns = [
    { title: '时间', dataIndex: 'date', width: 170, render: (v: string) => v.replace('T', ' ').slice(0, 16) },
    {
      title: '类型',
      dataIndex: 'type',
      width: 80,
      render: (v: TransactionType) => <Tag color={TYPE_TAG[v].color}>{TYPE_TAG[v].label}</Tag>,
    },
    { title: '对方', dataIndex: 'counterparty', ellipsis: true, width: 140 },
    {
      title: '分类',
      dataIndex: 'categoryId',
      width: 100,
      render: (id: string | null) => {
        const c = id ? catMap.get(id) : undefined;
        return c ? `${c.icon ?? ''} ${c.name}` : '-';
      },
    },
    { title: '备注', dataIndex: 'note', ellipsis: true },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 130,
      align: 'right' as const,
      render: (v: number, r: Transaction) => (
        <span style={{ color: r.type === 'income' ? '#52c41a' : r.type === 'expense' ? '#f5222d' : undefined, fontWeight: 600 }}>
          {r.type === 'income' ? '+' : r.type === 'expense' ? '-' : ''}
          {formatMoney(v)}
        </span>
      ),
    },
    {
      title: '操作',
      width: 110,
      render: (_: unknown, r: Transaction) => (
        <Space>
          <Button
            size="small"
            icon={<EditOutlined />}
            onClick={() => {
              setEditing(r);
              setEditOpen(true);
            }}
          />
          <Popconfirm title="确认删除这笔交易？" onConfirm={() => void handleDelete(r.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const handleDelete = async (id: string) => {
    await removeTransaction(id);
    message.success('已删除');
  };

  const handleEdit = async (tx: Transaction) => {
    await updateTransaction(tx);
    setEditOpen(false);
    message.success('已更新');
  };

  return (
    <Card
      title="账单"
      extra={
        <Space wrap>
          <RangePicker
            style={{ width: 260 }}
            allowClear
            value={range}
            onChange={(dates) =>
              setRange(dates && dates[0] && dates[1] ? [dates[0], dates[1]] : null)
            }
            presets={[
              { label: '本月', value: [dayjs().startOf('month'), dayjs()] },
              { label: '本年', value: [dayjs().startOf('year'), dayjs()] },
              { label: '近一年', value: [dayjs().subtract(1, 'year').add(1, 'day'), dayjs()] },
            ]}
          />
          <Select
            style={{ width: 100 }}
            value={typeFilter}
            onChange={setTypeFilter}
            options={[
              { value: 'all', label: '全部类型' },
              { value: 'income', label: '收入' },
              { value: 'expense', label: '支出' },
              { value: 'transfer', label: '转账' },
              { value: 'neutral', label: '中性' },
            ]}
          />
          <Input.Search
            placeholder="搜索对方/备注/单号"
            allowClear
            style={{ width: 220 }}
            onChange={(e) => setKeyword(e.target.value)}
          />
          <Popconfirm
            title="按商户名自动匹配分类？"
            description="仅未分类的收支交易会被处理，未匹配的保持不变。"
            onConfirm={() => void handleAutoCategorize()}
          >
            <Button icon={<TagsOutlined />} loading={autoCatLoading} disabled={uncategorizedCount === 0}>
              按商户补分类{uncategorizedCount > 0 ? `（${uncategorizedCount}）` : ''}
            </Button>
          </Popconfirm>
        </Space>
      }
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        共 {filtered.length} 笔 ｜ 收入 <b style={{ color: '#52c41a' }}>{formatMoney(summary.income)}</b> ｜ 支出{' '}
        <b style={{ color: '#f5222d' }}>{formatMoney(summary.expense)}</b> ｜ 结余{' '}
        <b>{formatMoney(summary.balance)}</b>
      </Typography.Paragraph>
      <Table rowKey="id" size="small" columns={columns} dataSource={filtered} pagination={{ pageSize: 30, showSizeChanger: true }} />
      <Modal title="编辑交易" open={editOpen} footer={null} onCancel={() => setEditOpen(false)} destroyOnClose>
        {editing && (
          <TransactionForm key={editing.id} editing={editing} onSubmit={handleEdit} onCancel={() => setEditOpen(false)} />
        )}
      </Modal>
    </Card>
  );
}
