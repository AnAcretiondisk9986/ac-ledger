/**
 * CSV 解析（RFC 4180 子集）：支持引号包裹、"" 转义、引号内换行、BOM。
 * 微信账单导出的 CSV 用英文逗号分隔。
 */

/** 解析 CSV 文本为二维数组 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** 去除 UTF-8 BOM */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/**
 * 字节解码：优先 UTF-8；若出现替换符则尝试 GBK（中文 Windows 下 Excel 另存的 CSV 常为 GBK）。
 * Node 与浏览器 TextDecoder 均支持 "gbk"。
 */
export function decodeCsvBytes(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    const gbk = new TextDecoder('gbk').decode(bytes);
    return gbk;
  } catch {
    return utf8;
  }
}
