import { defineStore } from 'pinia';
import { can as canDo, type CategoryDTO, type Permission, type UserDTO } from '@catalogue/shared';
import { api } from '../api';

interface Status {
  initialized: boolean;
  locked: boolean;
}

export const useSession = defineStore('session', {
  state: () => ({
    status: null as Status | null,
    user: null as UserDTO | null,
    categories: [] as CategoryDTO[],
    unread: 0,
  }),
  getters: {
    can: (s) => (p: Permission) => canDo(s.user?.role, p),
    categoryName: (s) => (id: string) => s.categories.find((c) => c.id === id)?.name ?? '未分类',
  },
  actions: {
    async loadStatus() {
      this.status = await api.get<Status>('/api/system/status');
      return this.status;
    },
    async loadMe() {
      try {
        this.user = (await api.get<{ user: UserDTO }>('/api/auth/me')).user;
      } catch {
        this.user = null;
      }
      return this.user;
    },
    async loadCategories() {
      this.categories = await api.get<CategoryDTO[]>('/api/categories');
    },
    async refreshUnread() {
      if (!this.user) return;
      try {
        this.unread = (await api.get<{ count: number }>('/api/notifications/unread-count')).count;
      } catch {
        /* 忽略 */
      }
    },
    async login(username: string, password: string) {
      this.user = (await api.post<{ user: UserDTO }>('/api/auth/login', { username, password })).user;
      await this.loadCategories();
    },
    async logout() {
      try {
        await api.post('/api/auth/logout');
      } finally {
        this.clearLocal();
      }
    },
    /** 退出时清空本地一切存储，手机上不留痕 */
    clearLocal() {
      this.user = null;
      this.categories = [];
      this.unread = 0;
      try {
        localStorage.clear();
        sessionStorage.clear();
      } catch {
        /* 隐私模式等情况 */
      }
      if ('caches' in window) {
        caches
          .keys()
          .then((keys) => keys.forEach((k) => caches.delete(k)))
          .catch(() => {});
      }
    },
  },
});
