import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app';
import { ask } from '../ai/rag';
import { listItemSummaries } from '../ai/summaries';
import { audit, requirePerm, vaultOf } from '../http/context';

export async function aiRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get('/api/ai/health', { preHandler: requirePerm('ai.ask') }, async () => deps.ai.health());

  app.post(
    '/api/ai/ask',
    { preHandler: requirePerm('ai.ask'), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (req) => {
      const { db } = vaultOf(req);
      const body = z
        .object({ question: z.string().trim().min(1).max(500), itemId: z.string().optional() })
        .parse(req.body);
      const res = await ask({ db, embedder: deps.ai.embedder, llm: deps.ai.llm }, body.question, body.itemId);
      // AI 问答全量留痕：问题、回答、引用来源
      audit(req, 'ai.ask', body.itemId ?? null, {
        question: body.question,
        answer: res.answer,
        mode: res.mode,
        blocked: res.blocked,
        noRecord: res.noRecord,
        sources: res.sources.map((s) => s.attachmentId || s.itemId),
      });
      const { mode: _mode, ...answer } = res;
      return answer;
    },
  );

  app.get('/api/items/:id/summaries', { preHandler: requirePerm('item.read') }, async (req) => {
    return listItemSummaries(vaultOf(req).db, (req.params as { id: string }).id);
  });
}
