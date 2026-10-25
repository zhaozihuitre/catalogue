export const ROLES = ['owner', 'assistant', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: '超级管理员（藏家本人）',
  assistant: '助理',
  viewer: '只读访客',
};

/**
 * 全系统唯一的权限矩阵。后端 preHandler 与前端按钮显隐都从这里读取。
 */
export const PERMISSIONS = {
  'item.read': ['owner', 'assistant', 'viewer'],
  'item.create': ['owner', 'assistant'],
  'item.update': ['owner', 'assistant'],
  'item.delete': ['owner'],
  'file.upload': ['owner', 'assistant'],
  'file.preview': ['owner', 'assistant', 'viewer'],
  'file.download': ['owner', 'assistant'],
  // 助理可删除实拍图等普通附件；鉴定报告/合同/凭证/保险协议等核心档案只允许藏家删除
  'file.delete': ['owner', 'assistant'],
  'file.deleteCore': ['owner'],
  'ai.ask': ['owner', 'assistant', 'viewer'],
  'ai.reprocess': ['owner', 'assistant'],
  'export.ledger': ['owner'],
  'export.insurance': ['owner', 'assistant'],
  'export.stats': ['owner', 'assistant'],
  'notification.read': ['owner', 'assistant', 'viewer'],
  'exhibit.view': ['owner', 'assistant', 'viewer'],
  'exhibit.manage': ['owner', 'assistant'],
  'user.manage': ['owner'],
  'session.revokeAny': ['owner'],
  'audit.read': ['owner'],
  'category.manage': ['owner'],
  'settings.manage': ['owner'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | undefined | null, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}
