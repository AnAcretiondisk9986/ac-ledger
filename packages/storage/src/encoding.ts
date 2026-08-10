/** UTF-8 字符串 ↔ base64（Node 与浏览器通用） */
export function encodeBase64(text: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(text, 'utf8').toString('base64');
  }
  // 浏览器：TextEncoder → 二进制串 → btoa
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function decodeBase64(b64: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(b64, 'base64').toString('utf8');
  }
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** 拼接路径（统一 "/" 分隔，去空段） */
export function joinPath(...parts: (string | undefined)[]): string {
  return parts
    .filter((p): p is string => !!p)
    .map((p) => p.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');
}
