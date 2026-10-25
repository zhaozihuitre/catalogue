<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  ATTACHMENT_KINDS,
  CORE_ATTACHMENT_KINDS,
  type AiStatus,
  type AttachmentDTO,
  type AttachmentKind,
  type CategoryDTO,
  type ItemDTO,
} from '@catalogue/shared';
import { api, downloadFile, fmtMoney, fmtSize, fmtTime, openFile } from '../api';
import { useSession } from '../stores/session';
import { confirm, useAction, useIsMobile } from '../composables';
import AttachmentTextDialog from '../components/AttachmentTextDialog.vue';

const route = useRoute();
const router = useRouter();
const session = useSession();
const isMobile = useIsMobile();
const { busy, run } = useAction();

const id = route.params.id as string;
const item = ref<ItemDTO | null>(null);
const category = ref<CategoryDTO | null>(null);
const attachments = ref<AttachmentDTO[]>([]);
const textDialogId = ref<string | null>(null);
const uploadKind = ref<AttachmentKind>('photo');
const uploading = ref(false);

async function load() {
  const res = await api.get<{ item: ItemDTO; category: CategoryDTO; attachments: AttachmentDTO[] }>(`/api/items/${id}`);
  item.value = res.item;
  category.value = res.category;
  attachments.value = res.attachments;
}

// AI 处理中时定期刷新状态
let poll: number | undefined;
onMounted(async () => {
  await load();
  poll = window.setInterval(() => {
    if (attachments.value.some((a) => a.aiStatus === 'processing' || (a.aiStatus === 'pending' && !a.aiError))) load();
  }, 4000);
});
onBeforeUnmount(() => clearInterval(poll));

const images = computed(() => attachments.value.filter((a) => a.hasThumbnail));
const previewList = computed(() => images.value.map((a) => `/api/attachments/${a.id}/preview`));

const baseFields = computed(() => {
  const it = item.value;
  if (!it) return [];
  return [
    ['购入时间', it.purchaseDate],
    ['购入渠道', it.purchaseChannel],
    ['购入价', it.purchasePrice !== null ? fmtMoney(it.purchasePrice) : null],
    ['参考市价（自填）', it.marketPrice !== null ? fmtMoney(it.marketPrice) : null],
    ['存放位置', it.location],
    ['保险公司', it.insuranceCompany],
    ['保单号', it.insurancePolicyNo],
    ['保额', it.insuranceAmount !== null ? fmtMoney(it.insuranceAmount) : null],
    ['保险到期', it.insuranceExpiry],
    ['保养周期', it.maintenanceCycleDays ? `${it.maintenanceCycleDays} 天` : null],
    ['上次保养', it.lastMaintenanceDate],
    ['上次盘点', it.lastInventoryDate],
  ] as [string, string | null][];
});

const STATUS: Record<AiStatus, { label: string; type: 'info' | 'warning' | 'success' | 'danger' }> = {
  pending: { label: '等待识别', type: 'info' },
  processing: { label: '识别中', type: 'warning' },
  done: { label: '已识别', type: 'success' },
  failed: { label: '识别失败', type: 'danger' },
  skipped: { label: '无文字', type: 'info' },
};

const canDelete = (a: AttachmentDTO) =>
  CORE_ATTACHMENT_KINDS.includes(a.kind) ? session.can('file.deleteCore') : session.can('file.delete');

async function onFiles(e: Event) {
  const input = e.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (!files.length) return;
  uploading.value = true;
  await run(() => api.upload(`/api/items/${id}/attachments?kind=${uploadKind.value}`, files), `已上传 ${files.length} 个文件`);
  uploading.value = false;
  load();
}

async function removeAttachment(a: AttachmentDTO) {
  if (!(await confirm(`确定删除「${a.filename}」？删除后无法恢复。`, '删除文件'))) return;
  await run(() => api.del(`/api/attachments/${a.id}`), '已删除');
  load();
}

async function changeKind(a: AttachmentDTO, kind: AttachmentKind) {
  await run(() => api.patch(`/api/attachments/${a.id}`, { kind }), '已更新');
  load();
}

async function reprocess(a: AttachmentDTO) {
  await run(() => api.post(`/api/attachments/${a.id}/reprocess`), '已加入识别队列');
  load();
}

async function mark(kind: 'inventory' | 'maintenance') {
  const res = await run(() => api.post<ItemDTO>(`/api/items/${id}/${kind}`), kind === 'inventory' ? '已记录今日盘点' : '已记录今日保养');
  if (res) item.value = res;
}

async function removeItem() {
  const msg = `确定删除藏品「${item.value?.name}」及其全部 ${attachments.value.length} 个档案文件？此操作不可恢复。`;
  if (!(await confirm(msg, '删除藏品'))) return;
  if (await run(() => api.del(`/api/items/${id}`), '已删除')) router.replace('/items');
}
</script>

<template>
  <div class="page" v-if="item">
    <div class="page-head">
      <div>
        <h1>{{ item.name }}</h1>
        <div class="sub">
          <el-tag effect="plain">{{ category?.name }}</el-tag>
          <span class="code">{{ item.code }}</span>
          <span class="muted">更新于 {{ fmtTime(item.updatedAt) }}</span>
        </div>
      </div>
      <div class="actions">
        <el-button v-if="session.can('ai.ask')" icon="ChatLineSquare" @click="router.push({ path: '/ask', query: { itemId: id } })">
          就此藏品提问
        </el-button>
        <el-dropdown v-if="session.can('item.update')" trigger="click">
          <el-button icon="Calendar">记录</el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="mark('inventory')">今日已盘点</el-dropdown-item>
              <el-dropdown-item @click="mark('maintenance')">今日已保养</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
        <el-button v-if="session.can('item.update')" type="primary" icon="Edit" @click="router.push(`/items/${id}/edit`)">编辑</el-button>
        <el-button v-if="session.can('item.delete')" type="danger" plain icon="Delete" :loading="busy" @click="removeItem" />
      </div>
    </div>

    <section v-if="images.length" class="panel">
      <h2>影像</h2>
      <div class="gallery">
        <el-image
          v-for="(a, i) in images"
          :key="a.id"
          :src="`/api/attachments/${a.id}/thumb`"
          :preview-src-list="previewList"
          :initial-index="i"
          fit="cover"
          class="thumb"
          preview-teleported
          hide-on-click-modal
        />
      </div>
    </section>

    <div class="cols">
      <section class="panel">
        <h2>基本信息</h2>
        <el-descriptions :column="isMobile ? 1 : 2" border size="small">
          <el-descriptions-item v-for="[k, v] in baseFields" :key="k" :label="k">{{ v ?? '—' }}</el-descriptions-item>
        </el-descriptions>
        <template v-if="category?.fields.length">
          <h2 style="margin-top: 20px">{{ category.name }} · 专属信息</h2>
          <el-descriptions :column="isMobile ? 1 : 2" border size="small">
            <el-descriptions-item v-for="f in category.fields" :key="f.key" :label="f.label">
              <span style="white-space: pre-wrap">{{ item.attributes[f.key] ?? '—' }}</span>
            </el-descriptions-item>
          </el-descriptions>
        </template>
        <template v-if="item.notes">
          <h2 style="margin-top: 20px">备注</h2>
          <p class="notes">{{ item.notes }}</p>
        </template>
      </section>
    </div>

    <section class="panel">
      <div class="files-head">
        <h2>档案文件 <span class="muted">{{ attachments.length }}</span></h2>
        <div v-if="session.can('file.upload')" class="uploader">
          <el-select v-model="uploadKind" style="width: 130px">
            <el-option v-for="(label, k) in ATTACHMENT_KINDS" :key="k" :label="label" :value="k" />
          </el-select>
          <label class="el-button el-button--primary" :class="{ 'is-disabled': uploading }">
            <el-icon><Upload /></el-icon><span>{{ uploading ? '上传中…' : '选择文件' }}</span>
            <input type="file" multiple accept="image/*,application/pdf" hidden :disabled="uploading" @change="onFiles" />
          </label>
          <label v-if="isMobile" class="el-button" :class="{ 'is-disabled': uploading }">
            <el-icon><Camera /></el-icon><span>拍照</span>
            <input type="file" accept="image/*" capture="environment" hidden :disabled="uploading" @change="onFiles" />
          </label>
        </div>
      </div>
      <p class="muted" style="margin-top: 0">文件在主机上以 AES-256 加密保存；上传后自动在本地识别文字并生成摘要，不经过任何外部服务器。</p>

      <el-empty v-if="!attachments.length" description="还没有档案文件" :image-size="80" />
      <div v-for="a in attachments" :key="a.id" class="file">
        <div class="file-icon">
          <img v-if="a.hasThumbnail" :src="`/api/attachments/${a.id}/thumb`" alt="" />
          <el-icon v-else :size="26"><Document /></el-icon>
        </div>
        <div class="file-main">
          <div class="file-name">{{ a.filename }}</div>
          <div class="file-meta">
            <el-select
              v-if="session.can('file.upload')"
              :model-value="a.kind"
              size="small"
              style="width: 110px"
              @change="(k: AttachmentKind) => changeKind(a, k)"
            >
              <el-option v-for="(label, k) in ATTACHMENT_KINDS" :key="k" :label="label" :value="k" />
            </el-select>
            <el-tag v-else size="small" effect="plain">{{ ATTACHMENT_KINDS[a.kind] }}</el-tag>
            <el-tooltip :content="a.aiError ?? ''" :disabled="!a.aiError">
              <el-tag size="small" :type="STATUS[a.aiStatus].type">{{ STATUS[a.aiStatus].label }}{{ a.aiError ? ' ⓘ' : '' }}</el-tag>
            </el-tooltip>
            <span class="muted">{{ fmtSize(a.size) }} · {{ fmtTime(a.createdAt) }}</span>
          </div>
        </div>
        <div class="file-actions">
          <el-button link type="primary" @click="textDialogId = a.id">识别内容</el-button>
          <template v-if="session.can('file.download')">
            <el-button link type="primary" @click="openFile(`/api/attachments/${a.id}/download?inline=1`)">打开</el-button>
            <el-button link type="primary" @click="downloadFile(`/api/attachments/${a.id}/download`, a.filename)">下载</el-button>
          </template>
          <el-button v-if="session.can('ai.reprocess')" link @click="reprocess(a)">重新识别</el-button>
          <el-button v-if="canDelete(a)" link type="danger" @click="removeAttachment(a)">删除</el-button>
        </div>
      </div>
    </section>

    <AttachmentTextDialog :attachment-id="textDialogId" @close="textDialogId = null" />
  </div>
</template>

<style scoped>
.sub {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  flex-wrap: wrap;
}
.code {
  font-family: ui-monospace, monospace;
  font-size: 13px;
  color: var(--cat-ink-2);
}
.actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.actions .el-button + .el-button {
  margin-left: 0;
}
.gallery {
  display: flex;
  gap: 10px;
  overflow-x: auto;
  padding-bottom: 4px;
}
.thumb {
  width: 160px;
  height: 120px;
  border-radius: 8px;
  flex-shrink: 0;
  background: #efe8db;
  cursor: zoom-in;
}
.cols {
  margin-top: 16px;
}
.notes {
  white-space: pre-wrap;
  margin: 0;
  line-height: 1.7;
}
.files-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.files-head h2 {
  margin: 0;
}
.uploader {
  display: flex;
  gap: 8px;
}
.uploader .el-button + .el-button {
  margin-left: 0;
}
.uploader label.el-button {
  gap: 4px;
}
.file {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0;
  border-top: 1px solid var(--cat-line);
}
.file-icon {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  background: #efe8db;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  flex-shrink: 0;
  color: var(--cat-gold);
}
.file-icon img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.file-main {
  flex: 1;
  min-width: 0;
}
.file-name {
  font-size: 14px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 6px;
}
.file-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.file-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
}
@media (max-width: 768px) {
  .file {
    flex-wrap: wrap;
  }
  .file-actions {
    width: 100%;
    justify-content: flex-start;
  }
  .thumb {
    width: 120px;
    height: 90px;
  }
}
</style>
