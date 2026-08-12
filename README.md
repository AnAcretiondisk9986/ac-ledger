# Ac记账

支持**桌面端（Electron）**与 **Web 端**的记账软件。数据以 JSON 文件形式存储在 **GitHub 仓库**、**WebDAV 网盘**或**本机文件夹**中，无需自建服务器，跨设备同步。

## 架构

```
┌─ 桌面版 (Electron 壳) ──┐   ┌─ Web 版 (Vite + React，可部署 GitHub Pages) ─┐
│           同一套 React 前端              │
└────────────┬────────────────────────────┘
             ▼
  packages/core            记账核心（纯 TS）：数据模型、金额、分类、统计
             ▼
  packages/storage         存储适配层：GitHub / WebDAV / 本地文件 / 内存
             ▼
  packages/bill-import   账单导入解析器（微信 CSV/xlsx + 支付宝 CSV）
```

npm workspaces monorepo：

| 包 | 说明 |
|---|---|
| `@ac-ledger/core` | 数据模型（交易/账户/分类/账本）、金额工具、统计、分类树 |
| `@ac-ledger/storage` | `StorageAdapter` 接口 + `LedgerRepository` 数据仓库 + GitHub/WebDAV/本地/内存适配器 |
| `@ac-ledger/bill-import` | 账单解析（微信 CSV/xlsx + 支付宝 CSV，含真实样本测试） |
| `apps/web` | Web 前端（Vite + React + antd）：记账/账单/导入/统计/设置 |
| `apps/desktop` | 桌面壳（Electron）：复用同一前端，开发/生产双模式 |

## 桌面端（Electron）

```bash
npm run dev -w @ac-ledger/desktop   # 一条命令：起 vite dev + Electron 窗口（热更新）
# 生产模式（加载 apps/web/dist）：
npm run build -w @ac-ledger/web
NODE_ENV=production electron apps/desktop   # 或 npm run start -w @ac-ledger/desktop
```

- 主进程 `apps/desktop/main.cjs`：开发加载 `http://localhost:5173`，生产加载 `renderer/index.html`（HashRouter 兼容 file://；打包时由 `scripts/prepare-app.cjs` 将 Web 构建产物复制到 `app/renderer`）
- 安全基线：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，渲染进程仅通过 preload 暴露最小平台信息

### GitHub 授权（OAuth 设备流，纯前端）

设置页 GitHub 分支的「用 GitHub 账号授权」：填写 OAuth App 的 `client_id` 后，应用展示一次性代码 → 打开 `github.com/login/device` 输入授权 → 自动轮询获取 token 并填入表单。

- 注册 OAuth App 时务必勾选 **Enable Device Flow**；Authorization callback URL 必填但设备流不实际使用（填 `http://localhost:5173/callback` 占位即可）
- 设备流全程仅需 `client_id`，无需 `client_secret`（官方文档明确），token 仍只存本机
- 请求用 `application/x-www-form-urlencoded`（简单请求），规避 GitHub 不支持 CORS preflight 的限制

### 本地文件存储（离线模式）

桌面版可在设置中选择「本机文件夹」：数据存于 `userData/ledger-data`，完全离线可用。

- 主进程 `fs-ipc.cjs` 注册 fs / fs-cache 两套桥（路径逃逸防护，渲染进程只能访问数据目录内相对路径；fs-cache 为 GitHub 模式本地缓存目录，按仓库 slug 隔离）
- preload 以 `FileSystemOps` 形状暴露 `window.acLedgerDesktop.storage` / `cacheStorage` 桥
- `@ac-ledger/storage/local`：浏览器安全的 LocalAdapter（ops 注入）；`./local-node`：Node 默认实现
- Web 版不显示本地选项（`window.acLedgerDesktop` 仅桌面存在）

### 双线存储（GitHub 模式，桌面版）

桌面版连接 GitHub 后，写入先落在**本地工作副本**（`userData/ledger-cache/<owner>-<repo>/`），操作快且离线可用；GitHub 仓库只在两个时机访问：

- **打开时同步**：双向对比本地与远端（blob sha），本地领先→补交上传，远端领先（其他端更改）→拉取下载；交易文件按月**并集合并**（按 id/refId 去重），配置类文件取较新；同步失败不阻塞启动，退出时重试
- **退出时提交**：主进程拦截关闭 → 渲染进程执行 `pushAll()` → 成功退出；失败弹窗三选（重试 / 仍然退出（本地副本保留，下次打开自动补交）/ 取消），30 秒超时兜底

Web 版保持实时直连 GitHub（浏览器无本地目录）。

### 无边框窗口

桌面版隐藏系统标题栏（`frame: false`），窗口控制（最小化/最大化/关闭）自绘到界面顶部拖拽区，通过 `windowControls` IPC 桥控制主进程窗口；顶部区域可拖拽移动窗口。

### 打包安装包（electron-builder）

```bash
npm run dist -w @ac-ledger/desktop   # 产出 release/：安装包 Setup + 便携版 + win-unpacked
```

产物：`release/Ac记账 Setup <版本>.exe`（NSIS 安装包）、`release/Ac记账 <版本>.exe`（便携版）、`release/win-unpacked/`（目录版）。版本号来自 git tag（如 `v0.2.1` → `0.2.1`），CI 与本地打包均自动解析。

注意（网络镜像，本机已验证）：
- electron 二进制下载走 `electronDownload.mirror = https://npmmirror.com/mirrors/electron/`（已固化在 build 配置）
- electron-builder 工具（winCodeSign/nsis）走 `ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/`（打包命令需带该环境变量）
- 打包使用独立 `app/` 目录（`scripts/prepare-app.cjs` 构建），避免 electron-builder 在 npm workspace 内跑 `npm install` 破坏依赖树

## Web 端

```bash
cd apps/web
npm run dev      # 开发（http://localhost:5173）
npm run build    # 产物在 apps/web/dist，可部署 GitHub Pages（已用相对路径 base）
```

功能：

- **数据源配置**：GitHub 仓库 / WebDAV，配置存 localStorage，自动重连
- **记账**：手动记一笔（收支/转账/中性 + 分类/账户/备注），连续记账自动清空表单
- **账单**：日期范围筛选（快捷：本月/本年/近一年，清空=全部）、类型/关键词实时筛选、行内编辑删除、收支汇总
- **导入**：微信/支付宝文件拖拽上传 → 解析预览 → 按交易单号去重后批量导入；导入时按商户名自动匹配分类，并按支付方式/账单来源匹配已有账户
- **统计**：全局日期与账户筛选、月度/年度/全账单收支、商户与分类统计、各账户收支对比、账户支出占比和月度变化趋势
- **设置**：账户与分类管理、自动分类自定义规则（类型/分类/关键词，可删除）
- **其他**：存量未分类交易一键按商户补分类；自动分类规则随仓库多设备同步

## 快速开始

```bash
npm install
npm test          # vitest 全部测试
npm run typecheck # 类型检查
npm run build     # 构建全部包
```

## 数据格式（GitHub 仓库内布局）

```
<仓库根>/
├── ledger.json          # 账本元数据 { version, ledger: { id, name, currency } }
├── accounts.json        # 账户列表
├── categories.json      # 分类列表（首次初始化写入默认分类）
├── settings.json        # 设置（自动分类自定义规则 autoCategoryRules）
└── transactions/
    └── 2026-08.json     # 交易按月分片 { version, month, transactions: [...] }
```

交易对象（与微信账单字段对齐，便于导入）：

```ts
interface Transaction {
  id: string;            // UUID
  date: string;          // "2026-08-10T07:17:06+08:00"
  type: 'income' | 'expense' | 'transfer' | 'neutral';
  amount: number;        // 正数，单位元
  currency: string;      // "CNY"
  categoryId: string | null;
  accountId: string | null;
  counterparty: string;  // 交易对方
  note: string;          // 商品/备注
  status: 'pending' | 'completed' | 'refunded' | 'partially_refunded' | 'failed';
  source: 'manual' | 'wechat' | ...;
  refId?: string;        // 原始凭证号（如微信交易单号），用于跨文件去重
  createdAt: string;
  updatedAt: string;
}
```

按月分片的好处：git 增量小、并发写冲突范围小、加载快。多用户/多账本通过**不同的仓库或 basePath 目录**隔离。

## GitHub 存储配置

1. 创建（或复用）一个仓库，如 `my-ledger-data`
2. 生成 Personal Access Token：
   - GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens**
   - 仓库权限勾选 **Contents: Read and write**
3. 配置示例（代码层）：

```ts
import { GitHubAdapter, LedgerRepository } from '@ac-ledger/storage';

const adapter = new GitHubAdapter({
  owner: 'your-name',
  repo: 'my-ledger-data',
  token: 'github_pat_xxx',   // 仅存本地，勿提交到仓库
  branch: 'main',
  basePath: 'data',          // 可选：数据放仓库 data/ 目录
});
const repo = new LedgerRepository(adapter);
await repo.initLedger({ name: '我的账本' });
await repo.addTransactions(parsedTransactions);
```

⚠️ 桌面端 Token 存于本机配置；Web 端用 GitHub OAuth App 授权（设备流，详见上文「GitHub 授权」）。

## WebDAV 配置（坚果云等）

```ts
import { WebDAVAdapter, LedgerRepository } from '@ac-ledger/storage';

const adapter = new WebDAVAdapter({
  url: 'https://dav.jianguoyun.com/dav/',
  username: 'you@example.com',
  password: '应用密码',     // 坚果云需在「安全选项」中生成应用密码
  basePath: 'AcLedger',
});
const repo = new LedgerRepository(adapter);
```

WebDAV 用 etag 做乐观锁（If-Match 条件写），与 GitHub 的 sha 机制语义一致。

## 并发与冲突策略

- 写文件携带乐观锁（GitHub blob sha / WebDAV etag）
- 冲突时 `LedgerRepository` 自动**重新拉取远端 → 按 id/refId 合并 → 重试**（最多 2 次）
- 交易导入按 `id` 与 `refId`（微信交易单号）去重，可安全重复导入

## 账单导入（微信 / 支付宝）

```ts
import { parseBill } from '@ac-ledger/bill-import';
import { LedgerRepository } from '@ac-ledger/storage';

// 自动识别微信/支付宝账单（按文件内容，无需指定类型）
const result = await parseBill(fileBytes, 'wechat-bill.xlsx'); // 或 alipay.csv
// result.transactions: Transaction[]
// result.header:  微信账单头部统计（昵称/笔数/收支）
// result.summary: 支付宝尾部汇总（已收入/已支出/待支出…）
await repo.addTransactions(result.transactions); // 自动按 refId 去重
```

| 特性 | 微信 | 支付宝 |
|---|---|---|
| 支持格式 | 官方 CSV + xlsx | 官方 CSV（GBK 编码自动识别） |
| 表头 | 11 列 | 16 列 |
| 中性交易 | 收/支 = `/` | 收/支 = `不计收支` |
| 状态映射 | 已全额退款/已退款¥x/已退款(x) | 退款成功/交易关闭/成功退款金额 |
| 统计校验 | 头部「共N笔记录」 | 尾部「已收入/已支出:N笔,x元」 |
| 特殊处理 | 表头按内容定位 | padding 空格/tab trim、商品名内嵌逗号容错合并 |

两个真实样本（微信 983 笔 xlsx、支付宝 611 笔 GBK CSV）作为测试 fixture 全量验证。

## 路线图

已实现：桌面端 + Web 端、GitHub OAuth 设备流、三种存储（GitHub / WebDAV / 本机文件夹）、账单导入与自动分类、统计看板。后续计划：

- [ ] 桌面版自动更新（electron-updater）
- [ ] 数据导出（CSV 导出）
- [ ] 移动端 / PWA
- [ ] Web 版 GitHub 授权码流（受 GitHub CORS 限制设备流不可用于 Web，需 Serverless 中转）
- [ ] 账户自动匹配（导入时按支付方式映射账户）
