import { Card, App as AntApp } from 'antd';
import TransactionForm from './TransactionForm';
import { useStore } from '../store';
import { Transaction } from '@ac-ledger/core';

export default function AddPage() {
  const addTransactions = useStore((s) => s.addTransactions);
  const { message } = AntApp.useApp();

  const handleSubmit = async (tx: Transaction) => {
    const result = await addTransactions([tx]);
    if (result.added === 1) {
      message.success('已记账');
    } else {
      message.warning('该笔交易已存在（按单号去重），未重复添加');
    }
  };

  return (
    <Card title="记一笔">
      <div style={{ maxWidth: 480 }}>
        <TransactionForm onSubmit={handleSubmit} submitText="保存" resetAfterSubmit />
      </div>
    </Card>
  );
}
