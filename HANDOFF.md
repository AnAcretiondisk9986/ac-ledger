# AcLedger（Ac记账）项目交接文档

> 本文件供接手的 AI/开发者使用，内容自包含，无需额外上下文。
> 生成日期：2026-08-10。最后验证：43 项测试全绿、桌面版/Web 版在线。

---

## 1. 项目是什么

记账应用：支持 **桌面端（Electron）** 与 **Web 端（GitHub Pages）**，数据存储在 **GitHub 私有仓库 / WebDAV / 本机文件夹** 三种模式。支持微信、支付宝账单导入与月度统计。

### 线上地址（均已验证 HTTP 200）

| 入口 | 地址 |
|---|---|
| Web 版 | `https://anacretiondisk9986.github.io/ac-ledger/` |
| 桌面版 Release | `https://github.com/AnAcretiondisk9986/ac-ledger/releases/tag/v0.1.0` |
| 发行仓库（公开） | `https://github.com/AnAcretiondisk9986/ac-ledger` |
| 数据仓库（私有） | `https://github.com/AnAcretiondisk9986/ac-ledger-data` |

### 本机路径

```
C:\Users\AnAcretionDisk\Documents\Ac记账   ← 项目根（git 仓库，remote 指向发行仓库）
```

---

## 2. 架构与技术栈

npm workspaces monorepo，TypeScript（strict），Node 24，npm 11：

```
packages/core             记账核心（纯 TS）：数据模型/金额/分类树/统计
packages/storage          存储适配层：StorageAdapter 接口 + GitHub/WebDAV/Local 适配器
packages/bill-import      账单解析：微信（CSV/xlsx）+ 支付宝（GBK CSV）
apps/web                  Web 前端：Vite 5 + React 18 + antd 5 + zustand + recharts（HashRouter）
apps/desktop              Electron 33 壳：main.cjs / preload.cjs / fs-ipc.cjs
scripts/create-repos.mjs  一次性脚本（设备流建仓库，已用过可删）
.github/workflows/        release.yml（打 tag 自动打包发布）+ pages.yml（Web 部署）
```

**桌面端加载方式**：开发加载 `http://localhost:5173`（vite dev server）；打包后加载 `renderer/index.html`（file:// + HashRouter）。判断用 `app.isPackaged`，**绝不能用 NODE_ENV**（用户双击无该变量，曾导致白屏，见踩坑 #1）。

**Electron 安全基线**：`contextIsolation: true`、`sandbox: true`、`nodeIntegration: false`，所有能力经 preload 桥暴露（`window.acLedgerDesktop`）。

---

## 3. 常用命令

```bash
npm install                          # 首次；npm 11 下 postinstall 需 approve（见环境节）
npm test                             # vitest 全量（当前 43 项）
npm run typecheck                    # 全包类型检查
npm run build                        # 构建三个 package

cd apps/web && npm run dev           # Web 开发 http://localhost:5173
npm run dev -w @ac-ledger/desktop    # Electron 开发（自动起 vite + 窗口，热更新）
npm run dist -w @ac-ledger/desktop   # 打包安装包（需先 kill 正在运行的 Ac记账.exe）
```

手工打包（CI 外）：
```bash
cd apps/desktop
node scripts/prepare-app.cjs
ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" npx electron-builder --win
# 产物：release/win-unpacked/（目录版，唯一被实际验证可用的形态）
# 更新已安装版：cp -r release/win-unpacked/. "C:\Users\AnAcretiondisk\AppData\Local\Programs\ac-ledger-desktop\"
```

发新版：`git tag v0.2.0 && git push origin v0.2.0`（GitHub Actions 自动打包 + 上传 Release 草稿）。

---

## 4. 本机环境特性（接手者必读，否则会踩坑）

- **OS**：Windows 11，git bash 终端
- **网络**：本机 **直连 `github.com` 不通（超时）**，`api.github.com` 通；FlClash 代理运行在 `127.0.0.1:7890`
  - `curl` 需带 `-x http://127.0.0.1:7890` 或 `HTTPS_PROXY=http://127.0.0.1:7890`
  - **Node 的 fetch 不走代理会失败**（undici）；Electron 主进程 `net.fetch` 走 Chromium 网络栈（跟随系统代理，可用）
  - `gh` CLI 已登录（`AnAcretiondisk9986`，keyring 凭据，scopes 含 repo/workflow），git push 无鉴权问题
- **npm 11 阻止 postinstall**：装过 `esbuild`、`electron`、`app-builder-bin` 需 `npm approve-scripts <包名>`；`.npmrc` 已配置 `electron_mirror=https://npmmirror.com/mirrors/electron/`
- Node 24 / Python 3.14（PIL 可用，曾用于生成 apps/desktop/assets/icon.*）

---

## 5. 踩坑记录（重要，逐一验证过）

| # | 问题 | 根因 | 修复 |
|---|---|---|---|
| 1 | 桌面版双击**白屏** | 用 `NODE_ENV` 判断 dev/prod，用户环境无该变量 → 误连 localhost:5173 | 改用 `app.isPackaged`（main.cjs） |
| 2 | 白屏反复 | 用户双击的是**安装版快捷方式**（AppData\Local\Programs\ac-ledger-desktop，旧 asar），新包没覆盖 | 打包后必须覆盖该目录 |
| 3 | 白屏残留窗口 | 多开进程 + 无单实例锁 | `requestSingleInstanceLock()` + 二次实例聚焦 |
| 4 | 关闭窗口后进程残留 | — | `win.on('close', () => app.quit())` + `window-all-closed` |
| 5 | 设备流 `Failed to fetch` | **`github.com/login/device/*` 无 CORS 头**，渲染进程 fetch 必被浏览器拦截 | 设备流请求改走主进程 `net.fetch`，经 preload `deviceFlow` 桥暴露 |
| 6 | 「打开授权页面」无效 | `target="_blank"` 被 `setWindowOpenHandler(deny)` 拦截 | `shell.openExternal` IPC（preload `openExternal`） |
| 7 | electron-builder 打包破坏依赖树 | 它在 npm workspace 的 appDir 跑 `npm install --production` | 独立 `app/` 目录（`scripts/prepare-app.cjs`，无 devDependencies） |
| 8 | electron 二进制下载失败 | GitHub 直连不通 | `electronDownload.mirror`（build 配置）+ `.npmrc electron_mirror` |
| 9 | winCodeSign/nsis 下载失败 | 同上 | 打包命令带 `ELECTRON_BUILDER_BINARIES_MIRROR` |
| 10 | 便携版（portable）exe 白屏 | 自解压环节被系统安全软件静默阻断（英文路径也复现） | **放弃 portable**，分发 win-unpacked 目录版；portable 目标保留但未验证 |
| 11 | exceljs 类型不兼容 | 新版 @types/node 的 Buffer 泛型 | `as unknown as Parameters<typeof wb.xlsx.load>[0]` |
| 12 | 隐私：真实账单进公开仓库 | fixtures 含用户全部交易数据 | `.reasonix/`、`fixtures/*.xlsx|csv` 进 .gitignore；真实样本测试改 `describe.skipIf(!HAS_FIXTURE)` |
| 13 | vitest 路径 | 测试在 `src/__tests__/` 内，import 用 `../xxx.js`（不是 `../src/xxx.js`） | — |
| 14 | 支付宝汇总行解析失败 | 汇总行含逗号（`已支出:455笔,13727.52元`），过 parseCsv 后 join 丢逗号 | 汇总从原始文本行解析（`text.split(/\r?\n/)`） |
| 15 | GBK 编码 | 支付宝 CSV 是 GBK | `decodeCsvBytes`（UTF-8 含替换符时回退 GBK） |
| 16 | 微信 xlsx 日期 | exceljs 返回 Date 按本地时区解释 | 取本地字段拼 `YYYY-MM-DD HH:mm:ss`，后缀 `+08:00` |

---

## 6. 关键业务/数据约定

- **仓库数据布局**：`ledger.json`（账本元数据）、`accounts.json`、`categories.json`、`transactions/YYYY-MM.json`（按月分片）
- **Transaction**：`{ id(uuid), date(ISO+08:00), type: income|expense|transfer|neutral, amount(正数,元), currency, categoryId, accountId, counterparty, note, status: pending|completed|refunded|partially_refunded|failed, source: manual|wechat|alipay, refId(微信交易单号/支付宝交易号，去重键), createdAt, updatedAt }`
- 并发：GitHub 用 blob sha 乐观锁；冲突时 repository 自动拉远端合并重试（2 次）；导入按 `id`+`refId` 去重
- 微信账单：收/支 `/` = 中性交易；退款状态 `已退款¥x` 与 `已退款(¥x)` 两种写法兼容；头部「共N笔」校验
- 支付宝账单：收/支「不计收支」= neutral；状态 `退款成功`→refunded、`交易关闭`→failed、成功退款金额>0→partially_refunded；尾部汇总（已收入/待收入/已支出/待支出）
- 默认分类 14 个（收入 5 + 支出 9），初始化时写入 categories.json
- 一键连接：设备流授权 → `GET /user` 取 login → `ensureLedgerRepo` 建/查 `ac-ledger-data`（私有）→ connect

**GitHub OAuth**：client_id `Ov23li2olBGr9xuZi6ip`（公开，预置在 `apps/web/src/oauth-config.ts`），Device Flow 已启用。**设备流仅桌面版可用**（Web 版受 GitHub CORS 平台限制，只能手动 PAT）。

---

## 7. 诊断手段

- **主进程日志**：`%APPDATA%\ac-ledger-desktop\ac-ledger.log`（每次启动必写：加载路径、did-finish-load、渲染进程崩溃、renderer console）
- **SMOKE 模式**：`cd apps/desktop && SMOKE_TEST=1 ./release/win-unpacked/Ac记账.exe`，输出 `SMOKE_RENDER`（页面内容）/`SMOKE_OK`（存储桥往返）
- **DevTools**：F12 或 Ctrl+Shift+I（渲染进程）

---

## 8. 当前状态与待办

### 已完成（验收通过/已验证）
- [x] 核心记账（手动/导入/列表/编辑/统计/设置）
- [x] 三种存储（本地文件夹 / GitHub 一键连接 / WebDAV 表单）
- [x] 微信 983 笔 + 支付宝 611 笔真实样本解析（本地 fixture）
- [x] 桌面版白屏问题（含安装版快捷方式指向旧包的坑）
- [x] 设备流主进程转发、一键登录、打开授权页
- [x] GitHub Actions：tag 触发打包发布（v0.1.0 已发布）+ Pages 自动部署（已上线）
- [x] 隐私清理（.reasonix、真实账单不进公开仓库）

### 待办 / 建议
- [ ] 完整验收 11 步（本地记账→导入→持久化→GitHub 同步；步骤见 README 或历史）
- [ ] Web 版 GitHub 授权：受 GitHub CORS 限制设备流不可用；如需可加 Serverless 中转（Cloudflare Worker 持有 client_secret 做授权码流）
- [ ] electron-builder portable 目标在用户机器被安全软件阻断——可选深究或直接移除该 target
- [ ] 桌面版自动更新（electron-updater）
- [ ] 分类自动映射（导入时按商品名/商户名猜分类）、账户自动匹配（微信支付方式→账户）
- [ ] 移动端/PWA；数据导出（CSV 导出）
- [ ] 首次打开数据仓库后验证应用自动初始化（ledger.json 等）——仓库当前为空，应用 connect 时会写入

### 数据仓库状态
`ac-ledger-data` 目前为空仓库（应用首次一键连接时自动写入 ledger.json/categories.json）。

---

## 9. 交接给 GPT 时的建议开场

> 请阅读 `HANDOFF.md` 了解 AcLedger 项目全貌。当前任务是：______。
> 注意：本机 github.com 直连不通需走 127.0.0.1:7890 代理；npm 11 需 approve-scripts；
> 桌面版改动后必须重新打包并覆盖安装目录 + 桌面副本；隐私数据不得进公开仓库。
