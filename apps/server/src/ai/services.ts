import type { AiHealth } from '@catalogue/shared';
import type { Config } from '../config';
import { LocalEmbedder, type Embedder } from './embedder';
import { OllamaClient, type Llm } from './llm';
import { OcrClient } from './ocr';

export interface AiServices {
  ocr: OcrClient;
  embedder: Embedder;
  llm: Llm;
  health(): Promise<AiHealth>;
}

export function createAiServices(config: Config): AiServices {
  const ocr = new OcrClient(config.ocrUrl);
  const embedder = new LocalEmbedder(config.embedModel, config.modelDir);
  const llm = new OllamaClient(config.ollamaUrl, config.llmModel);

  let cached: { at: number; value: AiHealth } | null = null;
  return {
    ocr,
    embedder,
    llm,
    async health() {
      if (cached && Date.now() - cached.at < 10_000) return cached.value;
      const [o, e, l] = await Promise.all([ocr.health(), embedder.ready(), llm.health()]);
      const missing = [!o && 'OCR 识别服务', !e && '向量模型', !l && `本地大模型（${llm.model}）`].filter(Boolean);
      const value: AiHealth = {
        ocr: o,
        embedder: e,
        llm: l,
        llmModel: llm.model,
        message: missing.length ? `${missing.join('、')}未就绪，相关 AI 功能暂时降级，其他功能不受影响。` : null,
      };
      cached = { at: Date.now(), value };
      return value;
    },
  };
}
