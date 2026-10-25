<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSession } from '../stores/session';
import AuthCard from '../components/AuthCard.vue';

const router = useRouter();
const route = useRoute();
const session = useSession();
const busy = ref(false);
const failed = ref(false);

async function retry() {
  busy.value = true;
  failed.value = false;
  try {
    await session.loadStatus();
    const back = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/items';
    await router.replace(back);
  } catch {
    failed.value = true;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <AuthCard title="无法连接到藏册主机" subtitle="档案保存在您的主机上，需要能访问到它">
    <ul class="tips">
      <li>确认手机与主机连在同一个 Wi-Fi，或已开启远程访问（Tailscale）</li>
      <li>确认主机已开机、藏册服务正在运行</li>
    </ul>
    <el-alert v-if="failed" type="error" title="仍然无法连接" :closable="false" show-icon class="alert" />
    <el-button type="primary" size="large" :loading="busy" style="width: 100%" @click="retry">重试</el-button>
  </AuthCard>
</template>

<style scoped>
.tips {
  text-align: left;
  color: var(--cat-ink-2);
  font-size: 14px;
  line-height: 1.8;
  padding-left: 20px;
  margin: 0 0 16px;
}
.alert {
  margin-bottom: 12px;
}
</style>
