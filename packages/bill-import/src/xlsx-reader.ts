import ExcelJS from 'exceljs';

/** exceljs 单元格值 → 字符串（与账单 CSV 列文本保持一致） */
function cellToString(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return formatDateTime(v);
  if (typeof v === 'object' && 'text' in (v as { text?: unknown })) {
    return String((v as { text: unknown }).text);
  }
  return String(v);
}

/** Date → "YYYY-MM-DD HH:mm:ss"（按本地时区字段拼接，账单为东八区展示） */
function formatDateTime(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** 读取 xlsx 第一个工作表为字符串二维数组 */
export async function readXlsxRows(data: Uint8Array | ArrayBuffer): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  // exceljs 的 load 只接受 Buffer/ArrayBuffer：把 Uint8Array 拷贝为独立 ArrayBuffer
  const buffer: ArrayBuffer = data instanceof ArrayBuffer ? data : (data.slice().buffer as ArrayBuffer);
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('xlsx 中没有工作表');
  const rows: string[][] = [];
  ws.eachRow((row) => {
    const cells: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      cells.push(cellToString(cell.value));
    });
    rows.push(cells);
  });
  return rows;
}
