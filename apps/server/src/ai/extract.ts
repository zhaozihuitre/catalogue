import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { OcrClient } from './ocr';

// pdfjs 需要标准字体目录来解析未嵌入字体的 PDF（如 Helvetica）
const STANDARD_FONTS = pathToFileURL(
  path.join(path.dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts') + path.sep,
).href;

/** 每页平均少于这么多字符，就认为是扫描件，改走 OCR */
const MIN_CHARS_PER_PAGE = 30;

export async function extractPdfText(data: Buffer): Promise<{ text: string; pages: number }> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    useSystemFonts: false,
    disableFontFace: true,
    standardFontDataUrl: STANDARD_FONTS,
  });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = '';
    const lines: string[] = [];
    for (const it of content.items as { str?: string; hasEOL?: boolean }[]) {
      line += it.str ?? '';
      if (it.hasEOL) (lines.push(line), (line = ''));
    }
    if (line) lines.push(line);
    pages.push(lines.join('\n').trim());
  }
  const numPages = doc.numPages;
  await task.destroy();
  return {
    text: pages.map((p, i) => (pages.length > 1 ? `【第 ${i + 1} 页】\n${p}` : p)).join('\n\n'),
    pages: numPages,
  };
}

export interface ExtractResult {
  text: string;
  method: 'pdf-text' | 'ocr';
}

/**
 * 提取档案文本：文本型 PDF 直接解析；图片和扫描件走本地 OCR。
 * OCR 服务不可用时抛出 OcrUnavailableError，由调用方决定是否稍后重试。
 */
export async function extractText(data: Buffer, mime: string, ocr: OcrClient): Promise<ExtractResult> {
  if (mime === 'application/pdf') {
    const { text, pages } = await extractPdfText(data);
    const visible = text.replace(/【第 \d+ 页】|\s/g, '').length;
    if (visible >= MIN_CHARS_PER_PAGE * Math.max(1, pages)) return { text, method: 'pdf-text' };
  }
  if (!(await ocr.health())) throw new OcrUnavailableError();
  return { text: await ocr.recognize(data, mime), method: 'ocr' };
}

export class OcrUnavailableError extends Error {
  constructor() {
    super('本地 OCR 服务未就绪');
  }
}
