import React from 'react';
import ReactDOM from 'react-dom/client';
import { ConfigProvider, App as AntApp, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import './global.css';
import App from './App';

dayjs.locale('zh-cn');

// macOS 桌面端：标记平台类名，CSS 据此为原生交通灯留出空间、调整标题栏布局
if (window.acLedgerDesktop?.platform === 'darwin') {
  document.body.classList.add('platform-darwin');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#237a57',
          colorInfo: '#3b6f8f',
          colorSuccess: '#237a57',
          colorWarning: '#a56a19',
          colorError: '#b7443e',
          colorText: '#1d2521',
          colorTextSecondary: '#68736d',
          colorBgBase: '#f3f5f2',
          colorBgContainer: '#ffffff',
          colorBorder: '#dfe4df',
          borderRadius: 7,
          borderRadiusLG: 8,
          controlHeight: 36,
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif',
          fontSize: 14,
          lineHeight: 1.5,
          boxShadowSecondary: '0 16px 40px rgba(27, 39, 32, 0.14)',
        },
        components: {
          Button: {
            primaryShadow: 'none',
            defaultShadow: 'none',
            dangerShadow: 'none',
            fontWeight: 600,
          },
          Card: {
            headerFontSize: 15,
            headerFontSizeSM: 14,
            headerHeight: 52,
          },
          Menu: {
            itemBorderRadius: 7,
            itemHeight: 42,
            itemMarginInline: 10,
          },
          Table: {
            headerBg: '#f6f8f6',
            headerColor: '#5d6862',
            rowHoverBg: '#f4f8f5',
            borderColor: '#e7ebe7',
          },
          Segmented: {
            itemSelectedBg: '#ffffff',
            trackBg: '#e9eeea',
          },
        },
      }}
    >
      <AntApp>
        <App />
      </AntApp>
    </ConfigProvider>
  </React.StrictMode>
);
