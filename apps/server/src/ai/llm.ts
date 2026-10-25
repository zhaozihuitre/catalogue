export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface Llm {
  readonly model: string;
  health(): Promise<boolean>;
  chat(messages: ChatMessage[], opts?: { json?: boolean; temperature?: number }): Promise<string>;
}

/**
 * 本机 Ollama 客户端。只允许连接本机/内网地址，系统不调用任何外网大模型 API。
 */
export class OllamaClient implements Llm {
  constructor(
    private readonly baseUrl: string,
    readonly model: string,
  ) {
    const host = new URL(baseUrl).hostname;
    if (!isPrivateHost(host)) throw new Error(`Ollama 地址必须是本机或内网地址，当前为 ${host}`);
  }

  async health(): Promise<boolean> {
    try {
      const r = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
      if (!r.ok) return false;
      const { models } = (await r.json()) as { models: { name: string }[] };
      return models.some((m) => m.name === this.model || m.name === `${this.model}:latest`);
    } catch {
      return false;
    }
  }

  async chat(messages: ChatMessage[], opts: { json?: boolean; temperature?: number } = {}): Promise<string> {
    const r = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages,
        stream: false,
        format: opts.json ? 'json' : undefined,
        options: { temperature: opts.temperature ?? 0.1, num_ctx: 8192 },
        keep_alive: '30m',
      }),
      signal: AbortSignal.timeout(5 * 60_000),
    });
    if (!r.ok) throw new Error(`Ollama 返回 ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const json = (await r.json()) as { message: { content: string } };
    return json.message.content;
  }
}

export function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host === '::1' || host === '[::1]') return true;
  if (host.endsWith('.local') || host.endsWith('.ts.net')) return true;
  const m = host.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
