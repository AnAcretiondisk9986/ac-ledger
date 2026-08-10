import { useMemo, useState } from 'react';
import {
  Card,
  Upload,
  Button,
  Table,
  Tag,
  Alert,
  Steps,
  Space,
  Typography,
  App as AntApp,
} from 'antd';
import { InboxOutlined, FileExcelOutlined } from '@ant-design/icons';
import { parseBill, BillParseResult } from '@ac-ledger/bill-import';
import { formatMoney } from '@ac-ledger/core';
import { useStore } from '../store';
import { Transaction } from '@ac-ledger/core';

const TYPE_TAG: Record<string, { color: string; label: string }> = {
  income: { color: 'green', label: '收入' },
  expense: { color: 'red', label: '支出' },
  transfer: { color: 'blue', label: '转账' },
  neutral: { color: 'default', label: '中性' },
};

export default function ImportPage() {
  const transactions = useStore((s) => s.transactions);
  const addTransactions = useStore((s) => s.addTransactions);
  const { message } = AntApp.useApp();

  const [step, setStep] = useState(0);
  const [parsed, setParsed] = useState<BillParseResult | null>(null);
  const [fileName, setFileName] = useState('');
  const [importing, setImporting] = useState(false);

  // 与现有交易按 refId 去重统计
  const existingRefIds = useMemo(() => new Set(transactions.map((t) => t.refId)), [transactions]);
  const dedup = useMemo(() => {
    if (!parsed) return null;
    const existing = parsed.transactions.filter((t) => t.refId && existingRefIds.has(t.refId));
    const fresh = parsed.transactions.filter((t) => !(t.refId && existingRefIds.has(t.refId)));
    return { existing, fresh };
  }, [parsed, existingRefIds]);

  const uploadProps = {
    accept: '.csv,.xlsx,.txt',
    showUploadList: false,
    beforeUpload: async (file: File) => {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const result = await parseBill(bytes, file.name);
        setParsed(result);
        setFileName(file.name);
        setStep(1);
      } catch (e) {
        message.error(e instanceof Error ? e.message : '解析失败');
      }
      return false; // 阻止自动上传
    },
  };

  const doImport = async () => {
    if (!dedup) return;
    setImporting(true);
    try {
      const result = await addTransactions(dedup.fresh);
      message.success(`导入完成：新增 ${result.added} 笔，跳过重复 ${result.skipped} 笔`);
      setStep(2);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const columns = [
    { title: '时间', dataIndex: 'date', width: 160, render: (v: string) => v.replace('T', ' ').slice(0, 16) },
    {
      title: '类型',
      dataIndex: 'type',
      width: 70,
      render: (v: string) => <Tag color={TYPE_TAG[v]?.color}>{TYPE_TAG[v]?.label ?? v}</Tag>,
    },
    { title: '对方', dataIndex: 'counterparty', ellipsis: true, width: 160 },
    { title: '备注', dataIndex: 'note', ellipsis: true },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 110,
      align: 'right' as const,
      render: (v: number, r: Transaction) => (
        <span style={{ color: r.type === 'income' ? '#52c41a' : r.type === 'expense' ? '#f5222d' : undefined }}>
          {r.type === 'income' ? '+' : r.type === 'expense' ? '-' : ''}
          {formatMoney(v)}
        </span>
      ),
    },
    { title: '状态', dataIndex: 'status', width: 110, render: (v: string) => v },
  ];

  return (
    <Card title="账单导入">
      <Steps
        current={step}
        items={[
          { title: '选择文件', icon: <FileExcelOutlined /> },
          { title: '预览确认' },
          { title: '完成' },
        ]}
        style={{ marginBottom: 24 }}
      />

      {step === 0 && (
        <Upload.Dragger {...uploadProps} style={{ padding: '32px 0' }}>
          <p className="ant-upload-drag-icon">
            <InboxOutlined />
          </p>
          <p className="ant-upload-text">拖拽或点击选择账单文件</p>
          <p className="ant-upload-hint">
            支持微信账单（CSV / xlsx）与支付宝账单（CSV），自动识别类型，最多 1000 笔/文件
          </p>
        </Upload.Dragger>
      )}

      {step === 1 && parsed && (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message={`${fileName} 解析成功`}
            description={
              <Space wrap>
                <span>共 {parsed.transactions.length} 笔</span>
                {parsed.header && (
                  <span>
                    微信账单：收入 {parsed.header.income} 笔 / 支出 {parsed.header.expense} 笔 / 中性{' '}
                    {parsed.header.neutral} 笔
                  </span>
                )}
                {parsed.summary && (
                  <span>
                    支付宝账单：已收入 {parsed.summary.incomeCount ?? 0} 笔 / 已支出{' '}
                    {parsed.summary.paidCount ?? 0} 笔
                  </span>
                )}
              </Space>
            }
          />
          {dedup && dedup.existing.length > 0 && (
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 12 }}
              message={`其中 ${dedup.existing.length} 笔与现有账单重复（相同交易单号），导入时自动跳过`}
            />
          )}
          <Table
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={dedup?.fresh ?? []}
            pagination={{ pageSize: 10 }}
            scroll={{ y: 420 }}
            footer={() => (
              <Typography.Text type="secondary">
                将新增 <b>{dedup?.fresh.length ?? 0}</b> 笔
              </Typography.Text>
            )}
          />
          <Space style={{ marginTop: 16 }}>
            <Button onClick={() => setStep(0)}>重新选择</Button>
            <Button type="primary" loading={importing} disabled={!dedup || dedup.fresh.length === 0} onClick={() => void doImport()}>
              确认导入 {dedup?.fresh.length ?? 0} 笔
            </Button>
          </Space>
        </>
      )}

      {step === 2 && (
        <Alert type="success" showIcon message="导入完成" description="可在「账单」页查看，统计页已自动更新。" />
      )}
    </Card>
  );
}
