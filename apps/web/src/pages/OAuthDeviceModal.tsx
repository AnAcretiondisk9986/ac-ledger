import { useEffect, useRef, useState } from 'react';
import { Modal, Input, Button, Typography, Space, Alert, Steps, App as AntApp } from 'antd';
import { CopyOutlined, LinkOutlined } from '@ant-design/icons';
import {
  DeviceCodeResponse,
  deviceVerifyUrl,
  pollAccessToken,
  requestDeviceCode,
} from '../github-oauth';
import { DEFAULT_GITHUB_CLIENT_ID } from '../oauth-config';

const CLIENT_ID_KEY = 'ac-ledger:github-client-id';

function loadClientId(): string {
  try {
    return localStorage.getItem(CLIENT_ID_KEY) ?? DEFAULT_GITHUB_CLIENT_ID;
  } catch {
    return DEFAULT_GITHUB_CLIENT_ID;
  }
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** 授权成功回调（返回 access_token） */
  onToken: (token: string) => void;
}

type Step = 'form' | 'waiting' | 'done' | 'error';

export default function OAuthDeviceModal({ open, onClose, onToken }: Props) {
  const { message } = AntApp.useApp();
  const [clientId, setClientId] = useState(loadClientId);
  const [step, setStep] = useState<Step>('form');
  const [device, setDevice] = useState<DeviceCodeResponse | null>(null);
  const [error, setError] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<() => Promise<void>>();

  const stopPolling = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  useEffect(() => {
    if (!open) {
      stopPolling();
      setStep('form');
      setDevice(null);
      setError('');
    }
    return stopPolling;
  }, [open]);

  const start = async () => {
    if (!clientId.trim()) {
      message.warning('请填写 client_id');
      return;
    }
    localStorage.setItem(CLIENT_ID_KEY, clientId.trim());
    setError('');
    setStep('waiting');
    try {
      const res = await requestDeviceCode(clientId.trim());
      setDevice(res);
      await beginPolling(res, clientId.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : '请求设备码失败');
      setStep('error');
    }
  };

  const beginPolling = async (dev: DeviceCodeResponse, cid: string) => {
    let interval = dev.interval;
    pollRef.current = async () => {
      try {
        const r = await pollAccessToken(cid, dev.device_code);
        if (r.status === 'ok') {
          setStep('done');
          onToken(r.accessToken);
          message.success('授权成功');
          return;
        }
        if (r.status === 'slow_down') interval = r.interval;
        if (r.status === 'expired') {
          setError('设备码已过期，请重新发起授权');
          setStep('error');
          return;
        }
        if (r.status === 'denied') {
          setError('你已拒绝授权');
          setStep('error');
          return;
        }
        timerRef.current = setTimeout(() => void pollRef.current?.(), interval * 1000);
      } catch (e) {
        setError(e instanceof Error ? e.message : '轮询失败');
        setStep('error');
      }
    };
    timerRef.current = setTimeout(() => void pollRef.current?.(), interval * 1000);
  };

  const copyCode = () => {
    if (!device) return;
    void navigator.clipboard?.writeText(device.user_code);
    message.success('已复制');
  };

  return (
    <Modal
      title="用 GitHub 账号授权（设备流）"
      open={open}
      onCancel={onClose}
      footer={step === 'waiting' || step === 'done' ? null : undefined}
    >
      {step === 'form' && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Paragraph type="secondary">
            填写你注册的 OAuth App 的 Client ID（Settings → Developer settings → OAuth Apps）。
            授权后获得的 token 会自动填入上方「访问令牌」输入框，仅保存在本机。
          </Typography.Paragraph>
          <Input
            placeholder={`默认: ${DEFAULT_GITHUB_CLIENT_ID}`}
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
          />
          <Button type="primary" block onClick={() => void start()}>
            开始授权
          </Button>
        </Space>
      )}

      {step === 'waiting' && device && (
        <Space direction="vertical" style={{ width: '100%' }} size="middle">
          <Typography.Text>请在打开的页面中输入以下代码完成授权：</Typography.Text>
          <Typography.Title level={2} style={{ textAlign: 'center', letterSpacing: 4, margin: 0 }}>
            {device.user_code}
          </Typography.Title>
          <Space style={{ justifyContent: 'center', width: '100%' }}>
            <Button icon={<CopyOutlined />} onClick={copyCode}>
              复制代码
            </Button>
            <Button
              type="primary"
              icon={<LinkOutlined />}
              onClick={() => {
                const url = device.verification_uri || deviceVerifyUrl();
                // 桌面版：经主进程 shell.openExternal 打开（Electron 拦截新窗口，不能 target=_blank）
                if (window.acLedgerDesktop?.openExternal) {
                  void window.acLedgerDesktop.openExternal(url);
                } else {
                  window.open(url, '_blank', 'noopener,noreferrer');
                }
              }}
            >
              打开授权页面
            </Button>
          </Space>
          <Alert type="info" showIcon message="等待授权中…（自动轮询，无需刷新页面）" />
        </Space>
      )}

      {step === 'done' && (
        <Alert type="success" showIcon message="授权成功，token 已填入表单，点击下方「连接并初始化」即可。" />
      )}

      {step === 'error' && (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert type="error" showIcon message={error} />
          <Button onClick={() => setStep('form')}>重新发起</Button>
        </Space>
      )}
    </Modal>
  );
}
