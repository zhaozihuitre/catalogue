import { describe, expect, it } from 'vitest';
import { AI_BLOCKED, AI_NO_RECORD, can, PERMISSIONS, type ItemDTO, type Permission, type Role } from '@catalogue/shared';
import { computeReminders } from '../src/modules/reminders/reminders';
import { DEFAULT_SETTINGS } from '../src/db/settings';
import { isBlockedQuestion } from '../src/ai/guard';
import { chunkText } from '../src/ai/chunk';
import { keywordScore } from '../src/ai/retrieve';
import { validatePassword } from '../src/auth/users';
import { loadConfig } from '../src/config';

describe('权限矩阵', () => {
  const expected: Record<Role, Permission[]> = {
    owner: Object.keys(PERMISSIONS) as Permission[],
    assistant: [
      'item.read', 'item.create', 'item.update', 'file.upload', 'file.preview', 'file.download', 'file.delete',
      'ai.ask', 'ai.reprocess', 'export.insurance', 'export.stats', 'notification.read',
      'exhibit.view', 'exhibit.manage',
    ],
    viewer: ['item.read', 'file.preview', 'ai.ask', 'notification.read', 'exhibit.view'],
  };

  for (const role of Object.keys(expected) as Role[]) {
    it(`${role} 的权限与 PRD 一致`, () => {
      const granted = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p));
      expect(granted.sort()).toEqual([...expected[role]].sort());
    });
  }

  it('助理不能删除藏品、删除核心档案、导出全台账', () => {
    expect(can('assistant', 'item.delete')).toBe(false);
    expect(can('assistant', 'file.deleteCore')).toBe(false);
    expect(can('assistant', 'export.ledger')).toBe(false);
  });

  it('只读访客不能下载、编辑、导出', () => {
    for (const p of ['file.download', 'item.update', 'export.ledger', 'export.insurance', 'export.stats'] as const) {
      expect(can('viewer', p)).toBe(false);
    }
  });
});

function item(over: Partial<ItemDTO>): ItemDTO {
  return {
    id: 'i1', code: 'WAT-00001', name: '劳力士潜航者', categoryId: 'c', purchaseDate: null, purchaseChannel: null,
    purchasePrice: null, marketPrice: null, location: null, insuranceCompany: null, insurancePolicyNo: null,
    insuranceAmount: null, insuranceExpiry: null, maintenanceCycleDays: null, lastMaintenanceDate: null,
    lastInventoryDate: '2026-10-01', notes: null, attributes: {}, createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z', coverAttachmentId: null, ...over,
  };
}

describe('密码策略', () => {
  it('正式模式要求 10 位以上且含字母和数字', () => {
    expect(validatePassword('1234')).not.toBeNull();
    expect(validatePassword('abcdefghij')).not.toBeNull();
    expect(validatePassword('Password1234')).toBeNull();
  });
  it('开发模式允许简单密码，但不能为空', () => {
    expect(validatePassword('1234', true)).toBeNull();
    expect(validatePassword('', true)).not.toBeNull();
  });
});

describe('传输方式配置', () => {
  it('配置证书时一律视为 HTTPS', () => {
    expect(loadConfig({ tlsCert: 'a.crt', tlsKey: 'a.key', allowHttp: true, devInsecure: true }).plainHttp).toBe(false);
  });
  it('无证书时，只有显式允许才以 HTTP 提供服务', () => {
    expect(loadConfig({ tlsCert: null, tlsKey: null, allowHttp: true, devInsecure: false }).plainHttp).toBe(true);
    expect(loadConfig({ tlsCert: null, tlsKey: null, allowHttp: false, devInsecure: true }).plainHttp).toBe(true);
    expect(loadConfig({ tlsCert: null, tlsKey: null, allowHttp: false, devInsecure: false }).plainHttp).toBe(false);
  });
});

describe('提醒计算', () => {
  const cfg = DEFAULT_SETTINGS.reminders;
  const today = '2026-10-25';

  it('保险到期按最紧的档位提醒', () => {
    const [r] = computeReminders([item({ insuranceExpiry: '2026-11-20' })], today, cfg);
    expect(r.dedupeKey).toBe('insurance:i1:2026-11-20:30');
    const [r7] = computeReminders([item({ insuranceExpiry: '2026-10-30' })], today, cfg);
    expect(r7.dedupeKey).toBe('insurance:i1:2026-10-30:7');
    expect(r7.body).toContain('剩余 5 天');
  });

  it('保险已过期 / 远未到期', () => {
    expect(computeReminders([item({ insuranceExpiry: '2026-10-01' })], today, cfg)[0].title).toBe('保险已过期');
    expect(computeReminders([item({ insuranceExpiry: '2027-06-01' })], today, cfg)).toHaveLength(0);
  });

  it('保养到期按上次保养日 + 周期计算', () => {
    const r = computeReminders([item({ maintenanceCycleDays: 30, lastMaintenanceDate: '2026-09-28' })], today, cfg);
    expect(r).toHaveLength(1);
    expect(r[0].dedupeKey).toBe('maintenance:i1:2026-10-28');
    expect(computeReminders([item({ maintenanceCycleDays: 365, lastMaintenanceDate: '2026-09-28' })], today, cfg)).toHaveLength(0);
  });

  it('长期未盘点', () => {
    const r = computeReminders([item({ lastInventoryDate: '2026-01-01' })], today, cfg);
    expect(r.map((x) => x.type)).toEqual(['inventory_overdue']);
  });
});

describe('AI 约束', () => {
  it.each([
    '这块表现在值多少钱',
    '帮我估个价',
    '这幅画以后会升值吗',
    '茅台最近行情怎么样',
    '这个镯子是真的吗',
    '判断一下真伪',
    '是不是赝品',
  ])('拦截估值/行情/真伪问题：%s', (q) => expect(isBlockedQuestion(q)).toBe(true));

  it.each(['劳力士放在哪里', '这瓶茅台的购入价是多少', '保险哪天到期', '鉴定机构是哪家', '鉴定结论写了什么'])(
    '放行档案查询：%s',
    (q) => expect(isBlockedQuestion(q)).toBe(false),
  );

  it('固定答复文案', () => {
    expect(AI_NO_RECORD).toBe('档案中无相关记录。');
    expect(AI_BLOCKED).toContain('不提供藏品估值');
  });
});

describe('切片与关键词检索', () => {
  it('长文本按句切片并保留重叠，不丢内容', () => {
    const text = Array.from({ length: 40 }, (_, i) => `第${i}句鉴定说明内容。`).join('');
    const chunks = chunkText(text, 100, 20);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every((c) => c.length <= 120)).toBe(true);
    expect(chunks.join('')).toContain('第39句');
  });

  it('关键词得分', () => {
    const card = '藏品名称：劳力士潜航者\n存放位置：书房保险柜';
    expect(keywordScore('劳力士放在哪里', card)).toBeGreaterThanOrEqual(0.3);
    expect(keywordScore('茅台酒的批次号', card)).toBe(0);
  });
});
