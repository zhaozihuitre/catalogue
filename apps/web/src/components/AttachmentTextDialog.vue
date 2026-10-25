<script setup lang="ts">
import { ref, watch } from 'vue';
import type { AiSummaryDTO, AttachmentDTO } from '@catalogue/shared';
import { api } from '../api';

const props = defineProps<{ attachmentId: string | null }>();
const emit = defineEmits<{ close: [] }>();

const data = ref<{ attachment: AttachmentDTO; text: string | null; summary: AiSummaryDTO | null } | null>(null);
const loading = ref(false);

watch(
  () => props.attachmentId,
  async (id) => {
    data.value = null;
    if (!id) return;
    loading.value = true;
    try {
      data.value = await api.get(`/api/attachments/${id}/text`);
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

const SUMMARY_LABELS: [keyof AiSummaryDTO, string][] = [
  ['conclusion', '结论要点'],
  ['era', '年代'],
  ['material', '材质'],
  ['institution', '出具机构'],
  ['riskNotes', '风险/限制说明'],
];
</script>

<template>
  <el-dialog :model-value="!!attachmentId" :title="data?.attachment.filename ?? '文档内容'" width="760px" @close="emit('close')">
    <div v-loading="loading">
      <template v-if="data">
        <div v-if="data.summary" class="summary">
          <div class="summary-head">
            <span class="serif">AI 摘要</span>
            <span class="muted">模型 {{ data.summary.model }}</span>
          </div>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item v-for="[k, label] in SUMMARY_LABELS" :key="k" :label="label">
              {{ data.summary[k] ?? '—' }}
            </el-descriptions-item>
          </el-descriptions>
          <p class="muted">AI 摘要仅为档案原文的信息提取，不构成鉴定或评估意见。</p>
        </div>
        <h3 class="serif">识别文本</h3>
        <pre v-if="data.text" class="text">{{ data.text }}</pre>
        <el-empty v-else :description="data.attachment.aiError ?? '尚未识别出文本'" :image-size="80" />
      </template>
    </div>
  </el-dialog>
</template>

<style scoped>
.summary {
  margin-bottom: 18px;
}
.summary-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 8px;
}
h3 {
  font-size: 15px;
  margin: 0 0 8px;
}
.text {
  white-space: pre-wrap;
  word-break: break-word;
  background: #f8f5ef;
  border: 1px solid var(--cat-line);
  border-radius: 6px;
  padding: 12px;
  max-height: 50vh;
  overflow: auto;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.7;
  margin: 0;
}
</style>
