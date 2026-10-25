<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { ItemDTO } from '@catalogue/shared';
import { api, fmtMoney } from '../api';
import { useSession } from '../stores/session';
import { useIsMobile } from '../composables';

const session = useSession();
const router = useRouter();
const route = useRoute();
const isMobile = useIsMobile();

const query = reactive({
  q: String(route.query.q ?? ''),
  categoryId: String(route.query.categoryId ?? ''),
  sort: 'updated',
  page: 1,
  pageSize: 24,
});
const rows = ref<ItemDTO[]>([]);
const total = ref(0);
const loading = ref(false);

async function load() {
  loading.value = true;
  try {
    const p = new URLSearchParams({ page: String(query.page), pageSize: String(query.pageSize), sort: query.sort });
    if (query.q) p.set('q', query.q);
    if (query.categoryId) p.set('categoryId', query.categoryId);
    const res = await api.get<{ total: number; rows: ItemDTO[] }>(`/api/items?${p}`);
    rows.value = res.rows;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

let debounce: number | undefined;
watch(
  () => query.q,
  () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => ((query.page = 1), load()), 300);
  },
);
watch(() => [query.categoryId, query.sort], () => ((query.page = 1), load()));
onMounted(load);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>藏品档案 <span class="muted">共 {{ total }} 件</span></h1>
      <el-button v-if="session.can('item.create')" type="primary" icon="Plus" @click="router.push('/items/new')">新建藏品</el-button>
    </div>

    <div class="filters">
      <el-input v-model="query.q" placeholder="搜索名称、编号、位置、备注、专属字段" clearable prefix-icon="Search" class="search" />
      <el-select v-model="query.sort" class="sort">
        <el-option label="最近更新" value="updated" />
        <el-option label="名称" value="name" />
        <el-option label="购入时间" value="purchaseDate" />
        <el-option label="购入价" value="purchasePrice" />
      </el-select>
    </div>
    <div class="chips">
      <el-check-tag :checked="!query.categoryId" @change="query.categoryId = ''">全部</el-check-tag>
      <el-check-tag
        v-for="c in session.categories"
        :key="c.id"
        :checked="query.categoryId === c.id"
        @change="query.categoryId = query.categoryId === c.id ? '' : c.id"
      >
        {{ c.name }}
      </el-check-tag>
    </div>

    <div v-loading="loading" class="grid">
      <router-link v-for="it in rows" :key="it.id" :to="`/items/${it.id}`" class="card">
        <div class="cover">
          <img v-if="it.coverAttachmentId" :src="`/api/attachments/${it.coverAttachmentId}/thumb`" alt="" loading="lazy" />
          <el-icon v-else :size="36" color="#c9bba3"><Picture /></el-icon>
        </div>
        <div class="body">
          <div class="name serif">{{ it.name }}</div>
          <div class="meta">
            <el-tag size="small" effect="plain">{{ session.categoryName(it.categoryId) }}</el-tag>
            <span class="code">{{ it.code }}</span>
          </div>
          <div class="row" v-if="it.location"><el-icon><Location /></el-icon>{{ it.location }}</div>
          <div class="row" v-if="it.purchasePrice !== null && !isMobile"><el-icon><Wallet /></el-icon>购入 {{ fmtMoney(it.purchasePrice) }}</div>
        </div>
      </router-link>
    </div>
    <el-empty v-if="!loading && !rows.length" description="还没有符合条件的藏品" />

    <el-pagination
      v-if="total > query.pageSize"
      v-model:current-page="query.page"
      :page-size="query.pageSize"
      :total="total"
      layout="prev, pager, next"
      :small="isMobile"
      class="pager"
      @current-change="load"
    />
  </div>
</template>

<style scoped>
.filters {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
}
.search {
  flex: 1;
}
.sort {
  width: 130px;
}
.chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 18px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
  min-height: 120px;
}
.card {
  background: var(--cat-card);
  border: 1px solid var(--cat-line);
  border-radius: 10px;
  overflow: hidden;
  text-decoration: none;
  transition: box-shadow 0.15s, transform 0.15s;
}
.card:hover {
  box-shadow: 0 6px 20px rgba(60, 45, 20, 0.12);
  transform: translateY(-2px);
}
.cover {
  aspect-ratio: 4 / 3;
  background: #efe8db;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.body {
  padding: 12px 14px 14px;
}
.name {
  font-size: 16px;
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.code {
  font-size: 12px;
  color: var(--cat-muted);
  font-family: ui-monospace, monospace;
}
.row {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  color: var(--cat-ink-2);
  margin-top: 2px;
}
.pager {
  margin-top: 20px;
  justify-content: center;
}
@media (max-width: 768px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 10px;
  }
  .sort {
    width: 110px;
  }
  .name {
    font-size: 14px;
  }
}
</style>
