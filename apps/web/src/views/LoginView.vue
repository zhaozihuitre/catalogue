<script setup lang="ts">
import { reactive } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSession } from '../stores/session';
import { useAction } from '../composables';
import AuthCard from '../components/AuthCard.vue';

const router = useRouter();
const route = useRoute();
const session = useSession();
const form = reactive({ username: '', password: '' });
const { busy, run } = useAction();

async function submit() {
  const ok = await run(() => session.login(form.username, form.password).then(() => true));
  form.password = '';
  if (ok) {
    const redirect = typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/') ? route.query.redirect : '/items';
    router.replace(redirect);
  }
}
</script>

<template>
  <AuthCard title="藏册" subtitle="私有化藏品 AI 档案系统">
    <el-form @submit.prevent="submit">
      <el-form-item>
        <el-input v-model="form.username" size="large" placeholder="用户名" autocomplete="username" autofocus />
      </el-form-item>
      <el-form-item>
        <el-input v-model="form.password" size="large" type="password" placeholder="密码" show-password autocomplete="current-password" />
      </el-form-item>
      <el-button
        type="primary"
        size="large"
        native-type="submit"
        :loading="busy"
        :disabled="!form.username || !form.password"
        style="width: 100%"
      >
        登录
      </el-button>
    </el-form>
  </AuthCard>
</template>
