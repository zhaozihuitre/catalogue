<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ROLE_LABELS, type SessionDTO } from '@catalogue/shared';
import { api, fmtTime } from '../api';
import { useSession } from '../stores/session';
import { useAction } from '../composables';

const session = useSession();
const sessions = ref<SessionDTO[]>([]);
const pw = reactive({ oldPassword: '', newPassword: '', confirm: '' });
const { busy, run } = useAction();

const load = async () => (sessions.value = await api.get<SessionDTO[]>('/api/auth/sessions'));

async function changePassword() {
  if (pw.newPassword !== pw.confirm) return run(() => Promise.reject(new Error('两次输入的新密码不一致')));
  const ok = await run(() => api.post('/api/auth/password', { oldPassword: pw.oldPassword, newPassword: pw.newPassword }), '密码已修改，其他设备已下线');
  if (ok) {
    Object.assign(pw, { oldPassword: '', newPassword: '', confirm: '' });
    load();
  }
}

async function revoke(s: SessionDTO) {
  await run(() => api.del(`/api/auth/sessions/${s.id}`), '该设备已下线');
  load();
}

onMounted(load);
</script>

<template>
  <div class="page">
    <div class="page-head"><h1>我的账号</h1></div>
    <section class="panel">
      <h2>{{ session.user?.displayName }}</h2>
      <p class="muted">{{ session.user?.username }} · {{ session.user && ROLE_LABELS[session.user.role] }}</p>
    </section>

    <section class="panel">
      <h2>修改密码</h2>
      <el-form label-position="top" class="pw" @submit.prevent="changePassword">
        <el-form-item label="原密码"><el-input v-model="pw.oldPassword" type="password" show-password autocomplete="current-password" /></el-form-item>
        <el-form-item label="新密码（至少 10 位，含字母和数字）">
          <el-input v-model="pw.newPassword" type="password" show-password autocomplete="new-password" />
        </el-form-item>
        <el-form-item label="确认新密码"><el-input v-model="pw.confirm" type="password" show-password autocomplete="new-password" /></el-form-item>
        <el-button type="primary" native-type="submit" :loading="busy" :disabled="!pw.oldPassword || !pw.newPassword">修改密码</el-button>
      </el-form>
    </section>

    <section class="panel">
      <h2>已登录设备</h2>
      <div v-for="s in sessions" :key="s.id" class="device">
        <div>
          <div>{{ s.device.slice(0, 80) }} <el-tag v-if="s.current" size="small" type="success">当前设备</el-tag></div>
          <div class="muted">{{ s.ip }} · 最近活跃 {{ fmtTime(s.lastSeenAt) }}</div>
        </div>
        <el-button v-if="!s.current" link type="danger" @click="revoke(s)">下线</el-button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.pw {
  max-width: 400px;
}
.device {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-top: 1px solid var(--cat-line);
  font-size: 14px;
  word-break: break-all;
}
</style>
