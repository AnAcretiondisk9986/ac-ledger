import { useEffect, useState } from 'react';
import { Card, Form, Input, Radio, Button, Alert, Typography, Space, Divider } from 'antd';
import { GithubOutlined, CloudServerOutlined, FolderOutlined, FolderOpenOutlined, LoginOutlined } from '@ant-design/icons';
import { StorageConfig, StorageKind, loadSavedConfig, useStore } from '../store';
import OAuthDeviceModal from './OAuthDeviceModal';

interface FormValues {
  kind: StorageKind;
  owner?: string;
  repo?: string;
  token?: string;
  branch?: string;
  basePath?: string;
  rootDir?: string;
  url?: string;
  username?: string;
  password?: string;
}

/** FormValues → StorageConfig（过滤 undefined 字段） */
function toStorageConfig(values: FormValues): StorageConfig {
  if (values.kind === 'github') {
    return {
      kind: 'github',
      owner: values.owner ?? '',
      repo: values.repo ?? '',
      token: values.token ?? '',
      branch: values.branch || undefined,
      basePath: values.basePath || undefined,
    };
  }
  if (values.kind === 'local') {
    return { kind: 'local', rootDir: values.rootDir ?? '' };
  }
  return {
    kind: 'webdav',
    url: values.url ?? '',
    username: values.username || undefined,
    password: values.password || undefined,
    basePath: values.basePath || undefined,
  };
}

export default function SetupPage({ standalone = false }: { standalone?: boolean }) {
  const connect = useStore((s) => s.connect);
  const error = useStore((s) => s.error);
  const [loading, setLoading] = useState(false);
  const [oauthOpen, setOauthOpen] = useState(false);
  const [oneClick, setOneClick] = useState(false);
  const [oneClickLoading, setOneClickLoading] = useState(false);
  const connectGithubOneClick = useStore((s) => s.connectGithubOneClick);
  const [saved] = useState(() => loadSavedConfig());
  const [form] = Form.useForm<FormValues>();
  const [localRoot, setLocalRoot] = useState(saved?.kind === 'local' ? saved.rootDir : '');
  const desktopAvailable = typeof window !== 'undefined' && !!window.acLedgerDesktop;
  const kind = Form.useWatch('kind', form) ?? saved?.kind ?? 'github';

  useEffect(() => {
    if (kind !== 'local') return;
    const storage = window.acLedgerDesktop?.storage;
    if (!storage) return;
    void storage.rootDir().then((root) => {
      setLocalRoot(root);
      form.setFieldValue('rootDir', root);
    });
  }, [form, kind]);

  const chooseLocalRoot = async () => {
    const storage = window.acLedgerDesktop?.storage;
    if (!storage) return;
    const root = await storage.selectRootDir();
    if (!root) return;
    setLocalRoot(root);
    form.setFieldValue('rootDir', root);
  };

  const initialValues: FormValues = saved
    ? { ...saved, password: saved.kind === 'webdav' ? (saved.password ?? '') : '' }
    : { kind: 'github' };

  const onFinish = async (values: FormValues) => {
    setLoading(true);
    try {
      await connect(toStorageConfig(values));
    } finally {
      setLoading(false);
    }
  };

  const formContent = (
    <>
      <Form.Item name="kind" label="存储类型">
        <Radio.Group>
          <Radio.Button value="github">
            <GithubOutlined /> GitHub 仓库
          </Radio.Button>
          <Radio.Button value="webdav">
            <CloudServerOutlined /> WebDAV
          </Radio.Button>
          <Radio.Button value="local">
            <FolderOutlined /> 本机文件夹（桌面版）
          </Radio.Button>
        </Radio.Group>
      </Form.Item>

      {kind === 'local' && (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="本地模式（离线可用）"
            description={desktopAvailable ? '数据保存在你选择的本机文件夹中，不经过任何网络服务。' : '本地文件夹模式仅桌面版支持，请使用桌面应用连接。'}
          />
          <Form.Item name="rootDir" label="数据文件夹" rules={[{ required: true, message: '请选择数据文件夹' }]}>
            <Space.Compact block>
              <Input value={localRoot} readOnly placeholder="请选择文件夹" />
              <Button disabled={!desktopAvailable} icon={<FolderOpenOutlined />} onClick={() => void chooseLocalRoot()}>
                选择
              </Button>
            </Space.Compact>
          </Form.Item>
        </>
      )}

      {kind === 'github' ? (
        <>
          <Button
            type="primary"
            block
            icon={<GithubOutlined />}
            loading={oneClickLoading}
            onClick={() => {
              setOneClick(true);
              setOauthOpen(true);
            }}
            style={{ marginBottom: 16 }}
          >
            GitHub 一键登录连接（自动创建数据仓库）
          </Button>
          <Divider plain>或手动配置</Divider>
          <Form.Item name="owner" label="仓库所有者" rules={[{ required: true, message: '必填' }]}>
            <Input placeholder="GitHub 用户名或组织" />
          </Form.Item>
          <Form.Item name="repo" label="仓库名" rules={[{ required: true, message: '必填' }]}>
            <Input placeholder="如 my-ledger-data" />
          </Form.Item>
          <Form.Item
            name="token"
            label="访问令牌"
            rules={[{ required: true, message: '必填' }]}
            extra={
              <>
                Fine-grained token（仓库权限勾选 Contents: Read and write）或 OAuth App 授权 token。仅保存在本机浏览器。
                <Divider style={{ margin: '8px 0' }} />
                <Button
                  size="small"
                  icon={<LoginOutlined />}
                  onClick={() => setOauthOpen(true)}
                  style={{ marginBottom: 4 }}
                >
                  用 GitHub 账号授权（设备流，无需手动生成 token）
                </Button>
              </>
            }
          >
            <Input.Password placeholder="github_pat_xxx 或 gho_xxx" />
          </Form.Item>
          <Space.Compact block>
            <Form.Item name="branch" label="分支" style={{ flex: 1 }}>
              <Input placeholder="留空自动使用默认分支" />
            </Form.Item>
            <Form.Item name="basePath" label="数据目录" style={{ flex: 1 }}>
              <Input placeholder="可选，如 data" />
            </Form.Item>
          </Space.Compact>
        </>
      ) : kind === 'webdav' ? (
        <>
          <Form.Item name="url" label="WebDAV 地址" rules={[{ required: true, message: '必填' }]}>
            <Input placeholder="https://dav.jianguoyun.com/dav/" />
          </Form.Item>
          <Form.Item name="username" label="用户名" rules={[{ required: true, message: '必填' }]}>
            <Input placeholder="邮箱或账号" />
          </Form.Item>
          <Form.Item
            name="password"
            label="密码 / 应用密码"
            rules={[{ required: true, message: '必填' }]}
            extra="坚果云请在「安全选项」中生成应用密码。"
          >
            <Input.Password />
          </Form.Item>
          <Form.Item name="basePath" label="数据目录">
            <Input placeholder="可选，如 AcLedger" />
          </Form.Item>
        </>
      ) : null}

      {error && <Alert type="error" message={error} showIcon style={{ marginBottom: 16 }} />}
      <Button type="primary" htmlType="submit" loading={loading}>
        连接并初始化
      </Button>
    </>
  );

  const modal = (
    <OAuthDeviceModal
      open={oauthOpen}
      onClose={() => {
        setOauthOpen(false);
        setOneClick(false);
      }}
      onToken={async (token) => {
        if (oneClick) {
          // 一键模式：授权后自动获取用户名 → 确保仓库 → 连接
          setOauthOpen(false);
          setOneClickLoading(true);
          try {
            await connectGithubOneClick(token);
          } catch {
            setOneClickLoading(false);
            setOneClick(false);
          }
        } else {
          form.setFieldValue('token', token);
          setOauthOpen(false);
        }
      }}
    />
  );

  if (standalone) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5' }}>
        <Card style={{ width: 520 }}>
          <Typography.Title level={3} style={{ marginTop: 0 }}>
            Ac记账
          </Typography.Title>
          <Typography.Paragraph type="secondary">
            数据可存储在 GitHub 仓库、WebDAV 网盘或本机文件夹，首次使用请配置数据源。
          </Typography.Paragraph>
          <Form form={form} layout="vertical" initialValues={initialValues} onFinish={onFinish}>
            {formContent}
          </Form>
        </Card>
        {modal}
      </div>
    );
  }

  return (
    <Card title="数据源配置">
      <Form form={form} layout="vertical" initialValues={initialValues} onFinish={onFinish}>
        {formContent}
      </Form>
      {modal}
    </Card>
  );
}
