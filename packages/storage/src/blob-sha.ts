/**
 * GitHub blob SHA 计算：sha1("blob " + 字节数 + "\0" + 内容)。
 * 与 GitHub git/trees 与 contents API 返回的 sha 一致，可用于本地↔远端版本对比。
 * 依赖 Web Crypto（浏览器与 Node 20+ 均可用）。
 */
export async function blobSha(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const prefix = new TextEncoder().encode(`blob ${data.length}\0`);
  const buf = new Uint8Array(prefix.length + data.length);
  buf.set(prefix, 0);
  buf.set(data, prefix.length);
  const digest = await crypto.subtle.digest('SHA-1', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
