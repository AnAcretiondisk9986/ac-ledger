import { useState } from 'react';
import { Card, Table, Form, Input, Select, Button, Space, Popconfirm, Tag, App as AntApp, Typography, Divider } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { Account, AccountType, Category, uuid } from '@ac-ledger/core';
import { useStore } from '../store';

const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  cash: '现金',
  bank: '银行卡',
  ewallet: '电子钱包',
  credit: '信用卡',
  investment: '理财',
};

export default function SettingsPage() {
  const ledger = useStore((s) => s.ledger);
  const accounts = useStore((s) => s.accounts);
  const categories = useStore((s) => s.categories);
  const saveAccounts = useStore((s) => s.saveAccounts);
  const saveCategories = useStore((s) => s.saveCategories);
  const { message } = AntApp.useApp();

  const [accountForm] = Form.useForm<{ name: string; type: AccountType }>();
  const [catForm] = Form.useForm<{ name: string; kind: 'income' | 'expense' }>();

  const addAccount = async () => {
    const values = await accountForm.validateFields();
    const account: Account = {
      id: `acc-${uuid().slice(0, 8)}`,
      name: values.name,
      type: values.type,
      currency: 'CNY',
      createdAt: new Date().toISOString(),
    };
    await saveAccounts([...accounts, account]);
    accountForm.resetFields();
    message.success('已添加账户');
  };

  const removeAccount = async (id: string) => {
    await saveAccounts(accounts.filter((a) => a.id !== id));
    message.success('已删除');
  };

  const addCategory = async () => {
    const values = await catForm.validateFields();
    const category: Category = {
      id: `cat-${uuid().slice(0, 8)}`,
      name: values.name,
      kind: values.kind,
      parentId: null,
      sortOrder: categories.length,
    };
    await saveCategories([...categories, category]);
    catForm.resetFields();
    message.success('已添加分类');
  };

  const removeCategory = async (id: string) => {
    await saveCategories(categories.filter((c) => c.id !== id));
    message.success('已删除');
  };

  return (
    <div>
      <Card title="账本信息">
        <Typography.Paragraph style={{ marginBottom: 4 }}>
          账本：<b>{ledger?.ledger.name}</b>（{ledger?.ledger.currency}）
        </Typography.Paragraph>
        <Typography.Text type="secondary">
          数据文件布局：ledger.json / accounts.json / categories.json / transactions/YYYY-MM.json
        </Typography.Text>
      </Card>

      <Card title="账户管理" style={{ marginTop: 16 }}>
        <Space style={{ marginBottom: 12 }}>
          <Form form={accountForm} layout="inline" onFinish={() => void addAccount()}>
            <Form.Item name="name" rules={[{ required: true, message: '账户名' }]}>
              <Input placeholder="账户名，如 零钱 / 招行储蓄卡" />
            </Form.Item>
            <Form.Item name="type" initialValue="ewallet">
              <Select
                style={{ width: 130 }}
                options={(Object.keys(ACCOUNT_TYPE_LABEL) as AccountType[]).map((t) => ({
                  value: t,
                  label: ACCOUNT_TYPE_LABEL[t],
                }))}
              />
            </Form.Item>
            <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>
              添加
            </Button>
          </Form>
        </Space>
        <Table
          rowKey="id"
          size="small"
          pagination={false}
          dataSource={accounts}
          columns={[
            { title: '名称', dataIndex: 'name' },
            {
              title: '类型',
              dataIndex: 'type',
              render: (t: AccountType) => <Tag>{ACCOUNT_TYPE_LABEL[t] ?? t}</Tag>,
            },
            { title: '币种', dataIndex: 'currency', width: 80 },
            {
              title: '操作',
              width: 80,
              render: (_: unknown, r: Account) => (
                <Popconfirm title="确认删除？" onConfirm={() => void removeAccount(r.id)}>
                  <Button size="small" danger icon={<DeleteOutlined />} />
                </Popconfirm>
              ),
            },
          ]}
        />
      </Card>

      <Card title="分类管理" style={{ marginTop: 16 }}>
        <Divider orientation="left" plain>
          支出分类
        </Divider>
        <Space wrap style={{ marginBottom: 8 }}>
          {categories
            .filter((c) => c.kind === 'expense')
            .map((c) => (
              <Tag key={c.id} closable onClose={() => void removeCategory(c.id)}>
                {c.icon ?? ''} {c.name}
              </Tag>
            ))}
        </Space>
        <Divider orientation="left" plain>
          收入分类
        </Divider>
        <Space wrap style={{ marginBottom: 8 }}>
          {categories
            .filter((c) => c.kind === 'income')
            .map((c) => (
              <Tag key={c.id} closable onClose={() => void removeCategory(c.id)}>
                {c.icon ?? ''} {c.name}
              </Tag>
            ))}
        </Space>
        <Form form={catForm} layout="inline" onFinish={() => void addCategory()}>
          <Form.Item name="name" rules={[{ required: true, message: '分类名' }]}>
            <Input placeholder="分类名" />
          </Form.Item>
          <Form.Item name="kind" initialValue="expense">
            <Select
              style={{ width: 110 }}
              options={[
                { value: 'expense', label: '支出分类' },
                { value: 'income', label: '收入分类' },
              ]}
            />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>
            添加
          </Button>
        </Form>
      </Card>
    </div>
  );
}
