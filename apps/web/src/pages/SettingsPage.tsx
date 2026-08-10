import { useMemo, useState } from 'react';
import { Card, Table, Form, Input, Select, Button, Space, Popconfirm, Tag, App as AntApp, Typography, Divider } from 'antd';
import { PlusOutlined, DeleteOutlined } from '@ant-design/icons';
import { Account, AccountType, AutoCategoryRule, Category, EXPENSE_AUTO_RULES, INCOME_AUTO_RULES, uuid } from '@ac-ledger/core';
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
  const autoRules = useStore((s) => s.autoRules);
  const saveAutoRules = useStore((s) => s.saveAutoRules);
  const { message } = AntApp.useApp();

  const [accountForm] = Form.useForm<{ name: string; type: AccountType }>();
  const [catForm] = Form.useForm<{ name: string; kind: 'income' | 'expense' }>();
  const [ruleForm] = Form.useForm<{ kind: 'income' | 'expense'; category: string; keywords: string }>();
  const ruleKind = Form.useWatch('kind', ruleForm) ?? 'expense';

  // 自定义规则（收入/支出分组）
  const customRows = useMemo(
    () => [
      ...(autoRules.expense ?? []).map((r, i) => ({ key: `expense-${i}`, kind: 'expense' as const, ...r })),
      ...(autoRules.income ?? []).map((r, i) => ({ key: `income-${i}`, kind: 'income' as const, ...r })),
    ],
    [autoRules]
  );

  const addRule = async () => {
    const values = await ruleForm.validateFields();
    const keywords = values.keywords
      .split(/[,，、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (keywords.length === 0) {
      message.error('请填写至少一个关键词');
      return;
    }
    const next: Record<'income' | 'expense', AutoCategoryRule[]> = {
      income: [...(autoRules.income ?? [])],
      expense: [...(autoRules.expense ?? [])],
    };
    next[values.kind].push({ category: values.category, keywords });
    await saveAutoRules(next);
    ruleForm.resetFields();
    message.success('已添加规则，导入与补分类时立即生效');
  };

  const removeRule = async (kind: 'income' | 'expense', index: number) => {
    const next: Record<'income' | 'expense', AutoCategoryRule[]> = {
      income: [...(autoRules.income ?? [])],
      expense: [...(autoRules.expense ?? [])],
    };
    next[kind].splice(index, 1);
    await saveAutoRules(next);
    message.success('已删除规则');
  };

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

      <Card title="自动分类规则" style={{ marginTop: 16 }}>
        <Typography.Paragraph type="secondary" style={{ marginTop: 0 }}>
          导入账单与「按商户补分类」时，按商户名/备注匹配分类。自定义规则优先于内置规则，保存在数据仓库
          settings.json，多设备同步。
        </Typography.Paragraph>

        <Divider orientation="left" plain>
          自定义规则
        </Divider>
        {customRows.length === 0 ? (
          <Typography.Text type="secondary">暂无自定义规则</Typography.Text>
        ) : (
          <Table
            rowKey="key"
            size="small"
            pagination={false}
            dataSource={customRows}
            columns={[
              {
                title: '类型',
                width: 80,
                render: (_: unknown, r: (typeof customRows)[number]) =>
                  r.kind === 'expense' ? <Tag color="red">支出</Tag> : <Tag color="green">收入</Tag>,
              },
              { title: '分类', dataIndex: 'category', width: 120 },
              {
                title: '关键词',
                dataIndex: 'keywords',
                render: (kws: string[]) => (
                  <Space size={[4, 4]} wrap>
                    {kws.map((k) => (
                      <Tag key={k}>{k}</Tag>
                    ))}
                  </Space>
                ),
              },
              {
                title: '操作',
                width: 80,
                render: (_: unknown, r: (typeof customRows)[number]) => (
                  <Popconfirm
                    title="确认删除这条规则？"
                    onConfirm={() => void removeRule(r.kind, r.kind === 'expense' ? customRows.filter((x) => x.kind === 'expense').indexOf(r) : customRows.filter((x) => x.kind === 'income').indexOf(r))}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />} />
                  </Popconfirm>
                ),
              },
            ]}
          />
        )}
        <Form form={ruleForm} layout="inline" style={{ marginTop: 12 }} onFinish={() => void addRule()}>
          <Form.Item name="kind" initialValue="expense">
            <Select
              style={{ width: 100 }}
              options={[
                { value: 'expense', label: '支出' },
                { value: 'income', label: '收入' },
              ]}
            />
          </Form.Item>
          <Form.Item name="category" rules={[{ required: true, message: '选择分类' }]}>
            <Select
              style={{ width: 150 }}
              placeholder="目标分类"
              options={categories
                .filter((c) => c.kind === ruleKind)
                .map((c) => ({ value: c.name, label: `${c.icon ?? ''} ${c.name}` }))}
            />
          </Form.Item>
          <Form.Item name="keywords" rules={[{ required: true, message: '关键词' }]} style={{ flex: 1 }}>
            <Input placeholder="关键词，多个用逗号分隔，如：沙县小吃,兰州拉面" />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<PlusOutlined />}>
            添加规则
          </Button>
        </Form>

        <Divider orientation="left" plain>
          内置规则（只读参考）
        </Divider>
        <Typography.Paragraph style={{ marginBottom: 4 }}>
          <b>支出</b>
        </Typography.Paragraph>
        {EXPENSE_AUTO_RULES.map((r) => (
          <Typography.Paragraph key={r.category} style={{ marginBottom: 2, fontSize: 12 }}>
            <Tag color="red">{r.category}</Tag>
            <Typography.Text type="secondary">{r.keywords.join('、')}</Typography.Text>
          </Typography.Paragraph>
        ))}
        <Typography.Paragraph style={{ marginBottom: 4, marginTop: 8 }}>
          <b>收入</b>
        </Typography.Paragraph>
        {INCOME_AUTO_RULES.map((r) => (
          <Typography.Paragraph key={r.category} style={{ marginBottom: 2, fontSize: 12 }}>
            <Tag color="green">{r.category}</Tag>
            <Typography.Text type="secondary">{r.keywords.join('、')}</Typography.Text>
          </Typography.Paragraph>
        ))}
      </Card>
    </div>
  );
}
