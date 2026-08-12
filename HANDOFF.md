# AcLedger（Ac记账）项目交接文档

> 本文件供接手的 AI/开发者使用，内容自包含，无需额外上下文。
> 生成日期：2026-08-10。最后更新：2026-08-12。最后验证：71 项测试全绿、类型检查与 Web 生产构建通过。

---

## 1. 项目是什么

记账应用：支持 **桌面端（Electron）** 与 **Web 端（GitHub Pages）**，数据存储在 **GitHub 私有仓库 / WebDAV / 本机文件夹** 三种模式。支持微信、支付宝账单导入与月度统计。

### 线上地址（均已验证 HTTP 200）

| 入口 | 地址 |
|---|---|
| Web 版 | `https://anacretiondisk9986.github.io/ac-ledger/` |
| 桌面版 Release | `https://github.com/AnAcretiondisk9986/ac-ledger/releases/latest` |
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
npm test                             # vitest 全量（当前 48 项）
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
| 17 | 微信 xlsx 导入提示“请使用 parseBill 并传入文件字节” | `parseBill` 对二进制先按 UTF-8 解码，再进入 `parseBillText`；xlsx 是 ZIP 二进制，因此被误判并主动报错 | `parseBill` 对 `Uint8Array`/`ArrayBuffer` 在文件名为 `.xlsx/.xls`、字节 ZIP 签名（`PK\\x03\\x04`）或 `kind: 'xlsx'` 时，直接调用 `parseWechatBill` → `readXlsxRows`（ExcelJS）；文本入口 `parseBillText` 仍只接受 CSV 文本并保留提示 |

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
- [x] 微信 XLSX 统一入口：页面将 `File.arrayBuffer()` 转为 `Uint8Array` 后调用 `parseBill(bytes, file.name)`；支持缺少文件名的 ZIP 字节和显式 `kind: 'xlsx'`
- [x] XLSX 回归验证：动态生成 ExcelJS 工作簿，统一入口成功解析交易数量和金额；bill-import 构建与全包类型检查通过
- [x] 桌面版白屏问题（含安装版快捷方式指向旧包的坑）
- [x] 设备流主进程转发、一键登录、打开授权页
- [x] GitHub Actions：tag 触发打包发布（v0.1.0 已发布）+ Pages 自动部署（已上线）
- [x] 隐私清理（.reasonix、真实账单不进公开仓库）

### 待办 / 建议
- [ ] 完整验收 11 步（本地记账→导入→持久化→GitHub 同步；步骤见 README 或历史）
- [ ] Web 版 GitHub 授权：受 GitHub CORS 限制设备流不可用；如需可加 Serverless 中转（Cloudflare Worker 持有 client_secret 做授权码流）
- [ ] electron-builder portable 目标在用户机器被安全软件阻断——可选深究或直接移除该 target
- [ ] 桌面版自动更新（electron-updater）
- [x] 分类自动映射（导入时按商品名/商户名猜分类）、账户自动匹配（微信支付方式/支付宝来源→已有账户）
- [ ] 移动端/PWA；数据导出（CSV 导出）
- [ ] 首次打开数据仓库后验证应用自动初始化（ledger.json 等）——仓库当前为空，应用 connect 时会写入

### 数据仓库状态
`ac-ledger-data` 已完成首次初始化，当前包含 `ledger.json` / `accounts.json` / `categories.json`，暂无交易月份文件。新仓库会在首次连接时自动初始化。

---

## 9. 原交接文档之后的变更（2026-08-10）

本节记录读取上一版交接文档后完成的全部修复，已按主题提交并推送（SSH，main 分支）。

### GitHub 一键连接

- `GitHubAdapter.testConnection()` 先读取仓库 `default_branch` 和 `size`，用户未填写分支时自动使用仓库默认分支，不再硬编码 `main`。
- 空仓库的 `GET /git/ref/heads/*` 返回 HTTP 409 时，结合仓库 `size === 0` 判定为“尚无分支”；首次 `PUT /contents/...` 不携带 `branch`，交由 GitHub 创建默认分支。非空仓库的真实分支缺失仍会报错，避免把半初始化仓库误判为空仓库。
- 记录 `branchExists`，空仓库阶段的读、列举、删除直接返回空结果；首次成功写入后切换为有分支状态。
- 将带 `sha`/`already exists` 的 HTTP 422 归类为并发冲突，保留仓库层的拉取、合并、重试逻辑。
- OAuth 用户响应增加 `login` 必填校验；自动创建数据仓库时使用 `auto_init: true`，确保后续 Contents API 可用。

### WebDAV

- 浏览器端仍使用 `WebDAVAdapter`；桌面端优先使用新增的 `DesktopWebDAVAdapter`，所有请求通过 Electron 主进程 `net.fetch` 执行，绕过渲染进程 CORS 限制。
- 新增 `packages/storage/src/webdav-desktop.ts`：实现 PROPFIND/GET/PUT/MKCOL/DELETE、命名空间兼容的 PROPFIND XML 解析、ETag 并发条件、401/403/404/412 错误映射，以及缺失基础目录和交易目录的自动创建。
- 新增 `apps/desktop/webdav-ipc.cjs`：限制请求方法和请求头，校验 HTTP/HTTPS URL 与路径，支持 Basic/Bearer 认证，并限制请求体/响应体最大 50 MB；通过 preload 暴露 `window.acLedgerDesktop.webdav.request`。
- `WebDAVAdapter` 的连通性检查改为先检查服务根目录，再创建 `basePath`；目录创建使用先检查后 `MKCOL`，不再依赖服务端的递归 MKCOL 扩展。
- `webdav-ipc.cjs` 已加入 Electron 打包 files 和 `prepare-app.cjs` 复制清单；`npmRebuild: false` 避免打包阶段重建 workspace 原生依赖。

### 本地文件夹模式

- 设置页新增桌面端“选择数据文件夹”按钮，选择结果持久化到 Electron `userData/local-storage.json`；未选择时仍默认使用 `userData/ledger-data`。
- `fs-ipc.cjs` 新增 `selectRootDir` IPC，读写、列表、删除和测试操作都做根目录边界校验，既支持相对路径也支持位于选定根目录内的绝对路径，防止 IPC 重复拼接绝对路径或目录逃逸。
- preload 和 `desktop.d.ts` 同步暴露 `selectRootDir`；本地模式配置会保存实际 `rootDir`，Web 端会提示该模式仅桌面版可用。

### 连接状态与初始化

- `LedgerRepository.initLedger()` 改为幂等补齐 `ledger.json`、`accounts.json`、`categories.json`，可修复上次连接中断造成的半初始化仓库，已有账本不会被覆盖。
- `store.connect()` 在初始化后并行读取账本、账户、分类、交易和月份，一次性提交 ready 状态；通过连接尝试编号忽略过期请求，断开时使进行中的请求失效。
- `autoConnect()` 使用共享 Promise，避免 React StrictMode 或重复挂载触发两次自动连接和重复初始化。
- 桌面端类型声明新增 WebDAV 桥和本地根目录选择桥；设置页 GitHub 分支留空时显示“自动使用默认分支”。

### 微信 XLSX 导入

- `ImportPage.tsx` 保持将 `File.arrayBuffer()` 转为 `Uint8Array`，调用 `parseBill(bytes, file.name)`；页面侧不再需要自行识别 XLSX。
- `parseBill()` 对二进制输入在 `.xlsx/.xls` 扩展名、ZIP 文件头 `PK\\x03\\x04` 或 `kind: 'xlsx'` 命中时直接调用 `parseWechatBill()`；不会再把 XLSX ZIP 先解码成 UTF-8。`parseBillText()` 仍只接受文本，并保留错误提示用于阻止错误调用。
- 新增统一入口回归测试：动态生成 ExcelJS XLSX，验证交易数量和金额；无文件名和显式 `kind` 的字节调用已通过端到端 smoke 验证。

### 验证与发布状态

- 新增 GitHub 空仓库、半初始化仓库、WebDAV XML/目录创建测试；交接记录的全量测试为 48/48。
- 最近验证：bill-import 构建、全包 `typecheck`、动态 XLSX 字节端到端解析、`git diff --check` 均通过。当前沙箱直接启动 Vitest 时被 esbuild 的目录权限限制拦截，非测试断言失败。
- GitHub 私有数据仓库 `ac-ledger-data` 已初始化 `ledger.json`、`accounts.json`、`categories.json`，暂无交易月份文件；真实测试交易已清理。
- 桌面目录版、安装版和桌面快捷方式此前已覆盖到修复后的构建；桌面版改动后仍必须重新打包并覆盖 `C:\Users\AnAcretiondisk\AppData\Local\Programs\ac-ledger-desktop`。
- WebDAV 尚未使用真实账号做端到端登录验证，当前仅完成协议模拟测试；接手者需要提供服务地址和凭据后再验收。

### 桌面化 UI（侧栏固定 + 去除网页感）

- `App.tsx` 布局重构：外层 `Layout` 由 `minHeight: 100vh` 改为 `height: 100vh + overflow: hidden`，`Content` 增加 `overflow: auto + flex: 1`，实现**侧栏固定、仅内容区独立滚动**；右侧 `Layout` 加 `minWidth: 0` 防表格撑破。
- 新增 `apps/web/src/global.css`（main.tsx 引入）：`body { user-select: none }`（input/textarea 保留）、`overscroll-behavior: none`、`-webkit-user-drag: none`、细窄圆角自定义滚动条、`html/body/#root { height: 100%; margin: 0 }`。
- `main.cjs` 桌面化：`Menu.setApplicationMenu(null)` 移除 Windows 默认菜单栏；`setVisualZoomLevelLimits(1, 1)` 禁 Ctrl+滚轮/捏合缩放；`before-input-event` 拦截 Ctrl+=/-/0 缩放快捷键（F12/Ctrl+Shift+I DevTools 保留）。
- 验证：web tsc、vite build、48 项测试全绿；桌面版需重新打包并覆盖安装目录后生效。

### 无边框窗口（自绘窗口控制）

- `main.cjs`：`frame: false` 隐藏系统标题栏与 ControlBox；新增 `ac-ledger:win:minimize/toggle-maximize/close` IPC；`maximize/unmaximize` 事件广播 `ac-ledger:win:maximized-changed` 给渲染进程切换按钮图标。
- `preload.cjs` 新增 `windowControls` 桥（minimize/toggleMaximize/close/onMaximizedChange）；`desktop.d.ts` 同步类型。
- 新增 `apps/web/src/WindowControls.tsx`：SVG 线条图标的最小化/最大化(还原)/关闭按钮（46×32，关闭键悬停变红），仅桌面端渲染（Web 版不显示）。
- `App.tsx`：Header 与侧栏 Logo 区为 `-webkit-app-region: drag` 拖拽区（交互元素 `no-drag`），双击标题栏空白处切换最大化/还原；首次配置页与连接中页顶部加 32px 拖拽条 + 窗口按钮（无边框窗口下这些页面也必须能拖动/关闭）。
- `global.css` 新增 `.app-region-drag/.app-region-no-drag/.win-btn` 样式。
- 注意：无边框窗口无系统标题栏，窗口移动靠顶部拖拽区；Alt+F4、任务栏右键菜单仍可用。桌面版需重新打包并覆盖安装目录后生效。

### 统计板块扩充

- `packages/core/src/stats.ts` 新增 `counterpartyBreakdown(transactions, kind)`：按交易对方聚合笔数与金额，按金额降序（空商户名归为「（无对方）」）；stats.test.ts 新增用例（全量 49 项测试）。
- `StatsPage.tsx` 新增三块统计（按此顺序置于收支趋势之前）：
  - **年度统计**：年份下拉（默认最新年），收入/支出/结余/笔数四卡片；
  - **支出商户统计**：全量支出按商户聚合表格（排名/商户/笔数/金额/占比，分页 10 条/页）；
  - **全账单收支统计**：全部账单收入/支出/结余/笔数 + 转账/中性说明。

### 商户名自动分类

- 新增 `packages/core/src/auto-category.ts`：`EXPENSE_AUTO_RULES`（餐饮/交通/购物/居住/娱乐/医疗/教育/人情/其他，约 140 关键词）与 `INCOME_AUTO_RULES`（工资/理财/红包/兼职/其他）；`guessCategoryName(text, type)` 做包含匹配（不区分大小写）；`applyAutoCategory(transactions, categories)` 仅填充未分类的收支交易，已分类/转账/中性不动，分类被重命名或删除时保持未分类。
- `ImportPage.tsx`：预览表格新增「自动分类」列展示猜测结果；确认导入时先 `applyAutoCategory` 再入库；解析成功提示中注明自动分类。
- 测试：`auto-category.test.ts` 5 个用例（全量 54 项测试）。

### 存量交易一键补分类

- `packages/storage/src/repository.ts` 新增 `updateTransactions(list)`：跨月分片批量更新（按 id 定位、一次读一次写），新增 `UpdateResult` 接口；repository.test.ts 新增跨月批量更新用例（全量 55 项测试）。
- `store.ts` 新增 `autoCategorizeUncategorized()`：对存量未分类的收支交易调用 `applyAutoCategory`，仅写有变化的交易，返回 `{ updated, unmatched }`。
- `TransactionsPage.tsx` 工具栏新增「按商户补分类（N）」按钮：Popconfirm 确认后一键补全，结果 message 提示（未匹配笔数）；无未分类交易时按钮禁用。

### 自定义匹配规则面板

- `packages/core/src/auto-category.ts`：`guessCategoryName` / `applyAutoCategory` 新增可选 `custom?: AutoCategoryRules` 参数（`{ income?, expense? }` 分组），**自定义规则优先于内置规则**；新增 `AutoCategoryRules` 类型与「自定义规则优先」测试。
- `packages/storage/src/repository.ts`：新增 `SettingsFile`（`settings.json`，含 `autoCategoryRules`）与 `getSettings()` / `saveSettings()`；repository.test.ts 新增读写用例。
- `store.ts`：新增 `autoRules` state（connect/refreshAll 时从 settings.json 加载），`saveAutoRules()` 写入仓库并立即生效；`autoCategorizeUncategorized()` 与导入路径均使用自定义规则。
- `SettingsPage.tsx` 新增「自动分类规则」卡片：自定义规则表格（类型/分类/关键词 Tags/删除）+ 添加表单（支出/收入、目标分类按类型联动、逗号分隔关键词），内置规则只读展示。规则存数据仓库，多设备同步。

### 统计日期范围筛选

- `StatsPage.tsx` 顶部新增全局「日期范围」筛选（RangePicker，快捷项：本月/本年/近一年，清空=全部账单），**所有统计区块联动**：月度统计（默认全部月份，可选范围内月份）、年度统计（年份选项=范围内年份）、支出商户统计、全账单收支统计（标注当前范围）、收支趋势（按月补全到范围起止）、支出分类占比。顶部实时显示当前范围与笔数。

### 保存性能优化

- **根因**：每次保存（导入/编辑/删除/补分类）后 `refreshAll()` 全量重拉——GitHub 模式下是 N 个月文件 + ledger/accounts/categories/settings + tree 列表 ≈ N+5 个串行请求；且 `writeFile` 每次写前都额外 GET 一次查 sha。
- `store.ts`：`addTransactions`/`updateTransaction`/`removeTransaction`/`autoCategorizeUncategorized` 改为**内存合并**（按 id/refId 去重、月份列表收窄），保存后不再全量刷新；编辑/删除/补分类的网络开销从 ~19 个请求降到 1-2 个。
- `github.ts`：新增文件 sha 缓存（GET 时记录、PUT 成功用响应更新、冲突/404 清除），写前免查询；同一文件的「读→写」连续操作（如 mergeMonth）从 2 个请求降为 1 个。github.test.ts 新增缓存命中测试（全量 58 项测试）。

### 双线存储（本地工作副本 + GitHub 仓库，仅桌面版）

- **写路径**：桌面版 GitHub 模式连接后，`LedgerRepository` 指向本地缓存目录（`userData/ledger-cache/<owner>-<repo>/`），操作只写本地（快、离线可用）；GitHub 只在「打开时同步」与「退出时提交」两个时机访问。
- **打开时 `syncAll()`**（`packages/storage/src/sync.ts` 新增 `LedgerSync`）：双向对比（本地 blob sha vs 远端 tree sha，`blobSha()` 与 GitHub blob sha 语义一致）——本地领先→补交上传；远端领先（其他端更改）→拉取下载；交易文件按月**并集合并**（id/refId 去重，写两端）；ledger/accounts/categories/settings 等配置**取较新**（远端 commit 时间 vs 本地 mtime）。同步失败不阻塞启动，以本地副本运行，退出时重试。
- **退出时 `pushAll()`**：主进程拦截 `close`（`sync.enable(true)` 后生效）→ 渲染进程执行 pushAll → 成功 `app.exit(0)`；失败弹窗三选：**重试 / 仍然退出（本地副本保留，下次打开自动补交）/ 取消**；30 秒超时兜底。
- **基础设施**：`github.ts` 新增 `getCommitDates()`（commits API 一次拿 path→时间）；`fs-ipc.cjs` 新增 `ac-ledger:fs-cache:*` 桥（slug 隔离、路径校验）+ list 返回 `mtimeMs`；`FileInfo`/`FileSystemOps`/`MemoryAdapter` 增加 mtimeMs；preload/`desktop.d.ts` 新增 `cacheStorage` 与 `sync` 桥；`store.ts` 新增 `githubSync` state 与退出监听。
- Web 版保持实时直连 GitHub（浏览器无本地目录）；WebDAV/本地模式不受影响。
- 测试：`sync.test.ts` 7 个用例（推送/拉取/并集/取新/一致跳过），全量 **66 项测试**。

### 图表类型切换

- `StatsPage.tsx` 两个图表 Card 的 extra 增加 `Segmented` 切换器：**收支趋势**支持 柱状图 ↔ 折线图（LineChart，monotone 曲线）；**支出分类占比**支持 饼图 ↔ 横向柱状图（分类名纵轴、金额横轴，颜色沿用饼图配色）。

### 账单搜索缺陷修复

- 缺陷：账单页只能按月份筛选，且关键词搜索框清除按钮不生效（antd `Input.Search` 的 `allowClear` 不触发 `onSearch`，清空输入后 keyword 状态仍保留）。
- `TransactionsPage.tsx`：月份下拉升级为**日期范围筛选**（RangePicker，与统计页一致，快捷项：本月/本年/近一年，清空=全部账单）；关键词搜索改为 `onChange` 实时过滤，清空输入立即恢复；默认仍选中最新月（转为该月起止日期）。

---

## 10. 交接给 GPT 时的建议开场

> 请阅读 `HANDOFF.md` 了解 AcLedger 项目全貌。当前任务是：______。
> 注意：本机 github.com 直连不通需走 127.0.0.1:7890 代理；npm 11 需 approve-scripts；
> 桌面版改动后必须重新打包并覆盖安装目录 + 桌面副本；隐私数据不得进公开仓库。
