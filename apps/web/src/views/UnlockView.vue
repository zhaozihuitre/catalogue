<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api } from '../api';
import { useSession } from '../stores/session';
import { useAction } from '../composables';
import AuthCard from '../components/AuthCard.vue';

const router = useRouter();
const session = useSession();
const passphrase = ref('');
const { busy, run } = useAction();

async function unlock() {
  const ok = await run(() => api.post('/api/system/unlock', { passphrase: passphrase.value }));
  passphrase.value = '';
  if (ok) {
    await session.loadStatus();
    router.replace('/login');
  }
}
</script>

<template>
  <AuthCard title="系统已锁定" subtitle="请输入主口令解密档案库">
    <el-alert v-if="session.status && !session.status.initialized" type="warning" :closable="false" show-icon>
      系统尚未初始化，请在主机上运行 <code>npm run init</code>。
    </el-alert>
    <el-form v-else @submit.prevent="unlock">
      <el-form-item>
        <el-input
          v-model="passphrase"
          type="password"
          size="large"
          placeholder="主口令"
          show-password
          autocomplete="off"
          autofocus
        />
      </el-form-item>
      <el-button type="primary" size="large" native-type="submit" :loading="busy" :disabled="!passphrase" style="width: 100%">
        解锁
      </el-button>
      <p class="muted" style="margin-top: 16px">主口令仅保存在主机内存中，服务商无法获取或找回。</p>
    </el-form>
  </AuthCard>
</template>
