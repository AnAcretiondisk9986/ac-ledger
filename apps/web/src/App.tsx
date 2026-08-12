import { useEffect } from 'react';
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { Layout, Menu, Spin, Typography, Button, Tooltip } from 'antd';
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
import WindowControls from './WindowControls';

const { Sider, Content, Header } = Layout;

const PAGE_META: Record<string, { title: string; detail: string }> = {
  '/add': { title: '记一笔', detail: '快速记录一笔新的收支' },
  '/transactions': { title: '账单', detail: '查找、整理和核对每笔交易' },
  '/import': { title: '导入', detail: '从微信或支付宝账单批量导入' },
  '/stats': { title: '统计', detail: '从时间、分类和商户理解收支' },
  '/settings': { title: '设置', detail: '管理账本、账户与分类规则' },
};

function Shell() {
  const navigate = useNavigate();
  const location = useLocation();
  const status = useStore((s) => s.status);
  const disconnect = useStore((s) => s.disconnect);
  const config = useStore((s) => s.config);

  const menuItems = [
    { key: '/add', icon: <PlusCircleOutlined />, label: '记账' },
    { key: '/transactions', icon: <BookOutlined />, label: '账单' },
    { key: '/import', icon: <ImportOutlined />, label: '导入' },
    { key: '/stats', icon: <BarChartOutlined />, label: '统计' },
    { key: '/settings', icon: <SettingOutlined />, label: '设置' },
  ];

  const current = menuItems.find((m) => location.pathname.startsWith(m.key))?.key ?? '/add';
  const pageMeta = PAGE_META[current] ?? PAGE_META['/add']!;
  const sourceLabel = config?.kind === 'github' ? 'GitHub' : config?.kind === 'webdav' ? 'WebDAV' : '本机';

  // 双击标题栏空白处切换最大化/还原（no-drag 区域内不触发）
  const handleHeaderDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.app-region-no-drag')) return;
    window.acLedgerDesktop?.windowControls?.toggleMaximize();
  };

  return (
    <Layout className="app-shell">
      <Sider className="app-sider" theme="dark" width={208}>
        <div className="brand app-region-drag">
          <div className="brand-mark" aria-hidden>Ac</div>
          <div className="brand-copy">
            <span className="brand-name">Ac记账</span>
            <span className="brand-caption">清晰掌握每一笔</span>
          </div>
        </div>
        <Menu
          className="app-nav app-region-no-drag"
          theme="dark"
          mode="inline"
          selectedKeys={[current]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
        />
        <div className="sider-footer">
          <span className="source-dot" />
          <span>{sourceLabel} 已连接</span>
        </div>
      </Sider>
      <Layout className="app-main">
        <Header
          className="app-header app-region-drag"
          onDoubleClick={handleHeaderDoubleClick}
        >
          <div className="page-heading">
            <Typography.Title level={1}>{pageMeta.title}</Typography.Title>
            <Typography.Text>{pageMeta.detail}</Typography.Text>
          </div>
          <div className="header-actions app-region-no-drag">
            <div className="source-chip"><span className="source-dot" />{sourceLabel}</div>
            <Tooltip title="断开数据源">
              <Button
                aria-label="断开数据源"
                icon={<DisconnectOutlined />}
                onClick={() => {
                  disconnect();
                  navigate('/setup');
                }}
              />
            </Tooltip>
          </div>
          <WindowControls flushRight />
        </Header>
        <Content className="app-content">
          <div className="content-frame route-enter" key={current}>
            <Routes>
              <Route path="/setup" element={<SetupPage />} />
              <Route path="/add" element={<AddPage />} />
              <Route path="/transactions" element={<TransactionsPage />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/stats" element={<StatsPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<Navigate to="/add" replace />} />
            </Routes>
          </div>
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
    return (
      <div className="setup-shell">
        <div
          className="setup-titlebar app-region-drag"
        >
          <WindowControls />
        </div>
        <div className="setup-scroll">
          <SetupPage standalone />
        </div>
      </div>
    );
  }

  if (status === 'connecting') {
    return (
      <div className="setup-shell">
        <div
          className="setup-titlebar app-region-drag"
        >
          <WindowControls />
        </div>
        <div className="connecting-state">
          <Spin size="large" tip="正在连接数据源…">
            <div className="connecting-placeholder" />
          </Spin>
        </div>
      </div>
    );
  }

  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
