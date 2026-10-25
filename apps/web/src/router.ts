import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import type { Permission } from '@catalogue/shared';
import { useSession } from './stores/session';
import { setAuthErrorHandler } from './api';

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean;
    perm?: Permission;
    title?: string;
  }
}

const routes: RouteRecordRaw[] = [
  { path: '/unlock', component: () => import('./views/UnlockView.vue'), meta: { public: true, title: '解锁' } },
  { path: '/login', component: () => import('./views/LoginView.vue'), meta: { public: true, title: '登录' } },
  { path: '/offline', component: () => import('./views/OfflineView.vue'), meta: { public: true, title: '无法连接' } },
  // 放映页不套主布局，整屏显示
  { path: '/exhibit/play', component: () => import('./views/ExhibitPlayerView.vue'), meta: { perm: 'exhibit.view', title: '放映' } },
  {
    path: '/',
    component: () => import('./layouts/MainLayout.vue'),
    children: [
      { path: '', redirect: '/items' },
      { path: 'items', component: () => import('./views/ItemsView.vue'), meta: { title: '藏品档案' } },
      { path: 'items/new', component: () => import('./views/ItemEditView.vue'), meta: { perm: 'item.create', title: '新建藏品' } },
      { path: 'items/:id', component: () => import('./views/ItemDetailView.vue'), meta: { title: '藏品详情' } },
      { path: 'items/:id/edit', component: () => import('./views/ItemEditView.vue'), meta: { perm: 'item.update', title: '编辑藏品' } },
      { path: 'ask', component: () => import('./views/AskView.vue'), meta: { perm: 'ai.ask', title: 'AI 检索' } },
      { path: 'exhibit', component: () => import('./views/ExhibitView.vue'), meta: { perm: 'exhibit.view', title: '私人展览' } },
      { path: 'notifications', component: () => import('./views/NotificationsView.vue'), meta: { title: '提醒' } },
      { path: 'export', component: () => import('./views/ExportView.vue'), meta: { perm: 'export.stats', title: '数据导出' } },
      { path: 'users', component: () => import('./views/UsersView.vue'), meta: { perm: 'user.manage', title: '账号管理' } },
      { path: 'audit', component: () => import('./views/AuditView.vue'), meta: { perm: 'audit.read', title: '审计日志' } },
      { path: 'settings', component: () => import('./views/SettingsView.vue'), meta: { perm: 'settings.manage', title: '系统设置' } },
      { path: 'account', component: () => import('./views/AccountView.vue'), meta: { title: '我的账号' } },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: '/items' },
];

export const router = createRouter({ history: createWebHistory(), routes });

router.beforeEach(async (to) => {
  const session = useSession();
  if (to.path === '/offline') return true;
  let status = session.status;
  if (!status) {
    try {
      status = await session.loadStatus();
    } catch {
      // 主机不可达（离线、断电、不在同一网络）：给出提示页，而不是停在空白页
      return { path: '/offline', query: { redirect: to.fullPath } };
    }
  }
  if (status.locked) return to.path === '/unlock' ? true : '/unlock';
  if (to.path === '/unlock') return '/login';
  if (to.meta.public) return true;

  if (!session.user && !(await session.loadMe())) return { path: '/login', query: { redirect: to.fullPath } };
  if (!session.categories.length) await session.loadCategories();
  if (to.meta.perm && !session.can(to.meta.perm)) return '/items';
  return true;
});

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · 藏册` : '藏册 Catalogue';
});

setAuthErrorHandler(async (status) => {
  const session = useSession();
  if (status === 423) {
    session.status = { initialized: true, locked: true };
    session.clearLocal();
    await router.replace('/unlock');
  } else if (router.currentRoute.value.meta.public !== true) {
    session.clearLocal();
    await router.replace({ path: '/login', query: { redirect: router.currentRoute.value.fullPath } });
  }
});
