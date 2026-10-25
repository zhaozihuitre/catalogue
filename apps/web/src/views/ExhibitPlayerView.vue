<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { ExhibitPlaylist, ExhibitSlide } from '@catalogue/shared';
import { api } from '../api';

/** 每件藏品最多放映几张图，避免单件停留过久 */
const MAX_IMAGES_PER_ITEM = 4;
const CONTROLS_HIDE_MS = 3500;
const TITLE_CARD_MS = 4500;

interface Frame {
  slide: ExhibitSlide;
  slideIndex: number;
  imageId: string;
  imageIndex: number;
  imageCount: number;
}

const route = useRoute();
const router = useRouter();

const playlist = ref<ExhibitPlaylist | null>(null);
const error = ref<string | null>(null);
const pos = ref(0);
const playing = ref(true);
const controls = ref(true);
const titleCard = ref(true);
const canFullscreen = !!document.documentElement.requestFullscreen;
const isFullscreen = ref(false);

const frames = computed<Frame[]>(() =>
  (playlist.value?.slides ?? []).flatMap((slide, slideIndex) => {
    const ids = slide.imageIds.slice(0, MAX_IMAGES_PER_ITEM);
    return ids.map((imageId, imageIndex) => ({ slide, slideIndex, imageId, imageIndex, imageCount: ids.length }));
  }),
);
const frame = computed(() => frames.value[pos.value]);
const intervalMs = computed(() => (playlist.value?.intervalSec ?? 10) * 1000);
const imgUrl = (id: string) => `/api/exhibit/image/${id}`;

/* ---------- 播放控制 ---------- */
let timer: number | undefined;
function schedule() {
  clearTimeout(timer);
  if (playing.value && frames.value.length > 1) timer = window.setTimeout(() => go(1), intervalMs.value);
}

function go(delta: number) {
  const n = frames.value.length;
  if (!n) return;
  pos.value = (pos.value + delta + n) % n;
  titleCard.value = false;
}

/** 跳到上一件 / 下一件藏品（而不是同一件的下一张图） */
function goItem(delta: 1 | -1) {
  const n = frames.value.length;
  if (!n) return;
  const cur = frame.value.slideIndex;
  let i = pos.value;
  for (let step = 0; step < n; step++) {
    i = (i + delta + n) % n;
    if (frames.value[i].slideIndex !== cur && frames.value[i].imageIndex === 0) break;
  }
  pos.value = i;
  titleCard.value = false;
}

function togglePlay() {
  playing.value = !playing.value;
}

watch([pos, playing, frames], schedule);

// 预加载下一张，避免切换时闪白
watch(pos, () => {
  const next = frames.value[(pos.value + 1) % Math.max(1, frames.value.length)];
  if (next) new Image().src = imgUrl(next.imageId);
});

/* ---------- 控制栏自动隐藏 ---------- */
let hideTimer: number | undefined;
function poke() {
  controls.value = true;
  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => (controls.value = false), CONTROLS_HIDE_MS);
}

/* ---------- 全屏与屏幕常亮 ---------- */
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    /* 部分电视浏览器不支持 */
  }
}
const onFullscreenChange = () => (isFullscreen.value = !!document.fullscreenElement);

let wakeLock: { release(): Promise<void> } | null = null;
async function keepAwake() {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    if (nav.wakeLock && document.visibilityState === 'visible') wakeLock = await nav.wakeLock.request('screen');
  } catch {
    /* 不支持或被拒绝时忽略 */
  }
}

function exit() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (window.history.length > 1) router.back();
  else router.replace('/exhibit');
}

/* ---------- 键盘 / 电视遥控器 ---------- */
function onKey(e: KeyboardEvent) {
  poke();
  switch (e.key) {
    case 'ArrowRight':
      go(1);
      break;
    case 'ArrowLeft':
      go(-1);
      break;
    case 'ArrowDown':
    case 'PageDown':
      goItem(1);
      break;
    case 'ArrowUp':
    case 'PageUp':
      goItem(-1);
      break;
    case ' ':
    case 'Enter':
    case 'MediaPlayPause':
      togglePlay();
      break;
    case 'f':
    case 'F':
      toggleFullscreen();
      break;
    case 'Escape':
    case 'Backspace':
    case 'GoBack':
    case 'BrowserBack':
      if (!document.fullscreenElement) exit();
      break;
    default:
      return;
  }
  e.preventDefault();
}

/* ---------- 手机滑动 ---------- */
let touchX = 0;
let touchY = 0;
function onTouchStart(e: TouchEvent) {
  touchX = e.touches[0].clientX;
  touchY = e.touches[0].clientY;
}
function onTouchEnd(e: TouchEvent) {
  const dx = e.changedTouches[0].clientX - touchX;
  const dy = e.changedTouches[0].clientY - touchY;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) go(dx < 0 ? 1 : -1);
  poke();
}

const onVisibility = () => document.visibilityState === 'visible' && keepAwake();

onMounted(async () => {
  try {
    const q = new URLSearchParams();
    for (const k of ['exhibitionId', 'categoryId']) if (typeof route.query[k] === 'string') q.set(k, route.query[k] as string);
    playlist.value = await api.get<ExhibitPlaylist>(`/api/exhibit/playlist?${q}`);
    if (!playlist.value.slides.length) error.value = '这些藏品还没有上传图片，暂时无法放映。';
  } catch (e) {
    error.value = (e as Error).message;
  }
  window.setTimeout(() => (titleCard.value = false), TITLE_CARD_MS);
  window.addEventListener('keydown', onKey);
  window.addEventListener('mousemove', poke);
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('visibilitychange', onVisibility);
  keepAwake();
  poke();
  schedule();
});

onBeforeUnmount(() => {
  clearTimeout(timer);
  clearTimeout(hideTimer);
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('mousemove', poke);
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  document.removeEventListener('visibilitychange', onVisibility);
  wakeLock?.release().catch(() => {});
});
</script>

<template>
  <div
    class="stage"
    :class="{ 'hide-cursor': !controls }"
    :style="{ '--dwell': `${intervalMs}ms` }"
    @touchstart.passive="onTouchStart"
    @touchend="onTouchEnd"
    @click.self="poke"
  >
    <div v-if="error" class="message">
      <p>{{ error }}</p>
      <button class="btn" @click="exit">返回</button>
    </div>

    <template v-else-if="frame">
      <!-- 模糊背景填满留白，主图完整显示不裁切 -->
      <Transition name="fade">
        <div :key="`bg-${pos}`" class="backdrop" :style="{ backgroundImage: `url(${imgUrl(frame.imageId)})` }" />
      </Transition>
      <Transition name="fade">
        <img :key="`img-${pos}`" class="photo drift" :class="{ paused: !playing }" :src="imgUrl(frame.imageId)" alt="" draggable="false" />
      </Transition>

      <div class="shade" />

      <Transition name="rise" mode="out-in">
        <div :key="`cap-${frame.slideIndex}`" class="caption">
          <div class="cat">{{ frame.slide.categoryName }}</div>
          <h1 class="name">{{ frame.slide.name }}</h1>
          <dl v-if="frame.slide.fields.length" class="fields">
            <div v-for="f in frame.slide.fields.slice(0, 6)" :key="f.label" class="field">
              <dt>{{ f.label }}</dt>
              <dd>{{ f.value }}</dd>
            </div>
          </dl>
        </div>
      </Transition>

      <div class="progress">
        <div :key="`p-${pos}-${playing}`" class="bar" :class="{ run: playing }" />
      </div>

      <Transition name="fade">
        <div v-if="titleCard && playlist" class="title-card">
          <div class="eyebrow">Private Collection</div>
          <h1>{{ playlist.title }}</h1>
          <p v-if="playlist.description">{{ playlist.description }}</p>
          <div class="count">共 {{ playlist.slides.length }} 件展品</div>
        </div>
      </Transition>

      <Transition name="fade">
        <div v-show="controls" class="controls">
          <div class="top">
            <span class="exhibit-title">{{ playlist?.title }}</span>
            <button class="btn ghost" aria-label="退出放映" @click="exit">✕ 退出</button>
          </div>
          <div class="bottom">
            <span class="counter">
              {{ frame.slideIndex + 1 }} / {{ playlist?.slides.length }}
              <template v-if="frame.imageCount > 1"> · 图 {{ frame.imageIndex + 1 }}/{{ frame.imageCount }}</template>
            </span>
            <div class="buttons">
              <button class="btn round" aria-label="上一张" @click="go(-1)">‹</button>
              <button class="btn round main" :aria-label="playing ? '暂停' : '播放'" @click="togglePlay">{{ playing ? '❚❚' : '▶' }}</button>
              <button class="btn round" aria-label="下一张" @click="go(1)">›</button>
              <button v-if="canFullscreen" class="btn round" aria-label="全屏" @click="toggleFullscreen">{{ isFullscreen ? '⤡' : '⤢' }}</button>
            </div>
            <span class="hint">← → 翻页 · ↑ ↓ 换藏品 · 空格 暂停</span>
          </div>
        </div>
      </Transition>
    </template>

    <div v-else class="message"><p>正在准备展览…</p></div>
  </div>
</template>

<style scoped>
.stage {
  position: fixed;
  inset: 0;
  background: #0b0907;
  color: #f1e9da;
  overflow: hidden;
  user-select: none;
  -webkit-user-select: none;
  touch-action: pan-y;
}
.hide-cursor {
  cursor: none;
}
.backdrop {
  position: absolute;
  inset: -40px;
  background-size: cover;
  background-position: center;
  filter: blur(40px) brightness(0.35) saturate(1.1);
}
.photo {
  position: absolute;
  inset: 0;
  margin: auto;
  max-width: 100%;
  max-height: 100%;
  width: 100%;
  height: 100%;
  object-fit: contain;
  transform-origin: center;
}
/* 轻微推镜，让静态图片有呼吸感 */
.photo.drift {
  animation: drift var(--dwell) ease-out forwards;
}
.photo.paused {
  animation-play-state: paused;
}
@keyframes drift {
  from {
    transform: scale(1);
  }
  to {
    transform: scale(1.04);
  }
}
.shade {
  position: absolute;
  inset: auto 0 0 0;
  height: 55%;
  background: linear-gradient(to top, rgba(8, 6, 4, 0.9), rgba(8, 6, 4, 0.35) 55%, transparent);
  pointer-events: none;
}
.caption {
  position: absolute;
  left: max(5vw, env(safe-area-inset-left));
  right: 5vw;
  bottom: calc(6vh + env(safe-area-inset-bottom));
  max-width: 1100px;
  pointer-events: none;
}
.cat {
  font-size: clamp(12px, 1.1vw, 22px);
  letter-spacing: 0.3em;
  color: var(--cat-gold-soft);
  margin-bottom: 0.6em;
}
.name {
  font-family: var(--cat-serif);
  font-weight: 600;
  font-size: clamp(26px, 3.6vw, 76px);
  line-height: 1.2;
  margin: 0 0 0.5em;
  text-shadow: 0 2px 24px rgba(0, 0, 0, 0.6);
}
.fields {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6em 2.4em;
  margin: 0;
  font-size: clamp(13px, 1.15vw, 24px);
}
.field {
  display: flex;
  gap: 0.6em;
}
.field dt {
  color: #a8997f;
}
.field dd {
  margin: 0;
  color: #eee4d1;
}
.progress {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: rgba(255, 255, 255, 0.08);
}
.bar {
  height: 100%;
  width: 0;
  background: var(--cat-gold-soft);
  opacity: 0.8;
}
.bar.run {
  animation: progress var(--dwell) linear forwards;
}
@keyframes progress {
  to {
    width: 100%;
  }
}
.title-card {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 0 8vw;
  background: radial-gradient(ellipse at center, rgba(31, 26, 20, 0.92), rgba(8, 6, 4, 0.97));
}
.title-card .eyebrow {
  letter-spacing: 0.5em;
  text-transform: uppercase;
  font-size: clamp(11px, 1vw, 20px);
  color: var(--cat-gold-soft);
}
.title-card h1 {
  font-family: var(--cat-serif);
  font-size: clamp(32px, 5.5vw, 120px);
  margin: 0.4em 0 0.3em;
  font-weight: 600;
}
.title-card p {
  max-width: 900px;
  font-size: clamp(14px, 1.4vw, 28px);
  color: #cfc4b0;
  line-height: 1.7;
  margin: 0;
}
.title-card .count {
  margin-top: 2em;
  color: #8a8074;
  font-size: clamp(12px, 1vw, 20px);
}
.controls {
  position: absolute;
  inset: 0;
  pointer-events: none;
}
.controls .top,
.controls .bottom {
  position: absolute;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: calc(14px + env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) 14px max(20px, env(safe-area-inset-left));
  pointer-events: auto;
}
.controls .top {
  top: 0;
  background: linear-gradient(to bottom, rgba(0, 0, 0, 0.55), transparent);
}
.controls .bottom {
  bottom: 0;
  top: auto;
  padding-top: 14px;
  padding-bottom: calc(14px + env(safe-area-inset-bottom));
}
.exhibit-title {
  font-family: var(--cat-serif);
  color: #cfc4b0;
  font-size: clamp(13px, 1vw, 20px);
}
.counter,
.hint {
  font-size: clamp(12px, 0.9vw, 18px);
  color: #a8997f;
  min-width: 140px;
}
.hint {
  text-align: right;
}
.buttons {
  display: flex;
  gap: 12px;
}
.btn {
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(20, 16, 12, 0.55);
  color: #f1e9da;
  border-radius: 999px;
  padding: 8px 16px;
  font-size: 14px;
  cursor: pointer;
  backdrop-filter: blur(6px);
}
.btn:hover,
.btn:focus-visible {
  border-color: var(--cat-gold-soft);
  outline: none;
}
.btn.round {
  width: clamp(44px, 3.2vw, 64px);
  height: clamp(44px, 3.2vw, 64px);
  padding: 0;
  font-size: clamp(18px, 1.5vw, 28px);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.btn.main {
  background: rgba(201, 169, 106, 0.25);
  border-color: var(--cat-gold-soft);
}
.message {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
  justify-content: center;
  color: #cfc4b0;
  padding: 24px;
  text-align: center;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 1.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.rise-enter-active,
.rise-leave-active {
  transition:
    opacity 0.6s ease,
    transform 0.6s ease;
}
.rise-enter-from {
  opacity: 0;
  transform: translateY(16px);
}
.rise-leave-to {
  opacity: 0;
}

/* 手机竖屏：图片放上半部，说明文字放下方 */
@media (max-width: 768px) and (orientation: portrait) {
  .photo {
    height: 62%;
    bottom: auto;
    top: 6%;
  }
  .shade {
    height: 45%;
  }
  .caption {
    left: 20px;
    right: 20px;
    bottom: calc(90px + env(safe-area-inset-bottom));
  }
  .fields {
    gap: 0.4em 1.4em;
  }
  .hint {
    display: none;
  }
  .counter {
    min-width: 0;
  }
}
</style>
