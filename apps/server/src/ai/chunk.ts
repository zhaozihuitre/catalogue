/**
 * 中文文档切片：优先按段落和句末标点切，单片不超过 maxLen，相邻片之间保留 overlap 字重叠。
 */
export function chunkText(text: string, maxLen = 400, overlap = 60): string[] {
  const clean = text.replace(/\r\n?/g, '\n').replace(/[ \t　]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (!clean) return [];
  if (clean.length <= maxLen) return [clean];

  // 先切成句子级的小段，再贪心拼接
  const pieces = clean.split(/(?<=[。！？；!?;\n])/).flatMap((s) => hardSplit(s, maxLen));
  const chunks: string[] = [];
  let cur = '';
  for (const p of pieces) {
    if (cur.length + p.length > maxLen && cur) {
      chunks.push(cur.trim());
      cur = cur.slice(Math.max(0, cur.length - overlap));
    }
    cur += p;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter((c) => c.length > 0);
}

function hardSplit(s: string, maxLen: number): string[] {
  if (s.length <= maxLen) return [s];
  const out: string[] = [];
  for (let i = 0; i < s.length; i += maxLen) out.push(s.slice(i, i + maxLen));
  return out;
}
