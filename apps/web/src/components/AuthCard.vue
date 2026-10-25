<script setup lang="ts">
defineProps<{ title: string; subtitle: string }>();
</script>

<template>
  <div class="auth">
    <div class="card">
      <img src="/favicon.svg" alt="" class="logo" />
      <h1 class="serif">{{ title }}</h1>
      <p class="sub">{{ subtitle }}</p>
      <slot />
    </div>
    <p class="foot">Catalogue · Private Offline AI Archive for Collectors<br />No cloud upload. Your collection stays yours.</p>
  </div>
</template>

<style scoped>
.auth {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px 16px;
  background: radial-gradient(ellipse at top, #2c251d 0%, var(--cat-ink) 70%);
}
.card {
  width: 100%;
  max-width: 380px;
  background: var(--cat-card);
  border-radius: 14px;
  padding: 36px 28px 28px;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
}
.logo {
  width: 56px;
  height: 56px;
}
h1 {
  margin: 12px 0 4px;
  font-size: 26px;
}
.sub {
  margin: 0 0 24px;
  color: var(--cat-muted);
  font-size: 14px;
}
.foot {
  margin-top: 24px;
  color: #8a8074;
  font-size: 11px;
  text-align: center;
  line-height: 1.7;
  letter-spacing: 0.04em;
}
</style>
