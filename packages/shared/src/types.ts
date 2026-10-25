import type { Role } from './permissions';
import type { AttachmentKind, FieldDef } from './categories';

export interface UserDTO {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  disabled: boolean;
  createdAt: string;
}

export interface SessionDTO {
  id: string;
  userId: string;
  username?: string;
  device: string;
  ip: string;
  createdAt: string;
  lastSeenAt: string;
  current?: boolean;
}

export interface CategoryDTO {
  id: string;
  code: string;
  name: string;
  fields: FieldDef[];
  builtin: boolean;
}

export interface ItemInput {
  code?: string | null;
  name: string;
  categoryId: string;
  purchaseDate?: string | null;
  purchaseChannel?: string | null;
  purchasePrice?: number | null;
  marketPrice?: number | null;
  location?: string | null;
  insuranceCompany?: string | null;
  insurancePolicyNo?: string | null;
  insuranceAmount?: number | null;
  insuranceExpiry?: string | null;
  maintenanceCycleDays?: number | null;
  lastMaintenanceDate?: string | null;
  lastInventoryDate?: string | null;
  notes?: string | null;
  attributes?: Record<string, unknown>;
}

export interface ItemDTO extends Required<ItemInput> {
  id: string;
  code: string;
  attributes: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  coverAttachmentId: string | null;
}

export type AiStatus = 'pending' | 'processing' | 'done' | 'failed' | 'skipped';

export interface AttachmentDTO {
  id: string;
  itemId: string;
  kind: AttachmentKind;
  filename: string;
  mime: string;
  size: number;
  hasThumbnail: boolean;
  aiStatus: AiStatus;
  aiError: string | null;
  createdAt: string;
}

export interface AiSummary {
  conclusion: string | null;
  era: string | null;
  material: string | null;
  institution: string | null;
  riskNotes: string | null;
}

export interface AiSummaryDTO extends AiSummary {
  attachmentId: string;
  model: string;
  createdAt: string;
}

export interface AiSource {
  attachmentId: string;
  itemId: string;
  itemName: string;
  filename: string;
  snippet: string;
  score: number;
}

export interface AiAnswer {
  answer: string;
  sources: AiSource[];
  noRecord: boolean;
  blocked: boolean;
  disclaimer: string;
}

export interface AiHealth {
  ocr: boolean;
  embedder: boolean;
  llm: boolean;
  llmModel: string;
  message: string | null;
}

export type NotificationType = 'insurance_expiry' | 'maintenance_due' | 'inventory_overdue';

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  itemId: string | null;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
}

export interface AuditLogDTO {
  id: number;
  userId: string | null;
  username: string | null;
  action: string;
  target: string | null;
  detail: string | null;
  ip: string | null;
  createdAt: string;
}

export interface ExhibitionDTO {
  id: string;
  name: string;
  description: string | null;
  itemIds: string[];
  intervalSec: number;
  createdAt: string;
  updatedAt: string;
}

/** 放映用的展品数据：服务端已剔除价格、位置、保险、编号等敏感信息 */
export interface ExhibitSlide {
  itemId: string;
  name: string;
  categoryName: string;
  fields: { label: string; value: string }[];
  imageIds: string[];
}

export interface ExhibitPlaylist {
  title: string;
  description: string | null;
  intervalSec: number;
  slides: ExhibitSlide[];
  /** 没有图片、因此未加入放映的藏品数 */
  skipped: number;
}

export const AI_DISCLAIMER = 'AI 结果仅作档案查阅参考，不具备鉴定、评估法律效力。';
export const AI_NO_RECORD = '档案中无相关记录。';
export const AI_BLOCKED =
  '本系统不提供藏品估值、行情预测或真伪判定。如需此类意见，请咨询具备资质的鉴定或评估机构。';
