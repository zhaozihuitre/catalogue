<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import type { AiHealth, CategoryDTO, FieldDef, FieldType } from '@catalogue/shared';
import { api } from '../api';
import { useSession } from '../stores/session';
import { confirm, useAction } from '../composables';

interface Settings {
  reminders: { insuranceLeadDays: number[]; maintenanceLeadDays: number; inventoryOverdueDays: number };
  ai: { minVectorScore: number; minKeywordScore: number; topK: number };
  smtp: { enabled: boolean; host: string; port: number; secure: boolean; user: string; pass: string; from: string; to: string };
}

const session = useSession();
const router = useRouter();
const { busy, run } = useAction();
const settings = ref<Settings | null>(null);
const health = ref<AiHealth | null>(null);

const FIELD_TYPES: Record<FieldType, string> = { text: '单行文本', textarea: '多行文本', number: '数字', date: '日期', select: '下拉选项' };

onMounted(async () => {
  settings.value = await api.get<Settings>('/api/settings');
  health.value = await api.get<AiHealth>('/api/ai/health');
});

async function save(section: keyof Settings) {
  const res = await run(() => api.put<Settings>('/api/settings', { [section]: settings.value![section] }), '已保存');
  if (res) settings.value = res;
}

const testSmtp = () => run(() => api.post('/api/settings/smtp/test'), '测试邮件已发送');

async function lockNow() {
  if (!(await confirm('锁定后所有账号都需要重新输入主口令解锁才能访问系统。', '立即锁定系统'))) return;
  await run(() => api.post('/api/system/lock'));
  session.clearLocal();
  session.status = { initialized: true, locked: true };
  router.replace('/unlock');
}

/* ---------- 分类管理 ---------- */
const catDialog = ref(false);
const catForm = ref<{ id: string | null; name: string; fields: (FieldDef & { optionsText?: string })[] }>({ id: null, name: '', fields: [] });

function editCategory(c: CategoryDTO | null) {
  catForm.value = c
    ? { id: c.id, name: c.name, fields: c.fields.map((f) => ({ ...f, optionsText: f.options?.join('、') ?? '' })) }
    : { id: null, name: '', fields: [] };
  catDialog.value = true;
}

function addField() {
  catForm.value.fields.push({ key: `field_${catForm.value.fields.length + 1}`, label: '', type: 'text', optionsText: '' });
}

async function saveCategory() {
  const body = {
    name: catForm.value.name,
    fields: catForm.value.fields.map(({ optionsText, ...f }) => ({
      ...f,
      options: f.type === 'select' ? (optionsText ?? '').split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean) : undefined,
    })),
  };
  const id = catForm.value.id;
  const ok = await run(() => (id ? api.put(`/api/categories/${id}`, body) : api.post('/api/categories', body)), '分类已保存');
  if (ok) {
    catDialog.value = false;
    session.loadCategories();
  }
}

async function deleteCategory(c: CategoryDTO) {
  if (!(await confirm(`删除分类「${c.name}」？`, '删除分类'))) return;
  if (await run(() => api.del(`/api/categories/${c.id}`), '已删除')) session.loadCategories();
}
</script>

<template>
  <div class="page" v-if="settings">
    <div class="page-head"><h1>系统设置</h1></div>

    <section class="panel">
      <h2>本地 AI 服务状态</h2>
      <div v-if="health" class="health">
        <div><el-tag :type="health.ocr ? 'success' : 'info'">{{ health.ocr ? '就绪' : '未就绪' }}</el-tag> PaddleOCR 文字识别</div>
        <div><el-tag :type="health.embedder ? 'success' : 'info'">{{ health.embedder ? '就绪' : '未就绪' }}</el-tag> 向量模型 bge-small-zh</div>
        <div><el-tag :type="health.llm ? 'success' : 'info'">{{ health.llm ? '就绪' : '未就绪' }}</el-tag> 大模型 {{ health.llmModel }}</div>
      </div>
      <p class="muted">所有 AI 服务均运行在本机，系统不调用任何外网大模型 API。未就绪的服务会自动降级，就绪后自动补齐识别、向量和摘要。</p>
    </section>

    <section class="panel">
      <h2>提醒规则</h2>
      <el-form label-position="top" class="grid-form">
        <el-form-item label="保险到期提前提醒（天，可多档）">
          <el-select v-model="settings.reminders.insuranceLeadDays" multiple filterable allow-create default-first-option style="width: 100%">
            <el-option v-for="d in [0, 7, 15, 30, 60, 90]" :key="d" :label="d === 0 ? '到期当天' : `${d} 天`" :value="d" />
          </el-select>
        </el-form-item>
        <el-form-item label="保养到期提前提醒（天）">
          <el-input-number v-model="settings.reminders.maintenanceLeadDays" :min="0" :max="365" />
        </el-form-item>
        <el-form-item label="超过多少天未盘点视为长期未盘点">
          <el-input-number v-model="settings.reminders.inventoryOverdueDays" :min="7" :max="3650" />
        </el-form-item>
      </el-form>
      <el-button type="primary" :loading="busy" @click="save('reminders')">保存</el-button>
    </section>

    <section class="panel">
      <h2>邮件通知（可选）</h2>
      <p class="muted">使用您自己的邮件服务器发送提醒摘要。邮件中只包含提醒标题，不包含价格、证书等敏感信息。</p>
      <el-form label-position="top" class="grid-form">
        <el-form-item label="启用邮件通知" class="full"><el-switch v-model="settings.smtp.enabled" /></el-form-item>
        <el-form-item label="SMTP 服务器"><el-input v-model="settings.smtp.host" placeholder="smtp.example.com" /></el-form-item>
        <el-form-item label="端口"><el-input-number v-model="settings.smtp.port" :min="1" :max="65535" :controls="false" /></el-form-item>
        <el-form-item label="SSL/TLS"><el-switch v-model="settings.smtp.secure" /></el-form-item>
        <el-form-item label="用户名"><el-input v-model="settings.smtp.user" autocomplete="off" /></el-form-item>
        <el-form-item label="密码"><el-input v-model="settings.smtp.pass" type="password" show-password autocomplete="new-password" /></el-form-item>
        <el-form-item label="发件人"><el-input v-model="settings.smtp.from" /></el-form-item>
        <el-form-item label="收件人（多个用逗号分隔）"><el-input v-model="settings.smtp.to" /></el-form-item>
      </el-form>
      <el-button type="primary" :loading="busy" @click="save('smtp')">保存</el-button>
      <el-button :loading="busy" @click="testSmtp">发送测试邮件</el-button>
    </section>

    <section class="panel">
      <h2>AI 检索参数</h2>
      <el-form label-position="top" class="grid-form">
        <el-form-item label="向量相似度阈值（越高越严格）">
          <el-slider v-model="settings.ai.minVectorScore" :min="0.2" :max="0.9" :step="0.05" show-input />
        </el-form-item>
        <el-form-item label="关键词匹配阈值">
          <el-slider v-model="settings.ai.minKeywordScore" :min="0.1" :max="0.9" :step="0.05" show-input />
        </el-form-item>
        <el-form-item label="每次召回片段数">
          <el-input-number v-model="settings.ai.topK" :min="1" :max="20" />
        </el-form-item>
      </el-form>
      <el-button type="primary" :loading="busy" @click="save('ai')">保存</el-button>
    </section>

    <section class="panel">
      <div class="head-row">
        <h2>藏品分类</h2>
        <el-button size="small" icon="Plus" @click="editCategory(null)">新建分类</el-button>
      </div>
      <el-table :data="session.categories" size="small">
        <el-table-column prop="name" label="分类" width="140" />
        <el-table-column label="专属字段" min-width="200">
          <template #default="{ row }">
            <span class="muted">{{ (row as CategoryDTO).fields.map((f) => f.label).join('、') || '无' }}</span>
          </template>
        </el-table-column>
        <el-table-column width="130">
          <template #default="{ row }">
            <el-button link type="primary" @click="editCategory(row as CategoryDTO)">编辑字段</el-button>
            <el-button v-if="!row.builtin" link type="danger" @click="deleteCategory(row as CategoryDTO)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </section>

    <section class="panel danger">
      <h2>系统安全</h2>
      <p class="muted">锁定后数据库与档案文件的密钥将从内存中清除，需要重新输入主口令才能访问。外出或长期不使用时建议锁定。</p>
      <el-button type="danger" plain icon="Lock" @click="lockNow">立即锁定系统</el-button>
    </section>

    <el-dialog v-model="catDialog" :title="catForm.id ? '编辑分类' : '新建分类'" width="720px">
      <el-form label-position="top">
        <el-form-item label="分类名称" required><el-input v-model="catForm.name" maxlength="40" /></el-form-item>
        <div v-for="(f, i) in catForm.fields" :key="i" class="field-row">
          <el-input v-model="f.label" placeholder="字段名称" />
          <el-input v-model="f.key" placeholder="标识" class="key" />
          <el-select v-model="f.type" class="type">
            <el-option v-for="(label, t) in FIELD_TYPES" :key="t" :label="label" :value="t" />
          </el-select>
          <el-input v-if="f.type === 'select'" v-model="f.optionsText" placeholder="选项，用顿号分隔" />
          <el-checkbox v-model="f.private" label="展览中隐藏" />
          <el-button icon="Delete" circle @click="catForm.fields.splice(i, 1)" />
        </div>
        <el-button icon="Plus" @click="addField">添加字段</el-button>
        <p class="muted">修改字段不会删除已录入的数据；字段标识只能使用小写字母、数字和下划线。勾选"展览中隐藏"的字段（如序列号、证书编号）不会出现在展览放映中。</p>
      </el-form>
      <template #footer>
        <el-button @click="catDialog = false">取消</el-button>
        <el-button type="primary" :loading="busy" :disabled="!catForm.name" @click="saveCategory">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.health {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 14px;
}
.head-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.head-row h2 {
  margin: 0;
}
.danger {
  border-color: #e7c3b9;
}
.field-row {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}
.field-row > .el-input:first-child {
  flex: 1;
  min-width: 140px;
}
.key {
  width: 140px;
}
.type {
  width: 120px;
}
</style>
