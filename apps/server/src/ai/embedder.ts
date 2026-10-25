import fs from 'node:fs';
import path from 'node:path';

export interface Embedder {
  readonly model: string;
  ready(): Promise<boolean>;
  /** 返回已归一化的向量 */
  embed(texts: string[]): Promise<Float32Array[]>;
  /** bge 系列查询需加检索指令前缀 */
  embedQuery(text: string): Promise<Float32Array>;
}

const BGE_QUERY_PREFIX = '为这个句子生成表示以用于检索相关文章：';

/**
 * 在 Node 进程内用 ONNX 运行 bge-small-zh-v1.5。
 * 只从本地 modelDir 加载，禁止联网下载模型。
 */
export class LocalEmbedder implements Embedder {
  private extractor: ((texts: string[], opts: object) => Promise<{ tolist(): number[][] }>) | null = null;
  private loading: Promise<void> | null = null;
  private failed: string | null = null;

  constructor(
    readonly model: string,
    private readonly modelDir: string,
  ) {}

  private modelPresent(): boolean {
    return fs.existsSync(path.join(this.modelDir, this.model, 'config.json'));
  }

  private async load(): Promise<void> {
    if (this.extractor) return;
    if (!this.loading) {
      this.loading = (async () => {
        const { env, pipeline } = await import('@huggingface/transformers');
        env.allowRemoteModels = false;
        env.allowLocalModels = true;
        env.localModelPath = this.modelDir;
        env.useBrowserCache = false;
        this.extractor = (await pipeline('feature-extraction', this.model, { dtype: 'fp32' })) as never;
      })().catch((e) => {
        this.failed = (e as Error).message;
        this.loading = null;
        throw e;
      });
    }
    await this.loading;
  }

  async ready(): Promise<boolean> {
    if (this.extractor) return true;
    if (!this.modelPresent()) return false;
    try {
      await this.load();
      return true;
    } catch {
      return false;
    }
  }

  get error(): string | null {
    return this.failed;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    await this.load();
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += 16) {
      const batch = texts.slice(i, i + 16);
      const res = await this.extractor!(batch, { pooling: 'cls', normalize: true });
      out.push(...res.tolist().map((v) => Float32Array.from(v)));
    }
    return out;
  }

  async embedQuery(text: string): Promise<Float32Array> {
    return (await this.embed([BGE_QUERY_PREFIX + text]))[0];
  }
}

export function toBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength);
}

export function fromBlob(b: Buffer): Float32Array {
  const copy = new Uint8Array(b.byteLength);
  copy.set(b);
  return new Float32Array(copy.buffer);
}

/** 两个已归一化向量的点积即余弦相似度 */
export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}
