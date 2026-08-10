/** Electron 主进程 WebDAV 请求桥：避免渲染进程的 CORS 限制。 */
const { ipcMain, net } = require('electron');

const ALLOWED_METHODS = new Set(['PROPFIND', 'GET', 'PUT', 'DELETE', 'MKCOL']);
const ALLOWED_HEADERS = new Set(['depth', 'content-type', 'if-match', 'if-none-match']);
const MAX_BODY_BYTES = 50 * 1024 * 1024;

function buildUrl(baseUrl, logicalPath) {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('WebDAV 地址无效');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('WebDAV 地址仅支持 http/https');
  }
  url.username = '';
  url.password = '';
  const parts = String(logicalPath || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.');
  if (parts.some((part) => part === '..')) throw new Error('WebDAV 路径非法');
  const basePath = url.pathname.replace(/\/+$/, '');
  const suffix = parts.map(encodeURIComponent).join('/');
  url.pathname = suffix ? `${basePath}/${suffix}` : `${basePath}/`;
  return url.toString();
}

function requestHeaders(config, input) {
  const headers = {};
  for (const [key, value] of Object.entries(input || {})) {
    if (ALLOWED_HEADERS.has(key.toLowerCase()) && typeof value === 'string') headers[key] = value;
  }
  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  } else if (config.username !== undefined || config.password !== undefined) {
    const basic = Buffer.from(`${config.username || ''}:${config.password || ''}`, 'utf8').toString('base64');
    headers.Authorization = `Basic ${basic}`;
  }
  return headers;
}

function registerWebDAVIpc() {
  ipcMain.handle('ac-ledger:webdav:request', async (_event, config, request) => {
    if (!config || typeof config.url !== 'string' || !request || typeof request.method !== 'string') {
      throw new Error('WebDAV 请求参数无效');
    }
    const method = request.method.toUpperCase();
    if (!ALLOWED_METHODS.has(method)) throw new Error(`WebDAV 方法不允许: ${method}`);
    const body = request.body === undefined ? undefined : String(request.body);
    if (body && Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
      throw new Error('WebDAV 请求体超过 50 MB');
    }
    const response = await net.fetch(buildUrl(config.url, request.path), {
      method,
      headers: requestHeaders(config, request.headers),
      body,
    });
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > MAX_BODY_BYTES) throw new Error('WebDAV 响应超过 50 MB');
    const responseBody = await response.text();
    if (Buffer.byteLength(responseBody, 'utf8') > MAX_BODY_BYTES) {
      throw new Error('WebDAV 响应超过 50 MB');
    }
    const headers = {};
    for (const name of ['etag', 'last-modified', 'content-length', 'content-type']) {
      const value = response.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      body: responseBody,
    };
  });
}

module.exports = { registerWebDAVIpc, buildUrl };
