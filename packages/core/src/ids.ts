/** 生成全局唯一 ID（UUID v4）。Node 与浏览器通用。 */
export function uuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // 降级方案：手动生成
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 当前时间 ISO 字符串（含时区偏移） */
export function nowIso(): string {
  return new Date().toISOString();
}
