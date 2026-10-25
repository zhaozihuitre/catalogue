<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import type { AuditLogDTO, UserDTO } from '@catalogue/shared';
import { api, fmtTime } from '../api';

const ACTIONS: Record<string, string> = {
  'system.init': '系统初始化',
  'system.unlock': '解锁系统',
  'system.lock': '锁定系统',
  'auth.login': '登录',
  'auth.login.failed': '登录失败',
  'auth.logout': '退出登录',
  'auth.password.change': '修改密码',
  'session.revoke': '下线设备',
  'session.revokeAll': '强制下线',
  'user.create': '新建账号',
  'user.update': '修改账号',
  'item.create': '新增藏品',
  'item.update': '修改藏品',
  'item.delete': '删除藏品',
  'item.inventory': '记录盘点',
  'item.maintenance': '记录保养',
  'category.create': '新建分类',
  'category.update': '修改分类',
  'category.delete': '删除分类',
  'file.upload': '上传文件',
  'file.preview': '预览图片',
  'file.viewText': '查看识别文本',
  'file.open': '打开原件',
  'file.download': '下载原件',
  'file.delete': '删除文件',
  'file.updateKind': '修改文件类型',
  'ai.ask': 'AI 问答',
  'ai.reprocess': '重新识别',
  export: '数据导出',
  'reminder.run': '手动检查提醒',
  'reminder.scan': '定时检查提醒',
  'settings.update': '修改设置',
  'settings.smtpTest': '测试邮件',
  'permission.denied': '越权尝试',
};

const filters = reactive({ userId: '', action: '', range: [] as string[], page: 1, pageSize: 50 });
const rows = ref<AuditLogDTO[]>([]);
const total = ref(0);
const users = ref<UserDTO[]>([]);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const p = new URLSearchParams({ page: String(filters.page), pageSize: String(filters.pageSize) });
    if (filters.userId) p.set('userId', filters.userId);
    if (filters.action) p.set('action', filters.action);
    if (filters.range?.length === 2) {
      p.set('from', new Date(filters.range[0]).toISOString());
      p.set('to', new Date(`${filters.range[1]}T23:59:59.999`).toISOString());
    }
    const res = await api.get<{ total: number; rows: AuditLogDTO[] }>(`/api/audit?${p}`);
    rows.value = res.rows;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

function search() {
  filters.page = 1;
  load();
}

function detail(d: string | null): string {
  if (!d) return '';
  try {
    return JSON.stringify(JSON.parse(d), null, 2);
  } catch {
    return d;
  }
}

onMounted(async () => {
  users.value = await api.get<UserDTO[]>('/api/users');
  load();
});
</script>

<template>
  <div class="page">
    <div class="page-head"><h1>审计日志</h1></div>
    <div class="filters">
      <el-select v-model="filters.userId" placeholder="全部账号" clearable style="width: 150px" @change="search">
        <el-option v-for="u in users" :key="u.id" :label="u.displayName" :value="u.id" />
      </el-select>
      <el-select v-model="filters.action" placeholder="全部操作" clearable filterable style="width: 170px" @change="search">
        <el-option v-for="(label, k) in ACTIONS" :key="k" :label="label" :value="k" />
      </el-select>
      <el-date-picker
        v-model="filters.range"
        type="daterange"
        value-format="YYYY-MM-DD"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        style="max-width: 280px"
        @change="search"
      />
    </div>

    <section class="panel">
      <el-table v-loading="loading" :data="rows" size="small">
        <el-table-column type="expand">
          <template #default="{ row }">
            <pre class="detail">{{ detail(row.detail) || '无详细信息' }}</pre>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="账号" width="110">
          <template #default="{ row }">{{ row.username ?? '系统' }}</template>
        </el-table-column>
        <el-table-column label="操作" min-width="130">
          <template #default="{ row }">
            <el-tag
              size="small"
              :type="row.action === 'permission.denied' || row.action === 'auth.login.failed' ? 'danger' : row.action.endsWith('delete') ? 'warning' : 'info'"
            >
              {{ ACTIONS[row.action] ?? row.action }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="target" label="对象" min-width="160" show-overflow-tooltip class-name="hide-mobile" label-class-name="hide-mobile" />
        <el-table-column prop="ip" label="IP" width="130" class-name="hide-mobile" label-class-name="hide-mobile" />
      </el-table>
      <el-pagination
        v-if="total > filters.pageSize"
        v-model:current-page="filters.page"
        :page-size="filters.pageSize"
        :total="total"
        layout="total, prev, pager, next"
        class="pager"
        @current-change="load"
      />
    </section>
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.detail {
  margin: 0 16px;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 300px;
  overflow: auto;
}
.pager {
  margin-top: 14px;
  justify-content: flex-end;
}
</style>
