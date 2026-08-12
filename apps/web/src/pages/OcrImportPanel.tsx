import { useMemo, useState } from 'react';
import {
  Alert,
  App as AntApp,
  Button,
  DatePicker,
  Input,
  InputNumber,
  Progress,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Upload,
  Typography,
  type TableColumnsType,
  type UploadFile,
} from 'antd';
import type { RcFile } from 'antd/es/upload';
import {
  DeleteOutlined,
  FileImageOutlined,
  ScanOutlined,
  SnippetsOutlined,
} from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import {
  applyAutoAccount,
  applyAutoCategory,
  formatMoney,
  type Transaction,
  type TransactionType,
} from '@ac-ledger/core';
import {
  createOcrRefId,
  type OcrBillPlatform,
  type OcrIssue,
  type OcrTransactionCandidate,
} from '@ac-ledger/bill-import';
import { recognizeScreenshot, type OcrProgress } from '../ocr';
import { useStore } from '../store';

const ISSUE_LABEL: Record<OcrIssue, { color: string; text: string }> = {
  'low-confidence': { color: 'orange', text: '请核对' },
  'missing-time': { color: 'gold', text: '缺少时间' },
  'inferred-date': { color: 'blue', text: '推断日期' },
  'ambiguous-type': { color: 'volcano', text: '收支待确认' },
  'missing-counterparty': { color: 'red', text: '缺少商户' },
};

const TYPE_OPTIONS = [
  { value: 'expense', label: '支出' },
  { value: 'income', label: '收入' },
  { value: 'transfer', label: '转账' },
  { value: 'neutral', label: '不计收支' },
];

interface Props {
  onImported: () => void;
}

function fileFromUpload(item: UploadFile): File | null {
  return item.originFileObj instanceof File ? item.originFileObj : null;
}

export default function OcrImportPanel({ onImported }: Props) {
  const transactions = useStore((state) => state.transactions);
  const categories = useStore((state) => state.categories);
  const accounts = useStore((state) => state.accounts);
  const autoRules = useStore((state) => state.autoRules);
  const addTransactions = useStore((state) => state.addTransactions);
  const { message } = AntApp.useApp();
  const [platform, setPlatform] = useState<OcrBillPlatform>('wechat');
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [candidates, setCandidates] = useState<OcrTransactionCandidate[]>([]);
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [activeFile, setActiveFile] = useState('');
  const [recognizing, setRecognizing] = useState(false);
  const [importing, setImporting] = useState(false);

  const existingRefIds = useMemo(
    () => new Set(transactions.flatMap((transaction) => transaction.refId ? [transaction.refId] : [])),
    [transactions]
  );
  const duplicateIds = useMemo(() => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const candidate of candidates) {
      const refId = candidate.transaction.refId;
      if (!refId) continue;
      if (seen.has(refId) || existingRefIds.has(refId)) duplicates.add(candidate.transaction.id);
      seen.add(refId);
    }
    return duplicates;
  }, [candidates, existingRefIds]);

  const updateTransaction = (id: string, patch: Partial<Transaction>) => {
    setCandidates((current) => current.map((candidate) => {
      if (candidate.transaction.id !== id) return candidate;
      const transaction = { ...candidate.transaction, ...patch, updatedAt: new Date().toISOString() };
      transaction.refId = createOcrRefId(platform, transaction);
      return { ...candidate, transaction };
    }));
  };

  const runRecognition = async () => {
    const sourceFiles = files.map(fileFromUpload).filter((file): file is File => Boolean(file));
    if (sourceFiles.length === 0) return;
    setRecognizing(true);
    setCandidates([]);
    setSelected([]);
    try {
      const recognized: OcrTransactionCandidate[] = [];
      for (let index = 0; index < sourceFiles.length; index++) {
        const file = sourceFiles[index]!;
        setActiveFile(`${index + 1}/${sourceFiles.length} ${file.name}`);
        const result = await recognizeScreenshot(
          file,
          platform,
          file.name,
          file.lastModified ? new Date(file.lastModified) : new Date(),
          (value) => setProgress(value)
        );
        recognized.push(...result);
      }
      if (recognized.length === 0) {
        message.warning('没有识别到完整流水，请确认平台选择正确且截图包含金额与商户');
        return;
      }
      setCandidates(recognized);
      setSelected(recognized
        .filter((candidate) => candidate.transaction.amount > 0 && candidate.transaction.counterparty)
        .map((candidate) => candidate.transaction.id));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '截图识别失败');
    } finally {
      setRecognizing(false);
      setProgress(null);
      setActiveFile('');
    }
  };

  const pasteImage = async () => {
    try {
      const clipboard = await navigator.clipboard.read();
      const added: UploadFile[] = [];
      for (const item of clipboard) {
        const imageType = item.types.find((type) => type.startsWith('image/'));
        if (!imageType) continue;
        const blob = await item.getType(imageType);
        const extension = imageType.split('/')[1] ?? 'png';
        const rawFile = new File([blob], `剪贴板-${Date.now()}.${extension}`, { type: imageType, lastModified: Date.now() });
        const file = Object.assign(rawFile, {
          uid: `${Date.now()}-${added.length}`,
          lastModifiedDate: new Date(rawFile.lastModified),
        }) as RcFile;
        added.push({ uid: `${Date.now()}-${added.length}`, name: file.name, status: 'done', originFileObj: file });
      }
      if (added.length === 0) message.warning('剪贴板中没有图片');
      else {
        setFiles((current) => [...current, ...added]);
        setCandidates([]);
      }
    } catch {
      message.error('无法读取剪贴板，请使用拖入或选择图片');
    }
  };

  const doImport = async () => {
    const chosen = candidates
      .filter((candidate) => selected.includes(candidate.transaction.id))
      .filter((candidate) => !duplicateIds.has(candidate.transaction.id))
      .map((candidate) => candidate.transaction);
    if (chosen.length === 0) return;
    setImporting(true);
    try {
      const categorized = applyAutoCategory(chosen, categories, autoRules);
      const withAccounts = applyAutoAccount(categorized, accounts);
      const result = await addTransactions(withAccounts);
      message.success(`导入完成：新增 ${result.added} 笔，跳过重复 ${result.skipped} 笔`);
      onImported();
    } catch (error) {
      message.error(error instanceof Error ? error.message : '导入失败');
    } finally {
      setImporting(false);
    }
  };

  const columns: TableColumnsType<OcrTransactionCandidate> = [
    {
      title: '时间',
      width: 174,
      render: (_, candidate) => (
        <DatePicker
          showTime
          size="small"
          value={dayjs(candidate.transaction.date)}
          onChange={(value: Dayjs | null) => value && updateTransaction(candidate.transaction.id, {
            date: value.format('YYYY-MM-DDTHH:mm:ss') + '+08:00',
          })}
          style={{ width: 164 }}
        />
      ),
    },
    {
      title: '类型',
      width: 105,
      render: (_, candidate) => (
        <Select
          size="small"
          value={candidate.transaction.type}
          options={TYPE_OPTIONS}
          onChange={(type: TransactionType) => updateTransaction(candidate.transaction.id, { type, categoryId: null })}
          style={{ width: 95 }}
        />
      ),
    },
    {
      title: '商户 / 对方',
      width: 220,
      render: (_, candidate) => (
        <Input
          size="small"
          value={candidate.transaction.counterparty}
          onChange={(event) => updateTransaction(candidate.transaction.id, { counterparty: event.target.value })}
        />
      ),
    },
    {
      title: '金额',
      width: 118,
      align: 'right',
      render: (_, candidate) => (
        <InputNumber
          size="small"
          min={0.01}
          precision={2}
          value={candidate.transaction.amount}
          onChange={(amount) => typeof amount === 'number' && updateTransaction(candidate.transaction.id, { amount })}
          style={{ width: 108 }}
        />
      ),
    },
    {
      title: '分类',
      width: 135,
      render: (_, candidate) => (
        <Select
          allowClear
          size="small"
          value={candidate.transaction.categoryId ?? undefined}
          placeholder="自动匹配"
          options={categories
            .filter((category) => category.kind === (candidate.transaction.type === 'income' ? 'income' : 'expense'))
            .map((category) => ({ value: category.id, label: `${category.icon ?? ''} ${category.name}` }))}
          onChange={(categoryId) => updateTransaction(candidate.transaction.id, { categoryId: categoryId ?? null })}
          style={{ width: 125 }}
        />
      ),
    },
    {
      title: '账户',
      width: 130,
      render: (_, candidate) => (
        <Select
          allowClear
          size="small"
          value={candidate.transaction.accountId ?? undefined}
          placeholder="自动匹配"
          options={accounts.map((account) => ({ value: account.id, label: account.name }))}
          onChange={(accountId) => updateTransaction(candidate.transaction.id, { accountId: accountId ?? null })}
          style={{ width: 120 }}
        />
      ),
    },
    {
      title: '识别状态',
      width: 190,
      render: (_, candidate) => (
        <Space size={[2, 3]} wrap>
          {duplicateIds.has(candidate.transaction.id) && <Tag color="red">疑似重复</Tag>}
          {candidate.issues.map((issue) => (
            <Tag key={issue} color={ISSUE_LABEL[issue].color}>{ISSUE_LABEL[issue].text}</Tag>
          ))}
          {candidate.issues.length === 0 && !duplicateIds.has(candidate.transaction.id) && <Tag color="green">已校验</Tag>}
        </Space>
      ),
    },
    {
      title: '来源',
      dataIndex: 'sourceName',
      width: 130,
      ellipsis: true,
    },
  ];

  if (candidates.length > 0) {
    const selectedAmount = candidates
      .filter((candidate) => selected.includes(candidate.transaction.id) && !duplicateIds.has(candidate.transaction.id))
      .reduce((sum, candidate) => sum + candidate.transaction.amount, 0);
    return (
      <div className="ocr-review">
        <Alert
          type={candidates.some((candidate) => candidate.issues.length > 0) ? 'warning' : 'success'}
          showIcon
          message={`识别到 ${candidates.length} 笔流水`}
          description="黄色标记需要重点核对；疑似重复项默认不导入。截图不会保存或同步。"
          style={{ marginBottom: 12 }}
        />
        <Table
          rowKey={(candidate) => candidate.transaction.id}
          size="small"
          columns={columns}
          dataSource={candidates}
          pagination={false}
          scroll={{ x: 1220, y: 430 }}
          rowSelection={{
            selectedRowKeys: selected,
            onChange: setSelected,
            getCheckboxProps: (candidate) => ({ disabled: duplicateIds.has(candidate.transaction.id) }),
          }}
        />
        <div className="ocr-review-actions">
          <Typography.Text type="secondary">
            已选 {selected.filter((id) => !duplicateIds.has(String(id))).length} 笔，金额合计 {formatMoney(selectedAmount)} 元
          </Typography.Text>
          <Space>
            <Button onClick={() => setCandidates([])}>返回图片选择</Button>
            <Button type="primary" loading={importing} disabled={selected.length === 0} onClick={() => void doImport()}>
              确认导入
            </Button>
          </Space>
        </div>
      </div>
    );
  }

  const stageText = progress?.stage === 'loading' ? '正在加载本地模型' : progress?.stage === 'parsing' ? '正在校验流水' : '正在识别文字';
  return (
    <div className="ocr-import-panel">
      <div className="ocr-platform-row">
        <div>
          <Typography.Text strong>账单来源</Typography.Text>
          <Typography.Text type="secondary" className="ocr-inline-help">平台由你选择，具体页面版式自动判断</Typography.Text>
        </div>
        <Segmented<OcrBillPlatform>
          value={platform}
          options={[{ value: 'wechat', label: '微信' }, { value: 'alipay', label: '支付宝' }]}
          onChange={(value) => {
            setPlatform(value);
            setCandidates([]);
          }}
        />
      </div>
      <Upload.Dragger
        accept="image/png,image/jpeg,image/webp"
        multiple
        fileList={files}
        disabled={recognizing}
        beforeUpload={() => false}
        onChange={({ fileList }) => {
          setFiles(fileList);
          setCandidates([]);
        }}
        onRemove={() => true}
        itemRender={(originNode, file, fileList, actions) => (
          <div className="ocr-file-row">
            <FileImageOutlined />
            <span className="ocr-file-name">{file.name}</span>
            <Button type="text" size="small" aria-label={`移除 ${file.name}`} icon={<DeleteOutlined />} onClick={actions.remove} />
          </div>
        )}
      >
        <p className="ant-upload-drag-icon"><ScanOutlined /></p>
        <p className="ant-upload-text">拖入或选择账单截图</p>
        <p className="ant-upload-hint">支持 PNG、JPG、WebP，可一次选择多张连续截图</p>
      </Upload.Dragger>
      {recognizing && (
        <div className="ocr-progress">
          <div><Typography.Text>{stageText}</Typography.Text><Typography.Text type="secondary">{activeFile}</Typography.Text></div>
          <Progress percent={Math.round((progress?.progress ?? 0) * 100)} status="active" />
        </div>
      )}
      <div className="ocr-actions">
        <Button icon={<SnippetsOutlined />} disabled={recognizing} onClick={() => void pasteImage()}>从剪贴板读取</Button>
        <Button type="primary" icon={<ScanOutlined />} loading={recognizing} disabled={files.length === 0} onClick={() => void runRecognition()}>
          开始识别 {files.length > 0 ? `${files.length} 张` : ''}
        </Button>
      </div>
    </div>
  );
}
