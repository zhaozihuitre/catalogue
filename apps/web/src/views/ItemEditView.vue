<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { ItemDTO, ItemInput } from '@catalogue/shared';
import { api } from '../api';
import { useSession } from '../stores/session';
import { useAction } from '../composables';

const route = useRoute();
const router = useRouter();
const session = useSession();
const { busy, run } = useAction();

const id = computed(() => route.params.id as string | undefined);
const loaded = ref(!id.value);

const form = reactive<Required<ItemInput>>({
  code: '',
  name: '',
  categoryId: (route.query.categoryId as string) || session.categories[0]?.id || '',
  purchaseDate: null,
  purchaseChannel: null,
  purchasePrice: null,
  marketPrice: null,
  location: null,
  insuranceCompany: null,
  insurancePolicyNo: null,
  insuranceAmount: null,
  insuranceExpiry: null,
  maintenanceCycleDays: null,
  lastMaintenanceDate: null,
  lastInventoryDate: null,
  notes: null,
  attributes: {},
});

const category = computed(() => session.categories.find((c) => c.id === form.categoryId));

onMounted(async () => {
  if (!id.value) return;
  const { item } = await api.get<{ item: ItemDTO }>(`/api/items/${id.value}`);
  const { id: _id, createdAt: _c, updatedAt: _u, coverAttachmentId: _cv, ...rest } = item;
  Object.assign(form, rest);
  // 编辑时已有保险信息就直接展开
  showInsurance.value = [rest.insuranceCompany, rest.insurancePolicyNo, rest.insuranceAmount, rest.insuranceExpiry].some(
    (v) => v !== null && v !== '',
  );
  loaded.value = true;
});

/** 保险信息默认折叠，点击后展开 */
const showInsurance = ref(false);

/** 空字符串统一转成 null，数字输入框清空时也是 null */
function payload(): ItemInput {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(form)) out[k] = v === '' ? null : v;
  out.attributes = Object.fromEntries(Object.entries(form.attributes).filter(([, v]) => v !== '' && v !== null && v !== undefined));
  return out as unknown as ItemInput;
}

async function save() {
  const item = await run(
    () => (id.value ? api.put<ItemDTO>(`/api/items/${id.value}`, payload()) : api.post<ItemDTO>('/api/items', payload())),
    '已保存',
  );
  if (item) router.replace(`/items/${item.id}`);
}
</script>

<template>
  <div class="page" v-if="loaded">
    <div class="page-head">
      <h1>{{ id ? '编辑藏品' : '新建藏品' }}</h1>
    </div>
    <el-form label-position="top" @submit.prevent="save">
      <section class="panel">
        <h2>基础信息</h2>
        <div class="grid-form">
          <el-form-item label="藏品名称" required class="full">
            <el-input v-model="form.name" maxlength="200" />
          </el-form-item>
          <el-form-item label="分类" required>
            <el-select v-model="form.categoryId">
              <el-option v-for="c in session.categories" :key="c.id" :label="c.name" :value="c.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="藏品编号">
            <el-input v-model="form.code" placeholder="留空自动生成" maxlength="40" />
          </el-form-item>
          <el-form-item label="购入时间">
            <el-date-picker v-model="form.purchaseDate" value-format="YYYY-MM-DD" style="width: 100%" />
          </el-form-item>
          <el-form-item label="购入渠道">
            <el-input v-model="form.purchaseChannel" placeholder="如：某拍卖行 2024 秋拍、专柜" />
          </el-form-item>
          <el-form-item label="购入价（元）">
            <el-input-number v-model="form.purchasePrice" :min="0" :precision="2" :controls="false" style="width: 100%" />
          </el-form-item>
          <el-form-item label="参考市价（元，自行填写）">
            <el-input-number v-model="form.marketPrice" :min="0" :precision="2" :controls="false" style="width: 100%" />
          </el-form-item>
          <el-form-item label="存放位置">
            <el-input v-model="form.location" placeholder="如：书房保险柜第二层" />
          </el-form-item>
        </div>
      </section>

      <section class="panel" v-if="category?.fields.length">
        <h2>{{ category.name }} · 专属信息</h2>
        <div class="grid-form">
          <el-form-item
            v-for="f in category.fields"
            :key="f.key"
            :label="f.label"
            :required="f.required"
            :class="{ full: f.type === 'textarea' }"
          >
            <el-input v-if="f.type === 'text'" v-model="form.attributes[f.key] as string" />
            <el-input v-else-if="f.type === 'textarea'" v-model="form.attributes[f.key] as string" type="textarea" :rows="3" />
            <el-input-number
              v-else-if="f.type === 'number'"
              v-model="form.attributes[f.key] as number"
              :controls="false"
              style="width: 100%"
            />
            <el-date-picker
              v-else-if="f.type === 'date'"
              v-model="form.attributes[f.key] as string"
              value-format="YYYY-MM-DD"
              style="width: 100%"
            />
            <el-select v-else-if="f.type === 'select'" v-model="form.attributes[f.key] as string" clearable>
              <el-option v-for="o in f.options" :key="o" :label="o" :value="o" />
            </el-select>
          </el-form-item>
        </div>
      </section>

      <section class="panel">
        <button type="button" class="toggle" :aria-expanded="showInsurance" @click="showInsurance = !showInsurance">
          <h2>保险信息</h2>
          <span class="muted">{{ showInsurance ? '收起' : '未投保可跳过，点击填写' }}</span>
          <el-icon class="chevron" :class="{ open: showInsurance }"><ArrowDown /></el-icon>
        </button>
        <el-collapse-transition>
          <div v-show="showInsurance" class="grid-form insurance">
            <el-form-item label="保险公司"><el-input v-model="form.insuranceCompany" /></el-form-item>
            <el-form-item label="保单号"><el-input v-model="form.insurancePolicyNo" /></el-form-item>
            <el-form-item label="保额（元）">
              <el-input-number v-model="form.insuranceAmount" :min="0" :precision="2" :controls="false" style="width: 100%" />
            </el-form-item>
            <el-form-item label="保险到期日">
              <el-date-picker v-model="form.insuranceExpiry" value-format="YYYY-MM-DD" style="width: 100%" />
            </el-form-item>
          </div>
        </el-collapse-transition>
      </section>

      <section class="panel">
        <h2>保养与盘点</h2>
        <div class="grid-form">
          <el-form-item label="保养周期（天）">
            <el-input-number v-model="form.maintenanceCycleDays" :min="1" :controls="false" style="width: 100%" />
          </el-form-item>
          <el-form-item label="上次保养日期">
            <el-date-picker v-model="form.lastMaintenanceDate" value-format="YYYY-MM-DD" style="width: 100%" />
          </el-form-item>
          <el-form-item label="上次盘点日期">
            <el-date-picker v-model="form.lastInventoryDate" value-format="YYYY-MM-DD" style="width: 100%" />
          </el-form-item>
          <el-form-item label="备注" class="full">
            <el-input v-model="form.notes" type="textarea" :rows="3" maxlength="5000" />
          </el-form-item>
        </div>
      </section>

      <div class="actions">
        <el-button @click="router.back()">取消</el-button>
        <el-button type="primary" native-type="submit" :loading="busy" :disabled="!form.name || !form.categoryId">保存</el-button>
      </div>
    </el-form>
  </div>
</template>

<style scoped>
.toggle {
  all: unset;
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  cursor: pointer;
}
.toggle h2 {
  margin: 0;
}
.toggle:focus-visible {
  outline: 2px solid var(--el-color-primary-light-5);
  outline-offset: 4px;
  border-radius: 4px;
}
.chevron {
  margin-left: auto;
  transition: transform 0.2s;
}
.chevron.open {
  transform: rotate(180deg);
}
.insurance {
  padding-top: 14px;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}
</style>
