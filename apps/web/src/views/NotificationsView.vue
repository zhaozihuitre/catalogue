<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import type { NotificationDTO, NotificationType } from '@catalogue/shared';
import { api, fmtTime } from '../api';
import { useSession } from '../stores/session';
import { useAction } from '../composables';

const session = useSession();
const router = useRouter();
const list = ref<NotificationDTO[]>([]);
const unreadOnly = ref(false);
const loading = ref(false);
const { run } = useAction();

const TYPES: Record<NotificationType, { label: string; icon: string; color: string }> = {
  insurance_expiry: { label: '保险', icon: 'Umbrella', color: '#b2442f' },
  maintenance_due: { label: '保养', icon: 'Tools', color: '#8a6d34' },
  inventory_overdue: { label: '盘点', icon: 'List', color: '#4a6a8a' },
};

async function load() {
  loading.value = true;
  try {
    list.value = await api.get<NotificationDTO[]>(`/api/notifications${unreadOnly.value ? '?unread=1' : ''}`);
  } finally {
    loading.value = false;
  }
  session.refreshUnread();
}

async function open(n: NotificationDTO) {
  if (!n.read) {
    await api.post(`/api/notifications/${n.id}/read`);
    n.read = true;
    session.refreshUnread();
  }
  if (n.itemId) router.push(`/items/${n.itemId}`);
}

async function readAll() {
  await run(() => api.post('/api/notifications/read-all'), '已全部标为已读');
  load();
}

async function scanNow() {
  const res = await run(() => api.post<{ created: number }>('/api/reminders/run'));
  if (res) {
    await load();
    ElMessage.success(res.created ? `新增 ${res.created} 条提醒` : '没有新的提醒');
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>到期提醒</h1>
      <div class="tools">
        <el-switch v-model="unreadOnly" active-text="只看未读" @change="load" />
        <el-button size="small" @click="readAll">全部已读</el-button>
        <el-button v-if="session.can('settings.manage')" size="small" @click="scanNow">立即检查</el-button>
      </div>
    </div>
    <p class="muted">系统每天 8:00 自动检查保险到期、保养到期和长期未盘点的藏品。</p>

    <div v-loading="loading" class="list">
      <div v-for="n in list" :key="n.id" class="note panel" :class="{ unread: !n.read }" @click="open(n)">
        <el-icon :size="22" :color="TYPES[n.type].color"><component :is="TYPES[n.type].icon" /></el-icon>
        <div class="body">
          <div class="title">
            <span>{{ n.title }}</span>
            <el-tag size="small" effect="plain">{{ TYPES[n.type].label }}</el-tag>
          </div>
          <div class="text">{{ n.body }}</div>
          <div class="muted">{{ fmtTime(n.createdAt) }}</div>
        </div>
        <span v-if="!n.read" class="dot" />
      </div>
      <el-empty v-if="!loading && !list.length" description="暂无提醒" />
    </div>
  </div>
</template>

<style scoped>
.tools {
  display: flex;
  align-items: center;
  gap: 10px;
}
.tools .el-button + .el-button {
  margin-left: 0;
}
.list {
  min-height: 100px;
}
.note {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  cursor: pointer;
  position: relative;
  padding: 14px 16px;
}
.note + .note {
  margin-top: 10px;
}
.note:not(.unread) {
  opacity: 0.7;
}
.body {
  flex: 1;
}
.title {
  display: flex;
  gap: 8px;
  align-items: center;
  font-weight: 600;
  margin-bottom: 4px;
}
.text {
  font-size: 14px;
  margin-bottom: 4px;
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--cat-danger);
  margin-top: 6px;
}
</style>
