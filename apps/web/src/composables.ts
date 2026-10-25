import { onBeforeUnmount, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';

/** 危险操作确认，取消时返回 false 而不是抛异常 */
export function confirm(message: string, title: string): Promise<boolean> {
  return ElMessageBox.confirm(message, title, { type: 'warning', confirmButtonText: '确认', cancelButtonText: '取消' })
    .then(() => true)
    .catch(() => false);
}

export function useIsMobile(breakpoint = 768) {
  const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);
  const isMobile = ref(mq.matches);
  const update = () => (isMobile.value = mq.matches);
  mq.addEventListener('change', update);
  onBeforeUnmount(() => mq.removeEventListener('change', update));
  return isMobile;
}

/** 包装异步操作：统一错误提示和 loading 状态 */
export function useAction() {
  const busy = ref(false);
  async function run<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
    busy.value = true;
    try {
      const r = await fn();
      if (success) ElMessage.success(success);
      return r;
    } catch (e) {
      ElMessage.error((e as Error).message);
      return undefined;
    } finally {
      busy.value = false;
    }
  }
  return { busy, run };
}
