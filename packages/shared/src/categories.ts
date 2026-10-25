export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'select';

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
  required?: boolean;
  /** 敏感字段（编号、序列号等）：不出现在展览放映中 */
  private?: boolean;
}

export interface CategoryPreset {
  code: string;
  name: string;
  fields: FieldDef[];
}

export const PRESET_CATEGORIES: CategoryPreset[] = [
  {
    code: 'liquor',
    name: '老酒收藏',
    fields: [
      { key: 'brand', label: '品牌', type: 'text' },
      { key: 'series', label: '系列', type: 'text' },
      { key: 'vintage', label: '生产年份', type: 'text' },
      { key: 'abv', label: '酒精度(%vol)', type: 'number' },
      { key: 'volume', label: '容量(ml)', type: 'number' },
      { key: 'batch_no', label: '批次号/瓶号', type: 'text', private: true },
      { key: 'moutai_label', label: '茅台标识', type: 'select', options: ['飞天', '五星', '葵花', '三大革命', '其他', '非茅台'] },
      { key: 'packaging', label: '包装状态', type: 'select', options: ['原箱', '原盒', '裸瓶'] },
      { key: 'fill_level', label: '酒线/跑酒情况', type: 'text' },
    ],
  },
  {
    code: 'watch',
    name: '名表收藏',
    fields: [
      { key: 'brand', label: '品牌', type: 'text' },
      { key: 'reference', label: '型号/参考编号', type: 'text' },
      { key: 'serial_no', label: '表壳序列号', type: 'text', private: true },
      { key: 'movement', label: '机芯', type: 'text' },
      { key: 'case_material', label: '表壳材质', type: 'text' },
      { key: 'boutique', label: '专柜/购买门店', type: 'text', private: true },
      { key: 'warranty_until', label: '保修截止日期', type: 'date', private: true },
      { key: 'service_record', label: '保养记录', type: 'textarea', private: true },
      { key: 'accessories', label: '附件（盒/证/卡）', type: 'text' },
    ],
  },
  {
    code: 'painting',
    name: '书画字画',
    fields: [
      { key: 'artist', label: '作者', type: 'text' },
      { key: 'era', label: '年代', type: 'text' },
      { key: 'medium', label: '形式/材质', type: 'select', options: ['纸本', '绢本', '布面', '其他'] },
      { key: 'dimensions', label: '尺寸', type: 'text' },
      { key: 'mounting', label: '装裱', type: 'select', options: ['立轴', '镜心', '手卷', '册页', '框裱', '未裱'] },
      { key: 'seals', label: '钤印/题跋', type: 'textarea' },
      { key: 'provenance', label: '流传/著录', type: 'textarea' },
      { key: 'storage_env', label: '保存环境（温湿度）', type: 'text' },
    ],
  },
  {
    code: 'jewelry',
    name: '珠宝玉石',
    fields: [
      { key: 'material', label: '材质', type: 'text' },
      { key: 'weight', label: '重量/克拉', type: 'text' },
      { key: 'lab', label: '鉴定机构', type: 'text' },
      { key: 'cert_no', label: '证书编号', type: 'text', private: true },
      { key: 'color', label: '颜色', type: 'text' },
      { key: 'clarity', label: '净度', type: 'text' },
      { key: 'cut', label: '切工', type: 'text' },
      { key: 'treatment', label: '优化处理', type: 'text' },
    ],
  },
  {
    code: 'misc',
    name: '文玩杂项',
    fields: [
      { key: 'material', label: '材质', type: 'text' },
      { key: 'era', label: '年代', type: 'text' },
      { key: 'dimensions', label: '尺寸', type: 'text' },
      { key: 'origin', label: '产地/窑口', type: 'text' },
      { key: 'condition', label: '品相', type: 'text' },
    ],
  },
];

export const ATTACHMENT_KINDS = {
  photo: '实拍图',
  detail: '细节防伪图',
  appraisal: '鉴定报告',
  contract: '合同',
  auction: '拍卖凭证',
  insurance: '保险协议',
  other: '其他',
} as const;

export type AttachmentKind = keyof typeof ATTACHMENT_KINDS;

/** 核心档案：只有藏家本人可以删除 */
export const CORE_ATTACHMENT_KINDS: readonly AttachmentKind[] = ['appraisal', 'contract', 'auction', 'insurance'];
