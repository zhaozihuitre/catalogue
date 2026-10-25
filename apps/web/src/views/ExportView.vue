<script setup lang="ts">
import type { Permission } from '@catalogue/shared';
import { downloadFile } from '../api';
import { useSession } from '../stores/session';
import { useAction } from '../composables';

const session = useSession();
const { busy, run } = useAction();

const EXPORTS: { key: string; name: string; desc: string; perm: Permission; icon: string }[] = [
  { key: 'ledger', name: '藏品台账', desc: '全部藏品的基础信息，以及按分类拆分的专属字段明细。', perm: 'export.ledger', icon: 'Notebook' },
  { key: 'insurance', name: '保险清单', desc: '各藏品的保险公司、保单号、保额与到期状态，按到期先后排序。', perm: 'export.insurance', icon: 'Umbrella' },
  { key: 'stats', name: '藏品统计', desc: '按分类汇总藏品数量、购入价、参考市价与保额。', perm: 'export.stats', icon: 'DataAnalysis' },
];

const today = new Date().toISOString().slice(0, 10);
const download = (key: string, name: string) =>
  run(() => downloadFile(`/api/export/${key}.xlsx`, `${name}_${today}.xlsx`), '已开始下载');
</script>

<template>
  <div class="page">
    <div class="page-head"><h1>数据导出</h1></div>
    <el-alert type="info" :closable="false" show-icon class="tip">
      导出的 Excel 文件为明文，请妥善保管，避免通过微信、邮件等第三方渠道传输。每次导出都会记录在审计日志中。
    </el-alert>
    <div class="cards">
      <div v-for="e in EXPORTS" :key="e.key" class="panel card">
        <el-icon :size="28" color="var(--el-color-primary)"><component :is="e.icon" /></el-icon>
        <h2>{{ e.name }}</h2>
        <p class="muted">{{ e.desc }}</p>
        <el-button v-if="session.can(e.perm)" type="primary" :loading="busy" @click="download(e.key, e.name)">导出 Excel</el-button>
        <el-tag v-else type="info">仅藏家本人可导出</el-tag>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tip {
  margin-bottom: 16px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}
.card h2 {
  margin: 10px 0 6px;
}
.card p {
  min-height: 40px;
}
.panel + .panel {
  margin-top: 0;
}
</style>
