<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ROLE_LABELS, type Permission } from '@catalogue/shared';
import { useSession } from '../stores/session';
import { useIsMobile } from '../composables';

const session = useSession();
const route = useRoute();
const router = useRouter();
const isMobile = useIsMobile();

interface NavItem {
  path: string;
  label: string;
  icon: string;
  perm?: Permission;
  mobile?: boolean;
}

const NAV: NavItem[] = [
  { path: '/items', label: '藏品档案', icon: 'Collection', mobile: true },
  { path: '/ask', label: 'AI 检索', icon: 'ChatLineSquare', perm: 'ai.ask', mobile: true },
  { path: '/exhibit', label: '展览', icon: 'Film', perm: 'exhibit.view', mobile: true },
  { path: '/notifications', label: '提醒', icon: 'Bell', mobile: true },
  { path: '/export', label: '数据导出', icon: 'Download', perm: 'export.stats' },
  { path: '/users', label: '账号管理', icon: 'User', perm: 'user.manage' },
  { path: '/audit', label: '审计日志', icon: 'Document', perm: 'audit.read' },
  { path: '/settings', label: '系统设置', icon: 'Setting', perm: 'settings.manage' },
];

const nav = computed(() => NAV.filter((n) => !n.perm || session.can(n.perm)));
const active = computed(() => '/' + (route.path.split('/')[1] ?? ''));

let timer: number | undefined;
onMounted(() => {
  session.refreshUnread();
  timer = window.setInterval(() => session.refreshUnread(), 60_000);
});
onBeforeUnmount(() => clearInterval(timer));

async function logout() {
  await session.logout();
  router.replace('/login');
}
</script>

<template>
  <div class="shell" :class="{ mobile: isMobile }">
    <aside v-if="!isMobile" class="side">
      <div class="brand">
        <img src="/favicon.svg" alt="" />
        <div>
          <div class="brand-name serif">藏册</div>
          <div class="brand-sub">Private Collection Vault</div>
        </div>
      </div>
      <nav>
        <router-link v-for="n in nav" :key="n.path" :to="n.path" class="nav-link" :class="{ on: active === n.path }">
          <el-icon><component :is="n.icon" /></el-icon>
          <span>{{ n.label }}</span>
          <el-badge v-if="n.path === '/notifications' && session.unread" :value="session.unread" :max="99" class="nav-badge" />
        </router-link>
      </nav>
      <div class="side-foot">
        <el-dropdown trigger="click" placement="top-start">
          <div class="me">
            <el-avatar :size="32">{{ session.user?.displayName.slice(0, 1) }}</el-avatar>
            <div>
              <div class="me-name">{{ session.user?.displayName }}</div>
              <div class="me-role">{{ session.user && ROLE_LABELS[session.user.role] }}</div>
            </div>
          </div>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item @click="router.push('/account')">我的账号与设备</el-dropdown-item>
              <el-dropdown-item divided @click="logout">退出登录</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </aside>

    <header v-else class="topbar">
      <span class="serif">藏册</span>
      <el-dropdown trigger="click">
        <el-avatar :size="28">{{ session.user?.displayName.slice(0, 1) }}</el-avatar>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item v-for="n in nav.filter((x) => !x.mobile)" :key="n.path" @click="router.push(n.path)">
              {{ n.label }}
            </el-dropdown-item>
            <el-dropdown-item divided @click="router.push('/account')">我的账号与设备</el-dropdown-item>
            <el-dropdown-item @click="logout">退出登录</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </header>

    <main class="main">
      <router-view />
      <footer class="disclaimer">
        数据存储于您自有的设备，不上传任何第三方云端。AI 结果仅作档案查阅参考，不具备鉴定、评估法律效力。
      </footer>
    </main>

    <nav v-if="isMobile" class="tabbar">
      <router-link
        v-for="n in nav.filter((x) => x.mobile)"
        :key="n.path"
        :to="n.path"
        class="tab"
        :class="{ on: active === n.path }"
      >
        <el-badge :value="session.unread" :hidden="n.path !== '/notifications' || !session.unread" :max="99">
          <el-icon :size="22"><component :is="n.icon" /></el-icon>
        </el-badge>
        <span>{{ n.label }}</span>
      </router-link>
    </nav>
  </div>
</template>

<style scoped>
.shell {
  display: flex;
  min-height: 100vh;
}
.side {
  width: 220px;
  flex-shrink: 0;
  background: var(--cat-ink);
  color: #e9e1d2;
  display: flex;
  flex-direction: column;
  position: sticky;
  top: 0;
  height: 100vh;
}
.brand {
  display: flex;
  gap: 10px;
  align-items: center;
  padding: 22px 18px;
  border-bottom: 1px solid #3a3127;
}
.brand img {
  width: 36px;
  height: 36px;
}
.brand-name {
  font-size: 20px;
  color: var(--cat-gold-soft);
}
.brand-sub {
  font-size: 10px;
  letter-spacing: 0.08em;
  color: #8a8074;
  text-transform: uppercase;
}
nav {
  padding: 12px 10px;
  flex: 1;
}
.nav-link {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  color: #cfc5b3;
  text-decoration: none;
  font-size: 14px;
  margin-bottom: 2px;
}
.nav-link:hover {
  background: #2c251d;
}
.nav-link.on {
  background: #3a3127;
  color: var(--cat-gold-soft);
}
.nav-badge {
  margin-left: auto;
}
.side-foot {
  padding: 14px;
  border-top: 1px solid #3a3127;
}
.me {
  display: flex;
  gap: 10px;
  align-items: center;
  cursor: pointer;
  color: #e9e1d2;
}
.me-name {
  font-size: 14px;
}
.me-role {
  font-size: 11px;
  color: #8a8074;
}
.main {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.main > :first-child {
  flex: 1;
}
.topbar {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 20;
  height: calc(48px + env(safe-area-inset-top));
  padding: env(safe-area-inset-top) 14px 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--cat-ink);
  color: var(--cat-gold-soft);
  font-size: 18px;
}
.mobile .main {
  padding-top: calc(48px + env(safe-area-inset-top));
  padding-bottom: calc(60px + env(safe-area-inset-bottom));
}
.tabbar {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  z-index: 20;
  display: flex;
  padding: 0 0 env(safe-area-inset-bottom);
  background: var(--cat-card);
  border-top: 1px solid var(--cat-line);
}
.tab {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 8px 0 6px;
  font-size: 11px;
  color: var(--cat-muted);
  text-decoration: none;
}
.tab.on {
  color: var(--el-color-primary);
}
</style>
