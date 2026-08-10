import { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Spin, Typography, Button } from 'antd';
import {
  BookOutlined,
  PlusCircleOutlined,
  ImportOutlined,
  BarChartOutlined,
  SettingOutlined,
  DisconnectOutlined,
} from '@ant-design/icons';
import { autoConnect, useStore } from './store';
import SetupPage from './pages/SetupPage';
import AddPage from './pages/AddPage';
import TransactionsPage from './pages/TransactionsPage';
import ImportPage from './pages/ImportPage';
import StatsPage from './pages/StatsPage';
import SettingsPage from './pages/SettingsPage';

const { Sider, Content, Header } = Layout;

function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const status = useStore((s) => s.status);
  const disconnect = useStore((s) => s.disconnect);

  const menuItems = [
    { key: '/add', icon: <PlusCircleOutlined />, label: '记账' },
    { key: '/transactions', icon: <BookOutlined />, label: '账单' },
    { key: '/import', icon: <ImportOutlined />, label: '导入' },
    { key: '/stats', icon: <BarChartOutlined />, label: '统计' },
    { key: '/settings', icon: <SettingOutlined />, label: '设置' },
  ];

  const current = menuItems.find((m) => location.pathname.startsWith(m.key))?.key ?? '/add';

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider theme="dark" width={180}>
        <div style={{ color: '#fff', fontSize: 18, fontWeight: 700, padding: '16px 24px' }}>Ac记账</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[current]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: '#fff',
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            paddingInline: 24,
          }}
        >
          <Typography.Text type="secondary">数据源：{useStore((s) => s.config)?.kind === 'github' ? 'GitHub 仓库' : useStore((s) => s.config)?.kind === 'webdav' ? 'WebDAV' : '未配置'}</Typography.Text>
          <Button
            icon={<DisconnectOutlined />}
            style={{ marginLeft: 12 }}
            onClick={() => {
              disconnect();
              navigate('/setup');
            }}
          >
            断开
          </Button>
        </Header>
        <Content style={{ padding: 24 }}>
          <Routes>
            <Route path="/setup" element={<SetupPage />} />
            <Route path="/add" element={<AddPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/import" element={<ImportPage />} />
            <Route path="/stats" element={<StatsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/add" replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

export default function App() {
  const status = useStore((s) => s.status);

  useEffect(() => {
    void autoConnect();
  }, []);

  if (status === 'unconfigured' || status === 'error') {
    return <SetupPage standalone />;
  }

  if (status === 'connecting') {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <Spin size="large" tip="正在连接数据源…">
          <div style={{ width: 120, height: 60 }} />
        </Spin>
      </div>
    );
  }

  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
