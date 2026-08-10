/**
 * 一次性脚本：设备流授权 → 创建发行仓库 + 数据仓库 → 初始化。
 * 用法：node create-repos.mjs
 */
const CLIENT_ID = 'Ov23li2olBGr9xuZi6ip';

async function postForm(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json' },
    body: new URLSearchParams(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return res.json();
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ac-ledger-setup',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.status === 204 ? null : res.json();
}

let TOKEN = '';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // 1. 请求设备码
  const device = await postForm('https://github.com/login/device/code', {
    client_id: CLIENT_ID,
    scope: 'repo',
  });
  console.log(`USER_CODE=${device.user_code}`);
  console.log(`VERIFY_URL=${device.verification_uri}`);
  console.log(`EXPIRES_IN=${device.expires_in}s INTERVAL=${device.interval}s`);

  // 2. 轮询等待用户授权
  let interval = Number(device.interval ?? 5);
  const deadline = Date.now() + Number(device.expires_in ?? 900) * 1000;
  for (;;) {
    await sleep(interval * 1000);
    const r = await postForm('https://github.com/login/oauth/access_token', {
      client_id: CLIENT_ID,
      device_code: device.device_code,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    });
    if (r.access_token) {
      TOKEN = r.access_token;
      break;
    }
    if (r.error === 'slow_down') interval += 5;
    if (r.error === 'expired_token' || Date.now() > deadline) {
      throw new Error('设备码已过期，请重新运行脚本');
    }
    if (r.error === 'access_denied') throw new Error('用户拒绝授权');
    if (r.error !== 'authorization_pending') throw new Error(`轮询错误: ${JSON.stringify(r)}`);
  }
  console.log('TOKEN_OK');

  // 3. 获取用户信息
  const user = await api('https://api.github.com/user');
  const login = user.login;
  console.log(`LOGIN=${login}`);

  // 4. 创建发行仓库（公开）
  try {
    await api('https://api.github.com/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: 'ac-ledger',
        description: 'Ac记账 — 支持桌面端与 Web 端的记账应用（GitHub/WebDAV/本地存储）',
        private: false,
        has_issues: true,
        has_wiki: false,
      }),
    });
    console.log('REPO_CREATED ac-ledger (public)');
  } catch (e) {
    if (e.message.includes('422') && (await repoExists(login, 'ac-ledger'))) {
      console.log('REPO_EXISTS ac-ledger');
    } else throw e;
  }

  // 5. 创建数据仓库（私有）
  try {
    await api('https://api.github.com/user/repos', {
      method: 'POST',
      body: JSON.stringify({
        name: 'ac-ledger-data',
        description: 'Ac记账 数据仓库（ledger.json / accounts.json / categories.json / transactions/）',
        private: true,
      }),
    });
    console.log('REPO_CREATED ac-ledger-data (private)');
  } catch (e) {
    if (e.message.includes('422') && (await repoExists(login, 'ac-ledger-data'))) {
      console.log('REPO_EXISTS ac-ledger-data');
    } else throw e;
  }

  // 6. 初始化发行仓库 README
  const readme = `# Ac记账

支持**桌面端**与 **Web 端**的记账应用。

- 数据存储：GitHub 仓库（私有）/ WebDAV / 本机文件夹
- 导入：微信账单（CSV/xlsx）、支付宝账单（CSV）
- 统计：月度汇总、收支趋势、分类占比

## 发行

- 桌面版：下载 release 中的安装包 / 便携版
- Web 版：GitHub Pages 部署

数据仓库：[\`ac-ledger-data\`](https://github.com/${login}/ac-ledger-data)（私有，仅本人可见）
`;
  await api(`https://api.github.com/repos/${login}/ac-ledger/contents/README.md`, {
    method: 'PUT',
    body: JSON.stringify({
      message: 'init: README',
      content: Buffer.from(readme, 'utf8').toString('base64'),
    }),
  });
  console.log('README_INITIALIZED');

  console.log('ALL_DONE');
  console.log(`RELEASE_REPO=https://github.com/${login}/ac-ledger`);
  console.log(`DATA_REPO=https://github.com/${login}/ac-ledger-data`);
}

async function repoExists(login, name) {
  try {
    await api(`https://api.github.com/repos/${login}/${name}`);
    return true;
  } catch {
    return false;
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(`FAILED: ${e.message}`);
    process.exit(1);
  }
);
