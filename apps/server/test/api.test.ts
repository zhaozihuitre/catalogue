import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AI_NO_RECORD } from '@catalogue/shared';
import { buildApp } from '../src/app';
import { loadConfig } from '../src/config';
import { VaultManager } from '../src/vault';
import { AiWorker } from '../src/ai/worker';
import { fakeAi, login, multipartBody, setupApp, tmpDir, type TestCtx } from './helpers';

/** 构造一个最小的文本型 PDF（pdfjs 能容忍不精确的 xref） */
function textPdf(text: string): Buffer {
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  return Buffer.from(
    `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length ${stream.length} >> stream
${stream}
endstream endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
trailer << /Root 1 0 R >>
%%EOF`,
    'latin1',
  );
}

let ctx: TestCtx;
let owner: Awaited<ReturnType<typeof login>>;
let assistant: Awaited<ReturnType<typeof login>>;
let viewer: Awaited<ReturnType<typeof login>>;
let watchCategoryId: string;

beforeAll(async () => {
  ctx = await setupApp();
  owner = await login(ctx.app, 'owner');
  assistant = await login(ctx.app, 'assistant');
  viewer = await login(ctx.app, 'viewer');
  const cats = (await owner('GET', '/api/categories')).json();
  watchCategoryId = cats.find((c: { code: string }) => c.code === 'watch').id;
});

afterAll(async () => {
  await ctx.app.close();
  ctx.vaults.lock();
});

describe('访问控制基础', () => {
  it('系统锁定时业务接口返回 423，状态接口可用', async () => {
    const vaults = new VaultManager(loadConfig({ dataDir: tmpDir() }));
    const app = await buildApp({ config: loadConfig({ devInsecure: true }), vaults, ai: fakeAi() }, { logger: false });
    expect((await app.inject({ method: 'GET', url: '/api/items' })).statusCode).toBe(423);
    expect((await app.inject({ method: 'GET', url: '/api/system/status' })).json()).toEqual({ initialized: false, locked: true });
    await app.close();
  });

  it('未登录返回 401', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/items' })).statusCode).toBe(401);
  });

  it('写操作缺少 CSRF 头返回 403', async () => {
    const res = await ctx.app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'owner', password: 'x' } });
    expect(res.statusCode).toBe(403);
  });

  it('错误密码登录失败并记录审计', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'x-catalogue': '1' },
      payload: { username: 'owner', password: 'wrong-password-1' },
    });
    expect(res.statusCode).toBe(401);
    const logs = (await owner('GET', '/api/audit?action=auth.login.failed')).json();
    expect(logs.total).toBeGreaterThan(0);
  });
});

describe('藏品档案与三级权限', () => {
  let itemId: string;

  it('助理可以新增藏品，自定义字段按类目校验', async () => {
    const bad = await assistant('POST', '/api/items', { name: '表', categoryId: watchCategoryId, purchaseDate: '2026/1/1' });
    expect(bad.statusCode).toBe(400);

    const res = await assistant('POST', '/api/items', {
      name: '劳力士潜航者 126610LN',
      categoryId: watchCategoryId,
      purchasePrice: 98000,
      location: '书房保险柜',
      insuranceExpiry: '2026-11-01',
      attributes: { brand: '劳力士', movement: '3235', unknown_field: 'dropped' },
    });
    expect(res.statusCode).toBe(200);
    const item = res.json();
    expect(item.code).toBe('WAT-00001');
    expect(item.attributes).toEqual({ brand: '劳力士', movement: '3235' });
    itemId = item.id;
  });

  it('只读访客可以查看，不能新增或编辑；越权写入审计', async () => {
    expect((await viewer('GET', `/api/items/${itemId}`)).statusCode).toBe(200);
    expect((await viewer('POST', '/api/items', { name: 'x', categoryId: watchCategoryId })).statusCode).toBe(403);
    expect((await viewer('PUT', `/api/items/${itemId}`, { name: 'x', categoryId: watchCategoryId })).statusCode).toBe(403);
    const logs = (await owner('GET', '/api/audit?action=permission.denied')).json();
    expect(logs.rows.some((r: { username: string }) => r.username === 'viewer')).toBe(true);
  });

  it('编辑写入字段级变更审计', async () => {
    const res = await assistant('PUT', `/api/items/${itemId}`, {
      name: '劳力士潜航者 126610LN',
      categoryId: watchCategoryId,
      purchasePrice: 98000,
      location: '银行保管箱',
      insuranceExpiry: '2026-11-01',
      attributes: { brand: '劳力士', movement: '3235' },
    });
    expect(res.statusCode).toBe(200);
    const log = (await owner('GET', '/api/audit?action=item.update')).json().rows[0];
    expect(JSON.parse(log.detail).changes.location).toEqual(['书房保险柜', '银行保管箱']);
  });

  it('图片上传：生成缩略图，访客能预览不能下载原件', async () => {
    const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#a08060' } }).png().toBuffer();
    const { body, contentType } = multipartBody('正面.png', png, 'image/png');
    const up = await assistant('POST', `/api/items/${itemId}/attachments?kind=photo`, body, { 'content-type': contentType });
    expect(up.statusCode).toBe(200);
    const [att] = up.json();
    expect(att.hasThumbnail).toBe(true);

    const thumb = await viewer('GET', `/api/attachments/${att.id}/thumb`);
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/jpeg');
    expect(thumb.headers['cache-control']).toContain('no-store');
    expect((await viewer('GET', `/api/attachments/${att.id}/download`)).statusCode).toBe(403);

    const dl = await assistant('GET', `/api/attachments/${att.id}/download`);
    expect(dl.statusCode).toBe(200);
    expect(dl.rawPayload.equals(png)).toBe(true);
  });

  it('拒绝伪装类型的文件', async () => {
    const { body, contentType } = multipartBody('evil.pdf', Buffer.from('<script>alert(1)</script>'), 'application/pdf');
    const res = await assistant('POST', `/api/items/${itemId}/attachments`, body, { 'content-type': contentType });
    expect(res.statusCode).toBe(415);
  });

  it('核心档案：助理能上传但不能删除，藏家可以', async () => {
    const { body, contentType } = multipartBody('cert.pdf', textPdf('GIA certificate 2210'), 'application/pdf');
    const up = await assistant('POST', `/api/items/${itemId}/attachments?kind=appraisal`, body, { 'content-type': contentType });
    const [att] = up.json();
    expect((await assistant('DELETE', `/api/attachments/${att.id}`)).statusCode).toBe(403);
    expect((await assistant('PATCH', `/api/attachments/${att.id}`, { kind: 'photo' })).statusCode).toBe(403);
    expect((await owner('DELETE', `/api/attachments/${att.id}`)).statusCode).toBe(200);
  });

  it('助理不能删除藏品，藏家可以', async () => {
    const tmp = (await owner('POST', '/api/items', { name: '临时', categoryId: watchCategoryId })).json();
    expect((await assistant('DELETE', `/api/items/${tmp.id}`)).statusCode).toBe(403);
    expect((await owner('DELETE', `/api/items/${tmp.id}`)).statusCode).toBe(200);
  });

  it('导出：全台账仅藏家，保险清单助理可导出，访客都不行', async () => {
    const ledger = await owner('GET', '/api/export/ledger.xlsx');
    expect(ledger.statusCode).toBe(200);
    expect(ledger.rawPayload.subarray(0, 2).toString()).toBe('PK');
    expect((await assistant('GET', '/api/export/ledger.xlsx')).statusCode).toBe(403);
    expect((await assistant('GET', '/api/export/insurance.xlsx')).statusCode).toBe(200);
    expect((await viewer('GET', '/api/export/stats.xlsx')).statusCode).toBe(403);
  });
});

describe('本地 AI 流水线与问答', () => {
  let itemId: string;

  beforeAll(async () => {
    itemId = (
      await owner('POST', '/api/items', { name: '帝王绿翡翠手镯', categoryId: watchCategoryId, location: '主卧保险箱' })
    ).json().id;
    ctx.llm.reply = (msgs) =>
      msgs[0].content.includes('信息抽取')
        ? JSON.stringify({ conclusion: 'Natural jadeite, type A', era: null, material: 'jadeite', institution: 'NGTC', riskNotes: null })
        : '证书编号为 NGTC-778899 [1]';
    const { body, contentType } = multipartBody('report.pdf', textPdf('NGTC report NGTC-778899 natural jadeite type A bangle'), 'application/pdf');
    await owner('POST', `/api/items/${itemId}/attachments?kind=appraisal`, body, { 'content-type': contentType });
    await new AiWorker(ctx.ai, ctx.app.log).drain(ctx.vaults.current!);
  });

  it('PDF 文本被提取、切片并生成摘要', async () => {
    const detail = (await owner('GET', `/api/items/${itemId}`)).json();
    const att = detail.attachments.find((a: { filename: string }) => a.filename === 'report.pdf');
    expect(att.aiStatus).toBe('done');
    const text = (await viewer('GET', `/api/attachments/${att.id}/text`)).json();
    expect(text.text).toContain('NGTC-778899');
    expect(text.summary.institution).toBe('NGTC');
  });

  it('命中档案时调用本地大模型并返回来源', async () => {
    const res = (await viewer('POST', '/api/ai/ask', { question: 'NGTC-778899 jadeite report' })).json();
    expect(res.answer).toContain('NGTC-778899');
    expect(res.sources[0].filename).toBe('report.pdf');
    expect(res.disclaimer).toContain('不具备鉴定、评估法律效力');
  });

  it('藏品字段也能检索（档案卡）', async () => {
    ctx.llm.reply = () => '存放在主卧保险箱 [1]';
    const res = (await owner('POST', '/api/ai/ask', { question: '翡翠手镯存放位置' })).json();
    expect(res.noRecord).toBe(false);
    expect(res.sources.some((s: { filename: string }) => s.filename === '藏品档案卡')).toBe(true);
  });

  it('没有召回时直接返回无记录，不调用大模型', async () => {
    const before = ctx.llm.calls.length;
    const res = (await owner('POST', '/api/ai/ask', { question: '宋代汝窑天青釉笔洗' })).json();
    expect(res.noRecord).toBe(true);
    expect(res.answer).toBe(AI_NO_RECORD);
    expect(ctx.llm.calls.length).toBe(before);
  });

  it('估值类问题被拦截，不调用大模型，并写入审计', async () => {
    const before = ctx.llm.calls.length;
    const res = (await owner('POST', '/api/ai/ask', { question: '这个翡翠手镯值多少钱' })).json();
    expect(res.blocked).toBe(true);
    expect(ctx.llm.calls.length).toBe(before);
    const log = (await owner('GET', '/api/audit?action=ai.ask')).json().rows[0];
    expect(JSON.parse(log.detail).question).toBe('这个翡翠手镯值多少钱');
  });

  it('大模型不可用时降级为返回原文片段', async () => {
    ctx.llm.up = false;
    const res = (await owner('POST', '/api/ai/ask', { question: 'NGTC-778899 jadeite' })).json();
    ctx.llm.up = true;
    expect(res.answer).toContain('未就绪');
    expect(res.sources.length).toBeGreaterThan(0);
  });
});

describe('私人展览', () => {
  let withPhoto: string;
  let noPhoto: string;
  let exhibitionId: string;

  beforeAll(async () => {
    withPhoto = (
      await owner('POST', '/api/items', {
        name: '百达翡丽 5711',
        categoryId: watchCategoryId,
        purchasePrice: 888888,
        location: '银行保管箱 B-17',
        insurancePolicyNo: 'POLICY-SECRET-1',
        notes: '备注里的私密信息',
        attributes: { brand: '百达翡丽', serial_no: 'SERIAL-SECRET-9', movement: '26-330 S C' },
      })
    ).json().id;
    noPhoto = (await owner('POST', '/api/items', { name: '无图藏品', categoryId: watchCategoryId })).json().id;
    const png = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#335' } }).png().toBuffer();
    const { body, contentType } = multipartBody('p.png', png, 'image/png');
    await owner('POST', `/api/items/${withPhoto}/attachments?kind=photo`, body, { 'content-type': contentType });
  });

  it('助理可以创建展览，访客不能', async () => {
    const payload = { name: '名表专场', itemIds: [withPhoto, noPhoto], intervalSec: 8 };
    expect((await viewer('POST', '/api/exhibitions', payload)).statusCode).toBe(403);
    const res = await assistant('POST', '/api/exhibitions', payload);
    expect(res.statusCode).toBe(200);
    exhibitionId = res.json().id;
    expect((await viewer('GET', '/api/exhibitions')).json().length).toBe(1);
  });

  it('放映数据不含价格、位置、保险、备注和敏感字段；无图藏品被跳过', async () => {
    const res = await viewer('GET', `/api/exhibit/playlist?exhibitionId=${exhibitionId}`);
    expect(res.statusCode).toBe(200);
    const pl = res.json();
    expect(pl.title).toBe('名表专场');
    expect(pl.intervalSec).toBe(8);
    expect(pl.skipped).toBe(1);
    expect(pl.slides).toHaveLength(1);
    expect(pl.slides[0].fields).toEqual([
      { label: '品牌', value: '百达翡丽' },
      { label: '机芯', value: '26-330 S C' },
    ]);
    for (const secret of ['888888', '银行保管箱', 'POLICY-SECRET', 'SERIAL-SECRET', '私密信息', 'WAT-']) {
      expect(res.body).not.toContain(secret);
    }
  });

  it('放映图片只给预览图，且不逐张写审计', async () => {
    const pl = (await viewer('GET', `/api/exhibit/playlist?exhibitionId=${exhibitionId}`)).json();
    const before = (await owner('GET', '/api/audit?action=file.preview')).json().total;
    const img = await viewer('GET', `/api/exhibit/image/${pl.slides[0].imageIds[0]}`);
    expect(img.statusCode).toBe(200);
    expect(img.headers['content-type']).toBe('image/jpeg');
    expect((await owner('GET', '/api/audit?action=file.preview')).json().total).toBe(before);
    expect((await owner('GET', '/api/audit?action=exhibit.play')).json().total).toBeGreaterThan(0);
  });

  it('按分类和全部藏品放映', async () => {
    const byCat = (await viewer('GET', `/api/exhibit/playlist?categoryId=${watchCategoryId}`)).json();
    expect(byCat.title).toBe('名表收藏');
    expect(byCat.slides.some((s: { itemId: string }) => s.itemId === withPhoto)).toBe(true);
    expect((await viewer('GET', '/api/exhibit/playlist')).json().title).toBe('全部藏品');
  });
});

describe('提醒与会话管理', () => {
  it('提醒扫描生成通知，重复扫描不重复生成', async () => {
    const first = (await owner('POST', '/api/reminders/run')).json();
    expect(first.created).toBeGreaterThan(0);
    expect((await owner('POST', '/api/reminders/run')).json().created).toBe(0);
    const list = (await viewer('GET', '/api/notifications')).json();
    expect(list.some((n: { type: string }) => n.type === 'insurance_expiry')).toBe(true);
    expect((await viewer('POST', '/api/reminders/run')).statusCode).toBe(403);
  });

  it('藏家可以强制下线助理所有设备', async () => {
    const users = (await owner('GET', '/api/users')).json();
    const asst = users.find((u: { username: string }) => u.username === 'assistant');
    expect((await owner('POST', `/api/users/${asst.id}/revoke-sessions`)).json().revoked).toBeGreaterThan(0);
    expect((await assistant('GET', '/api/items')).statusCode).toBe(401);
  });

  it('禁用账号后无法登录；不能禁用最后一个藏家', async () => {
    const users = (await owner('GET', '/api/users')).json();
    const v = users.find((u: { username: string }) => u.username === 'viewer');
    const o = users.find((u: { username: string }) => u.username === 'owner');
    await owner('PATCH', `/api/users/${v.id}`, { disabled: true });
    await expect(login(ctx.app, 'viewer')).rejects.toThrow();
    expect((await owner('PATCH', `/api/users/${o.id}`, { disabled: true })).statusCode).toBe(400);
  });
});
