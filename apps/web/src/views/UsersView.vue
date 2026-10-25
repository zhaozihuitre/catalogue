<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ROLE_LABELS, ROLES, type Role, type SessionDTO, type UserDTO } from '@catalogue/shared';
import { api, fmtTime } from '../api';
import { useSession } from '../stores/session';
import { confirm, useAction } from '../composables';

const session = useSession();
const users = ref<UserDTO[]>([]);
const sessions = ref<SessionDTO[]>([]);
const { busy, run } = useAction();

const dialog = ref(false);
const editing = ref<UserDTO | null>(null);
const form = reactive({ username: '', displayName: '', password: '', role: 'assistant' as Role });

const ROLE_DESC: Record<Role, string> = {
  owner: '全部权限：账号管理、增删改查、全量导出、强制下线设备',
  assistant: '新增、编辑、上传档案；不能删除藏品和核心档案，不能导出全台账',
  viewer: '仅查看：不能下载原件、编辑或导出',
};

async function load() {
  [users.value, sessions.value] = await Promise.all([
    api.get<UserDTO[]>('/api/users'),
    api.get<SessionDTO[]>('/api/auth/sessions?all=1'),
  ]);
}

function openCreate() {
  editing.value = null;
  Object.assign(form, { username: '', displayName: '', password: '', role: 'assistant' });
  dialog.value = true;
}

function openEdit(u: UserDTO) {
  editing.value = u;
  Object.assign(form, { username: u.username, displayName: u.displayName, password: '', role: u.role });
  dialog.value = true;
}

async function save() {
  const ok = editing.value
    ? await run(
        () =>
          api.patch(`/api/users/${editing.value!.id}`, {
            displayName: form.displayName,
            role: form.role,
            ...(form.password ? { password: form.password } : {}),
          }),
        '已保存',
      )
    : await run(() => api.post('/api/users', form), '账号已创建');
  if (ok) {
    dialog.value = false;
    load();
  }
}

async function toggleDisabled(u: UserDTO) {
  if (!u.disabled && !(await confirm(`停用后「${u.displayName}」的所有设备将立即下线。`, '停用账号'))) return;
  await run(() => api.patch(`/api/users/${u.id}`, { disabled: !u.disabled }), u.disabled ? '已启用' : '已停用');
  load();
}

async function kick(u: UserDTO) {
  if (!(await confirm(`将「${u.displayName}」的所有设备强制下线？`, '强制下线'))) return;
  await run(() => api.post(`/api/users/${u.id}/revoke-sessions`), '已强制下线');
  load();
}

async function revoke(s: SessionDTO) {
  await run(() => api.del(`/api/auth/sessions/${s.id}`), '该设备已下线');
  load();
}

const deviceName = (ua: string) =>
  /iPhone|iPad/.test(ua) ? 'iOS 设备' : /Android/.test(ua) ? 'Android 设备' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : ua.slice(0, 40);

onMounted(load);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>账号管理</h1>
      <el-button type="primary" icon="Plus" @click="openCreate">新建账号</el-button>
    </div>

    <section class="panel">
      <el-table :data="users" style="width: 100%">
        <el-table-column label="账号" min-width="160">
          <template #default="{ row }">
            <div>{{ row.displayName }}</div>
            <div class="muted">{{ row.username }}</div>
          </template>
        </el-table-column>
        <el-table-column label="角色" min-width="140">
          <template #default="{ row }">
            <el-tag :type="row.role === 'owner' ? 'warning' : row.role === 'assistant' ? 'primary' : 'info'">
              {{ ROLE_LABELS[row.role as Role] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.disabled ? 'danger' : 'success'" effect="plain">{{ row.disabled ? '已停用' : '正常' }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="在线设备" width="90" class-name="hide-mobile" label-class-name="hide-mobile">
          <template #default="{ row }">{{ sessions.filter((s) => s.userId === row.id).length }}</template>
        </el-table-column>
        <el-table-column label="操作" min-width="220" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row as UserDTO)">编辑</el-button>
            <el-button link type="primary" :disabled="row.id === session.user?.id" @click="kick(row as UserDTO)">强制下线</el-button>
            <el-button link :type="row.disabled ? 'success' : 'danger'" :disabled="row.id === session.user?.id" @click="toggleDisabled(row as UserDTO)">
              {{ row.disabled ? '启用' : '停用' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="panel">
      <h2>全部在线设备</h2>
      <el-table :data="sessions" size="small">
        <el-table-column prop="username" label="账号" width="120" />
        <el-table-column label="设备" min-width="140">
          <template #default="{ row }">{{ deviceName(row.device) }}</template>
        </el-table-column>
        <el-table-column prop="ip" label="IP" width="140" class-name="hide-mobile" label-class-name="hide-mobile" />
        <el-table-column label="最近活跃" width="170">
          <template #default="{ row }">{{ fmtTime(row.lastSeenAt) }}</template>
        </el-table-column>
        <el-table-column width="80">
          <template #default="{ row }">
            <el-button link type="danger" :disabled="row.current" @click="revoke(row as SessionDTO)">下线</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <el-dialog v-model="dialog" :title="editing ? '编辑账号' : '新建账号'" width="480px">
      <el-form label-position="top" @submit.prevent="save">
        <el-form-item label="用户名" required>
          <el-input v-model="form.username" :disabled="!!editing" autocomplete="off" />
        </el-form-item>
        <el-form-item label="显示名称">
          <el-input v-model="form.displayName" placeholder="如：王助理、家人" />
        </el-form-item>
        <el-form-item :label="editing ? '重置密码（留空不修改）' : '初始密码'" :required="!editing">
          <el-input v-model="form.password" type="password" show-password autocomplete="new-password" placeholder="至少 10 位，含字母和数字" />
        </el-form-item>
        <el-form-item label="角色" required>
          <el-radio-group v-model="form.role" class="roles">
            <el-radio v-for="r in ROLES" :key="r" :value="r" border>
              <div class="role-label">{{ ROLE_LABELS[r] }}</div>
              <div class="muted role-desc">{{ ROLE_DESC[r] }}</div>
            </el-radio>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="busy" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.roles {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 8px;
  width: 100%;
}
.roles .el-radio {
  height: auto;
  padding: 8px 12px;
  margin-right: 0;
  white-space: normal;
}
.role-label {
  font-weight: 600;
}
.role-desc {
  font-size: 12px;
  line-height: 1.5;
}
</style>
