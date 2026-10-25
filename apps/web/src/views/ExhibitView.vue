<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { ExhibitionDTO, ItemDTO } from '@catalogue/shared';
import { api, fmtTime } from '../api';
import { useSession } from '../stores/session';
import { confirm, useAction } from '../composables';

const session = useSession();
const router = useRouter();
const { busy, run } = useAction();

const exhibitions = ref<ExhibitionDTO[]>([]);
const allItems = ref<ItemDTO[]>([]);

const dialog = ref(false);
const form = reactive({ id: null as string | null, name: '', description: '', itemIds: [] as string[], intervalSec: 10 });

const itemById = computed(() => new Map(allItems.value.map((i) => [i.id, i])));

async function load() {
  exhibitions.value = await api.get<ExhibitionDTO[]>('/api/exhibitions');
}

/** 选择展品时需要全部藏品列表，分页取完 */
async function loadAllItems() {
  if (allItems.value.length) return;
  const out: ItemDTO[] = [];
  for (let page = 1; ; page++) {
    const res = await api.get<{ total: number; rows: ItemDTO[] }>(`/api/items?page=${page}&pageSize=100&sort=name`);
    out.push(...res.rows);
    if (out.length >= res.total || !res.rows.length) break;
  }
  allItems.value = out;
}

function play(query: Record<string, string>) {
  router.push({ path: '/exhibit/play', query });
}

async function edit(ex: ExhibitionDTO | null) {
  await loadAllItems();
  Object.assign(
    form,
    ex
      ? { id: ex.id, name: ex.name, description: ex.description ?? '', itemIds: [...ex.itemIds], intervalSec: ex.intervalSec }
      : { id: null, name: '', description: '', itemIds: [], intervalSec: 10 },
  );
  dialog.value = true;
}

function move(i: number, d: -1 | 1) {
  const ids = form.itemIds;
  const j = i + d;
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
}

async function save() {
  const body = { name: form.name, description: form.description || null, itemIds: form.itemIds, intervalSec: form.intervalSec };
  const ok = await run(
    () => (form.id ? api.put(`/api/exhibitions/${form.id}`, body) : api.post('/api/exhibitions', body)),
    '展览已保存',
  );
  if (ok) {
    dialog.value = false;
    load();
  }
}

async function remove(ex: ExhibitionDTO) {
  if (!(await confirm(`删除展览「${ex.name}」？藏品本身不会受影响。`, '删除展览'))) return;
  if (await run(() => api.del(`/api/exhibitions/${ex.id}`), '已删除')) load();
}

onMounted(load);
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h1>私人展览</h1>
      <el-button v-if="session.can('exhibit.manage')" type="primary" icon="Plus" @click="edit(null)">策划展览</el-button>
    </div>

    <el-alert type="info" :closable="false" show-icon class="tip">
      在客厅电视、投影或平板上打开本系统并登录（建议为电视单独创建一个"只读访客"账号），进入此页点"放映"即可。
      放映画面只展示藏品图片与名称、作者、年代等介绍信息，<b>不显示价格、存放位置、保险、证书编号等敏感信息</b>，也不提供任何公开分享链接。
    </el-alert>

    <section class="panel">
      <h2>快速放映</h2>
      <div class="quick">
        <el-button type="primary" plain icon="VideoPlay" @click="play({})">全部藏品</el-button>
        <el-button v-for="c in session.categories" :key="c.id" icon="VideoPlay" @click="play({ categoryId: c.id })">{{ c.name }}</el-button>
      </div>
    </section>

    <div class="cards">
      <div v-for="ex in exhibitions" :key="ex.id" class="panel card">
        <div class="card-body" @click="play({ exhibitionId: ex.id })">
          <el-icon :size="30" class="film"><Film /></el-icon>
          <h2>{{ ex.name }}</h2>
          <p class="muted desc">{{ ex.description || '　' }}</p>
          <p class="muted">{{ ex.itemIds.length }} 件展品 · 每张 {{ ex.intervalSec }} 秒 · 更新于 {{ fmtTime(ex.updatedAt).slice(0, 10) }}</p>
        </div>
        <div class="card-actions">
          <el-button type="primary" icon="VideoPlay" @click="play({ exhibitionId: ex.id })">放映</el-button>
          <template v-if="session.can('exhibit.manage')">
            <el-button icon="Edit" @click="edit(ex)" />
            <el-button icon="Delete" type="danger" plain @click="remove(ex)" />
          </template>
        </div>
      </div>
    </div>
    <el-empty v-if="!exhibitions.length" description="还没有策划的展览，可以先用上方的快速放映" :image-size="80" />

    <el-dialog v-model="dialog" :title="form.id ? '编辑展览' : '策划展览'" width="680px">
      <el-form label-position="top" @submit.prevent="save">
        <el-form-item label="展览名称" required>
          <el-input v-model="form.name" maxlength="60" placeholder="如：清代书画小展、名表专场" />
        </el-form-item>
        <el-form-item label="展览介绍（放映开场显示）">
          <el-input v-model="form.description" type="textarea" :rows="2" maxlength="500" />
        </el-form-item>
        <el-form-item label="每张停留时间（秒）">
          <el-input-number v-model="form.intervalSec" :min="3" :max="120" />
        </el-form-item>
        <el-form-item label="展品（按选择顺序放映，可调整）">
          <el-select v-model="form.itemIds" multiple filterable placeholder="搜索并选择藏品" style="width: 100%" :max-collapse-tags="3" collapse-tags>
            <el-option
              v-for="it in allItems"
              :key="it.id"
              :label="`${it.name}（${session.categoryName(it.categoryId)}）`"
              :value="it.id"
            >
              <span>{{ it.name }}</span>
              <span class="muted opt-cat">{{ session.categoryName(it.categoryId) }}{{ it.coverAttachmentId ? '' : ' · 无图片' }}</span>
            </el-option>
          </el-select>
        </el-form-item>
        <ol v-if="form.itemIds.length" class="order">
          <li v-for="(id, i) in form.itemIds" :key="id">
            <img v-if="itemById.get(id)?.coverAttachmentId" :src="`/api/attachments/${itemById.get(id)!.coverAttachmentId}/thumb`" alt="" />
            <span v-else class="noimg"><el-icon><Picture /></el-icon></span>
            <span class="order-name">{{ itemById.get(id)?.name ?? '（已删除）' }}</span>
            <el-button link icon="ArrowUp" :disabled="i === 0" @click="move(i, -1)" />
            <el-button link icon="ArrowDown" :disabled="i === form.itemIds.length - 1" @click="move(i, 1)" />
            <el-button link icon="Close" @click="form.itemIds.splice(i, 1)" />
          </li>
        </ol>
        <p class="muted">没有图片的藏品不会出现在放映中。</p>
      </el-form>
      <template #footer>
        <el-button @click="dialog = false">取消</el-button>
        <el-button type="primary" :loading="busy" :disabled="!form.name || !form.itemIds.length" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.tip {
  margin-bottom: 16px;
}
.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.quick .el-button + .el-button {
  margin-left: 0;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  margin-top: 16px;
}
.cards .panel + .panel {
  margin-top: 0;
}
.card {
  display: flex;
  flex-direction: column;
  background: linear-gradient(160deg, #2c251d, var(--cat-ink));
  border-color: #3a3127;
  color: #e9e1d2;
}
.card-body {
  flex: 1;
  cursor: pointer;
}
.film {
  color: var(--cat-gold-soft);
}
.card h2 {
  margin: 10px 0 4px;
  color: #f3ead8;
}
.card .muted {
  color: #a39885;
}
.desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.card-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}
.card-actions .el-button + .el-button {
  margin-left: 0;
}
.opt-cat {
  float: right;
  margin-left: 12px;
}
.order {
  list-style: none;
  padding: 0;
  margin: 0 0 8px;
  max-height: 280px;
  overflow: auto;
  border: 1px solid var(--cat-line);
  border-radius: 6px;
  counter-reset: n;
}
.order li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-top: 1px solid var(--cat-line);
  counter-increment: n;
}
.order li:first-child {
  border-top: none;
}
.order li::before {
  content: counter(n);
  width: 18px;
  color: var(--cat-muted);
  font-size: 12px;
}
.order img,
.noimg {
  width: 40px;
  height: 30px;
  object-fit: cover;
  border-radius: 4px;
  background: #efe8db;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #b9a98a;
}
.order-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
