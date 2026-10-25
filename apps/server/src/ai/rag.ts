import { AI_BLOCKED, AI_DISCLAIMER, AI_NO_RECORD, type AiAnswer, type AiSource, type AiSummary } from '@catalogue/shared';
import type { DB } from '../db';
import { getSettings } from '../db/settings';
import type { Embedder } from './embedder';
import { isBlockedQuestion } from './guard';
import type { Llm } from './llm';
import { retrieve, type Hit } from './retrieve';

export const RAG_SYSTEM_PROMPT = `你是"藏册"私有藏品档案系统的档案查阅助手。必须严格遵守以下规则：
1. 只能依据【档案片段】中的内容回答，不得使用片段以外的知识，不得推测或编造。
2. 如果档案片段中找不到问题的答案，只回答："${AI_NO_RECORD}"
3. 不做任何估值、价格预测、行情分析或真伪判定，也不评价鉴定结论是否可靠。档案中记录的购入价等数字可以如实引用。
4. 引用信息时，在句末用 [编号] 标注来源片段，例如 [1]。
5. 使用简洁的中文回答。`;

export interface AskDeps {
  db: DB;
  embedder: Embedder | null;
  llm: Llm | null;
}

const snippet = (s: string) => (s.length > 160 ? `${s.slice(0, 160)}…` : s);

function toSource(h: Hit): AiSource {
  return {
    attachmentId: h.attachmentId ?? '',
    itemId: h.itemId,
    itemName: h.itemName,
    filename: h.filename ?? '藏品档案卡',
    snippet: snippet(h.text),
    score: Math.round(h.score * 1000) / 1000,
  };
}

export function buildContext(hits: Hit[]): string {
  return hits
    .map((h, i) => `[${i + 1}] 藏品：${h.itemName}｜来源：${h.filename ?? '藏品档案卡'}\n${h.text}`)
    .join('\n\n');
}

export async function ask(deps: AskDeps, question: string, itemId?: string): Promise<AiAnswer & { mode: string }> {
  const base = { disclaimer: AI_DISCLAIMER };
  if (isBlockedQuestion(question)) {
    return { ...base, answer: AI_BLOCKED, sources: [], noRecord: false, blocked: true, mode: 'guard' };
  }

  const settings = getSettings(deps.db).ai;
  const { hits, mode } = await retrieve(deps.db, deps.embedder, question, { itemId, ...settings });
  if (!hits.length) {
    // 没有召回就直接返回，不让大模型有机会编造
    return { ...base, answer: AI_NO_RECORD, sources: [], noRecord: true, blocked: false, mode };
  }

  if (!deps.llm || !(await deps.llm.health())) {
    return {
      ...base,
      answer: '本地大模型暂未就绪，以下是档案中检索到的相关原文片段，请直接查阅。',
      sources: hits.map(toSource),
      noRecord: false,
      blocked: false,
      mode: `${mode}-only`,
    };
  }

  const answer = (
    await deps.llm.chat([
      { role: 'system', content: RAG_SYSTEM_PROMPT },
      { role: 'user', content: `【档案片段】\n${buildContext(hits)}\n\n【问题】\n${question}` },
    ])
  ).trim();

  const noRecord = answer.includes(AI_NO_RECORD.replace('。', ''));
  const cited = new Set([...answer.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]) - 1));
  const sources = (cited.size ? hits.filter((_, i) => cited.has(i)) : hits).map(toSource);
  return { ...base, answer, sources: noRecord ? [] : sources, noRecord, blocked: false, mode };
}

const SUMMARY_PROMPT = `你是档案信息抽取助手。从给定的藏品档案文本（鉴定报告、合同、拍卖凭证、保险协议等）中抽取信息，输出 JSON：
{"conclusion": 鉴定或文件结论原文要点, "era": 年代, "material": 材质, "institution": 出具机构, "riskNotes": 文件中提到的风险、瑕疵、免责或限制性说明}
规则：只抽取文本中明确写出的内容，没有的字段填 null；不得推测、不得估值、不得判断真伪；每个字段不超过 120 字。只输出 JSON。`;

export async function summarize(llm: Llm, text: string): Promise<AiSummary> {
  const raw = await llm.chat(
    [
      { role: 'system', content: SUMMARY_PROMPT },
      { role: 'user', content: text.slice(0, 6000) },
    ],
    { json: true },
  );
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('大模型返回的摘要不是合法 JSON');
  }
  const pick = (k: string) => {
    const v = parsed[k];
    return typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' ? v.trim().slice(0, 300) : null;
  };
  return {
    conclusion: pick('conclusion'),
    era: pick('era'),
    material: pick('material'),
    institution: pick('institution'),
    riskNotes: pick('riskNotes'),
  };
}
