<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import type { AiAnswer, AiHealth, ItemDTO } from '@catalogue/shared';
import { AI_DISCLAIMER } from '@catalogue/shared';
import { api } from '../api';

interface Turn {
  question: string;
  answer: AiAnswer | null;
  error?: string;
}

const route = useRoute();
const health = ref<AiHealth | null>(null);
const question = ref('');
const turns = ref<Turn[]>([]);
const busy = ref(false);
const scope = ref<ItemDTO | null>(null);
const listEl = ref<HTMLElement>();

const EXAMPLES = ['我的劳力士放在哪里？', '哪些藏品的保险今年到期？', '翡翠手镯的鉴定机构和证书编号是什么？', '书画的装裱方式都有哪些记录？'];

onMounted(async () => {
  api.get<AiHealth>('/api/ai/health').then((h) => (health.value = h)).catch(() => {});
  const itemId = route.query.itemId;
  if (typeof itemId === 'string') scope.value = (await api.get<{ item: ItemDTO }>(`/api/items/${itemId}`)).item;
});

async function ask(q = question.value.trim()) {
  if (!q || busy.value) return;
  question.value = '';
  const turn: Turn = { question: q, answer: null };
  turns.value.push(turn);
  busy.value = true;
  scrollDown();
  try {
    turn.answer = await api.post<AiAnswer>('/api/ai/ask', { question: q, itemId: scope.value?.id });
  } catch (e) {
    turn.error = (e as Error).message;
  } finally {
    busy.value = false;
    // 触发 turns 的响应式更新
    turns.value = [...turns.value];
    scrollDown();
  }
}

function scrollDown() {
  nextTick(() => listEl.value?.scrollTo({ top: listEl.value.scrollHeight, behavior: 'smooth' }));
}
</script>

<template>
  <div class="page ask">
    <div class="page-head">
      <h1>AI 档案检索</h1>
      <el-tag v-if="scope" closable @close="scope = null">仅检索：{{ scope.name }}</el-tag>
    </div>

    <el-alert v-if="health?.message" type="warning" :closable="false" show-icon :title="health.message" class="health" />

    <div ref="listEl" class="turns">
      <div v-if="!turns.length" class="intro panel">
        <p class="serif intro-title">用自然语言查询你的档案</p>
        <p class="muted">
          AI 只依据已录入的藏品信息和档案文件作答，找不到就回答"无记录"。不提供估值、行情或真伪判断。所有计算都在本机完成。
        </p>
        <div class="examples">
          <el-button v-for="e in EXAMPLES" :key="e" round size="small" @click="ask(e)">{{ e }}</el-button>
        </div>
      </div>

      <div v-for="(t, i) in turns" :key="i" class="turn">
        <div class="q">{{ t.question }}</div>
        <div class="a panel">
          <div v-if="!t.answer && !t.error" class="thinking"><el-icon class="is-loading"><Loading /></el-icon> 正在检索本地档案…</div>
          <el-alert v-else-if="t.error" type="error" :title="t.error" :closable="false" />
          <template v-else-if="t.answer">
            <el-tag v-if="t.answer.blocked" type="warning" size="small" class="flag">超出系统服务范围</el-tag>
            <el-tag v-else-if="t.answer.noRecord" type="info" size="small" class="flag">无记录</el-tag>
            <div class="answer">{{ t.answer.answer }}</div>
            <div v-if="t.answer.sources.length" class="sources">
              <div class="muted">参考来源</div>
              <router-link v-for="(s, j) in t.answer.sources" :key="j" :to="`/items/${s.itemId}`" class="source">
                <div class="source-head">
                  <span class="idx">{{ j + 1 }}</span>
                  <strong>{{ s.itemName }}</strong>
                  <span class="muted">· {{ s.filename }}</span>
                </div>
                <div class="snippet">{{ s.snippet }}</div>
              </router-link>
            </div>
            <div class="disc">{{ t.answer.disclaimer }}</div>
          </template>
        </div>
      </div>
    </div>

    <form class="composer" @submit.prevent="ask()">
      <el-input
        v-model="question"
        type="textarea"
        :autosize="{ minRows: 1, maxRows: 4 }"
        maxlength="500"
        placeholder="输入问题，回车发送（Shift+回车换行）"
        resize="none"
        @keydown.enter.exact.prevent="ask()"
      />
      <el-button type="primary" native-type="submit" :loading="busy" :disabled="!question.trim()" icon="Promotion" />
    </form>
    <p class="muted center">{{ AI_DISCLAIMER }}</p>
  </div>
</template>

<style scoped>
.ask {
  max-width: 860px;
  display: flex;
  flex-direction: column;
}
.health {
  margin-bottom: 14px;
}
.turns {
  flex: 1;
}
.intro-title {
  font-size: 18px;
  margin: 0 0 8px;
}
.examples {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
.examples .el-button + .el-button {
  margin-left: 0;
}
.turn {
  margin-bottom: 20px;
}
.q {
  margin-left: auto;
  width: fit-content;
  max-width: 85%;
  background: var(--cat-ink);
  color: #f1e9da;
  padding: 10px 14px;
  border-radius: 14px 14px 4px 14px;
  margin-bottom: 10px;
  white-space: pre-wrap;
}
.a {
  border-radius: 4px 14px 14px 14px;
}
.thinking {
  color: var(--cat-muted);
  display: flex;
  align-items: center;
  gap: 6px;
}
.flag {
  margin-bottom: 8px;
}
.answer {
  white-space: pre-wrap;
  line-height: 1.8;
}
.sources {
  margin-top: 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.source {
  display: block;
  text-decoration: none;
  border: 1px solid var(--cat-line);
  border-radius: 8px;
  padding: 8px 10px;
  background: #faf7f1;
}
.source:hover {
  border-color: var(--el-color-primary-light-5);
}
.source-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}
.idx {
  display: inline-flex;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--el-color-primary);
  color: #fff;
  font-size: 11px;
  align-items: center;
  justify-content: center;
}
.snippet {
  font-size: 12px;
  color: var(--cat-ink-2);
  margin-top: 4px;
  line-height: 1.6;
  white-space: pre-wrap;
}
.disc {
  margin-top: 12px;
  font-size: 12px;
  color: var(--cat-muted);
  border-top: 1px dashed var(--cat-line);
  padding-top: 8px;
}
.composer {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: 8px;
  align-items: flex-end;
  padding: 12px 0 4px;
  background: var(--cat-paper);
}
.center {
  text-align: center;
  margin: 4px 0 0;
}
@media (max-width: 768px) {
  .composer {
    bottom: calc(60px + env(safe-area-inset-bottom));
  }
}
</style>
