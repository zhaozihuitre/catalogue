/**
 * 产品红线：AI 不做估值、行情预测、真伪判定。
 * 在调用大模型之前先用规则拦截，system prompt 中还有第二道约束。
 */
const BLOCK_PATTERNS: RegExp[] = [
  /估.{0,2}(值|价)|评估.{0,4}(价|值)|值(多少|几)|能卖|卖(多少|几)|市场价值|收藏价值|投资价值/,
  /升值|贬值|涨价|跌价|会涨|会跌|行情|走势|前景|值得(买|入手|投资)|保值/,
  /真伪|真假|是真是假|是不是真|是(真|假)的(吗|么|嘛)|真的假的|是否(为)?真|是否(为)?(正品|真品|赝品|仿品)|(是|会不会是)(赝品|仿品|假货|高仿)|鉴定.{0,4}(真|假)/,
];

export function isBlockedQuestion(q: string): boolean {
  const s = q.replace(/\s+/g, '');
  return BLOCK_PATTERNS.some((re) => re.test(s));
}
