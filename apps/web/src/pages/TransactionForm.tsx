import { useEffect } from 'react';
import { Form, Input, InputNumber, Select, DatePicker, Radio, Button } from 'antd';
import dayjs, { Dayjs } from 'dayjs';
import { Transaction, TransactionStatus, TransactionType, uuid } from '@ac-ledger/core';
import { useStore } from '../store';

export interface TransactionFormValues {
  type: TransactionType;
  amount: number;
  categoryId?: string;
  accountId?: string;
  counterparty?: string;
  note?: string;
  status: TransactionStatus;
  date: Dayjs;
}

interface Props {
  /** 编辑时传入；新建为 null */
  editing?: Transaction | null;
  onSubmit: (tx: Transaction) => Promise<void> | void;
  onCancel?: () => void;
  submitText?: string;
  /** 提交成功后重置表单（用于连续记账） */
  resetAfterSubmit?: boolean;
}

const TYPE_LABEL: Record<TransactionType, string> = {
  expense: '支出',
  income: '收入',
  transfer: '转账',
  neutral: '中性',
};

export function toFormValues(tx: Transaction): TransactionFormValues {
  return {
    type: tx.type,
    amount: tx.amount,
    categoryId: tx.categoryId ?? undefined,
    accountId: tx.accountId ?? undefined,
    counterparty: tx.counterparty,
    note: tx.note,
    status: tx.status,
    date: dayjs(tx.date),
  };
}

export default function TransactionForm({ editing, onSubmit, onCancel, submitText = '保存', resetAfterSubmit = false }: Props) {
  const categories = useStore((s) => s.categories);
  const accounts = useStore((s) => s.accounts);
  const [form] = Form.useForm<TransactionFormValues>();
  const type = Form.useWatch('type', form) ?? editing?.type ?? 'expense';

  useEffect(() => {
    if (editing) form.setFieldsValue(toFormValues(editing));
    else form.resetFields();
  }, [editing, form]);

  const kindCats = categories.filter((c) => (type === 'income' ? c.kind === 'income' : c.kind === 'expense'));

  const handleFinish = async (values: TransactionFormValues) => {
    const tx: Transaction = {
      id: editing?.id ?? uuid(),
      date: values.date.format('YYYY-MM-DDTHH:mm:ss') + '+08:00',
      type: values.type,
      amount: Math.round(values.amount * 100) / 100,
      currency: 'CNY',
      categoryId: values.categoryId ?? null,
      accountId: values.accountId ?? null,
      counterparty: values.counterparty?.trim() ?? '',
      note: values.note?.trim() ?? '',
      status: values.status ?? 'completed',
      source: editing?.source ?? 'manual',
      refId: editing?.refId,
      createdAt: editing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await onSubmit(tx);
    if (resetAfterSubmit) form.resetFields();
  };

  return (
    <Form form={form} layout="vertical" initialValues={{ type: 'expense', status: 'completed', date: dayjs() }} onFinish={handleFinish}>
      <Form.Item name="type" label="类型" rules={[{ required: true }]}>
        <Radio.Group
          options={Object.entries(TYPE_LABEL).map(([value, label]) => ({ value, label }))}
        />
      </Form.Item>
      <Form.Item name="amount" label="金额（元）" rules={[{ required: true, message: '请输入金额' }]}>
        <InputNumber min={0.01} precision={2} style={{ width: '100%' }} placeholder="0.00" />
      </Form.Item>
      <Form.Item name="date" label="时间" rules={[{ required: true }]}>
        <DatePicker showTime style={{ width: '100%' }} />
      </Form.Item>
      <Form.Item name="categoryId" label="分类">
        <Select
          allowClear
          placeholder="选择分类"
          options={kindCats.map((c) => ({ value: c.id, label: `${c.icon ?? ''} ${c.name}` }))}
        />
      </Form.Item>
      <Form.Item name="accountId" label="账户">
        <Select
          allowClear
          placeholder="选择账户"
          options={accounts.map((a) => ({ value: a.id, label: a.name }))}
        />
      </Form.Item>
      <Form.Item name="counterparty" label="交易对方">
        <Input placeholder="对方名称 / 商户名" />
      </Form.Item>
      <Form.Item name="note" label="备注">
        <Input.TextArea rows={2} placeholder="备注 / 商品描述" />
      </Form.Item>
      <Form.Item name="status" label="状态" hidden={!editing}>
        <Select
          options={[
            { value: 'completed', label: '已完成' },
            { value: 'pending', label: '处理中' },
            { value: 'refunded', label: '已退款' },
            { value: 'partially_refunded', label: '部分退款' },
            { value: 'failed', label: '失败' },
          ]}
        />
      </Form.Item>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {onCancel && <Button onClick={onCancel}>取消</Button>}
        <Button type="primary" htmlType="submit">
          {submitText}
        </Button>
      </div>
    </Form>
  );
}
