import type { Worker } from 'tesseract.js';
import type { OcrTextLine, OcrTransactionCandidate, OcrBillPlatform } from '@ac-ledger/bill-import';
import { parseOcrScreenshot } from '@ac-ledger/bill-import';

export interface OcrProgress {
  stage: 'loading' | 'recognizing' | 'parsing';
  progress: number;
}

interface OcrPageData {
  text: string;
  blocks?: Array<{
    paragraphs?: Array<{
      lines?: Array<{
        text: string;
        confidence: number;
        bbox: { x0: number; y0: number; x1: number; y1: number };
      }>;
    }>;
  }> | null;
}

let workerPromise: Promise<Worker> | null = null;

function ocrAsset(name: string): string {
  return new URL(`ocr-assets/${name}`, document.baseURI).href;
}

async function getWorker(onProgress?: (progress: OcrProgress) => void): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(async ({ createWorker, PSM }) => createWorker('chi_sim', 1, {
      workerPath: ocrAsset('worker.min.js'),
      corePath: ocrAsset('.'),
      langPath: ocrAsset('.'),
      cachePath: 'ac-ledger-ocr',
      gzip: true,
      logger: (message) => {
        const stage = message.status.includes('recognizing') ? 'recognizing' : 'loading';
        onProgress?.({ stage, progress: message.progress });
      },
    }).then(async (worker) => {
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SPARSE_TEXT,
        preserve_interword_spaces: '1',
        user_defined_dpi: '300',
      });
      return worker;
    })).catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

function imageSize(file: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const url = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve({ width: image.naturalWidth, height: image.naturalHeight });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('无法读取截图尺寸'));
    };
    image.src = url;
  });
}

async function prepareScreenshot(file: Blob): Promise<{ original: Blob; enhanced: Blob; binary: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = bitmap.width < 900 ? Math.min(2.2, 1600 / bitmap.width) : 1;
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('当前环境不支持截图预处理');
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const original = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('截图预处理失败')), 'image/png');
  });

  // 手机账单的次要文字通常是浅灰色；温和增强对比度可显著改善日期识别，同时保留抗锯齿。
  const originalPixels = context.getImageData(0, 0, width, height);
  const pixels = new ImageData(new Uint8ClampedArray(originalPixels.data), width, height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const red = pixels.data[index] ?? 255;
    const green = pixels.data[index + 1] ?? 255;
    const blue = pixels.data[index + 2] ?? 255;
    const grey = 0.299 * red + 0.587 * green + 0.114 * blue;
    const adjusted = grey > 248 ? 255 : Math.max(0, Math.min(255, (grey - 220) * 2.2 + 220));
    pixels.data[index] = adjusted;
    pixels.data[index + 1] = adjusted;
    pixels.data[index + 2] = adjusted;
  }
  context.putImageData(pixels, 0, 0);
  const enhanced = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('截图预处理失败')), 'image/png');
  });

  const binaryPixels = new ImageData(new Uint8ClampedArray(originalPixels.data), width, height);
  for (let index = 0; index < binaryPixels.data.length; index += 4) {
    const grey = 0.299 * (binaryPixels.data[index] ?? 255)
      + 0.587 * (binaryPixels.data[index + 1] ?? 255)
      + 0.114 * (binaryPixels.data[index + 2] ?? 255);
    const value = grey < 238 ? 0 : 255;
    binaryPixels.data[index] = value;
    binaryPixels.data[index + 1] = value;
    binaryPixels.data[index + 2] = value;
  }
  context.putImageData(binaryPixels, 0, 0);
  const binary = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('截图预处理失败')), 'image/png');
  });
  return { original, enhanced, binary, width, height };
}

function intersectionOverUnion(a: OcrTextLine['bbox'], b: OcrTextLine['bbox']): number {
  const width = Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const height = Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  const intersection = width * height;
  const union = (a.x1 - a.x0) * (a.y1 - a.y0) + (b.x1 - b.x0) * (b.y1 - b.y0) - intersection;
  return union > 0 ? intersection / union : 0;
}

function mergeLines(primary: OcrTextLine[], secondary: OcrTextLine[]): OcrTextLine[] {
  const merged = [...primary];
  for (const candidate of secondary) {
    const overlapIndex = merged.findIndex((line) => intersectionOverUnion(line.bbox, candidate.bbox) > 0.58);
    if (overlapIndex < 0) merged.push(candidate);
    else if ((merged[overlapIndex]?.confidence ?? 0) < candidate.confidence) merged[overlapIndex] = candidate;
  }
  return merged;
}

function flattenLines(data: OcrPageData): OcrTextLine[] {
  return (data.blocks ?? []).flatMap((block) =>
    (block.paragraphs ?? []).flatMap((paragraph) =>
      (paragraph.lines ?? []).map((line) => ({
        text: line.text,
        confidence: line.confidence,
        bbox: line.bbox,
      }))
    )
  );
}

/** 单张截图识别。Worker 复用，连续导入多张图时只初始化一次。 */
export async function recognizeScreenshot(
  file: Blob,
  platform: OcrBillPlatform,
  sourceName: string,
  referenceDate = new Date(),
  onProgress?: (progress: OcrProgress) => void
): Promise<OcrTransactionCandidate[]> {
  const worker = await getWorker(onProgress);
  const fallbackSize = await imageSize(file);
  const prepared = await prepareScreenshot(file).catch(() => ({ original: file, enhanced: file, binary: file, ...fallbackSize }));
  onProgress?.({ stage: 'recognizing', progress: 0 });
  const result = await worker.recognize(prepared.original, {}, { text: true, blocks: true });
  const primaryLines = flattenLines(result.data as OcrPageData);
  let lines = primaryLines;
  if (platform === 'wechat') {
    const enhancedResult = await worker.recognize(prepared.enhanced, {}, { text: true, blocks: true });
    lines = mergeLines(primaryLines, flattenLines(enhancedResult.data as OcrPageData));
    if (prepared.width < 1800) {
      const binaryResult = await worker.recognize(prepared.binary, {}, { text: true, blocks: true });
      lines = mergeLines(lines, flattenLines(binaryResult.data as OcrPageData));
    }
  }
  onProgress?.({ stage: 'parsing', progress: 0.95 });
  const candidates = parseOcrScreenshot(lines, {
    platform,
    sourceName,
    imageWidth: prepared.width,
    imageHeight: prepared.height,
    referenceDate,
  });
  onProgress?.({ stage: 'parsing', progress: 1 });
  return candidates;
}

export async function terminateOcrWorker(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  workerPromise = null;
  await worker.terminate();
}
