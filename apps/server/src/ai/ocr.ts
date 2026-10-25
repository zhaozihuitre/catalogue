import { isPrivateHost } from './llm';

/**
 * 本地 PaddleOCR 服务客户端（services/ocr，只监听 127.0.0.1）。
 */
export class OcrClient {
  constructor(private readonly baseUrl: string) {
    const host = new URL(baseUrl).hostname;
    if (!isPrivateHost(host)) throw new Error(`OCR 服务地址必须是本机或内网地址，当前为 ${host}`);
  }

  async health(): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      return r.ok;
    } catch {
      return false;
    }
  }

  /** 识别图片或扫描版 PDF，返回按页拼接的文本 */
  async recognize(data: Buffer, mime: string): Promise<string> {
    const r = await fetch(`${this.baseUrl}/ocr`, {
      method: 'POST',
      headers: { 'Content-Type': mime },
      body: new Uint8Array(data),
      signal: AbortSignal.timeout(10 * 60_000),
    });
    if (!r.ok) throw new Error(`OCR 服务返回 ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const json = (await r.json()) as { pages: string[] };
    return json.pages.map((p, i) => (json.pages.length > 1 ? `【第 ${i + 1} 页】\n${p}` : p)).join('\n\n');
  }
}
