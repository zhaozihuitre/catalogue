export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

type Handler = (status: number) => void;
let onAuthError: Handler = () => {};

/** 401（登录失效）和 423（系统锁定）统一交给路由处理 */
export function setAuthErrorHandler(fn: Handler) {
  onAuthError = fn;
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-catalogue': '1' };
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin', cache: 'no-store' });
  if (!res.ok) {
    let msg = `请求失败（${res.status}）`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* 非 JSON 响应 */
    }
    if (res.status === 401 || res.status === 423) onAuthError(res.status);
    throw new ApiError(res.status, msg);
  }
  const type = res.headers.get('content-type') ?? '';
  return (type.includes('application/json') ? res.json() : res.blob()) as Promise<T>;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
  upload: <T>(url: string, files: File[]) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('file', f, f.name));
    return request<T>('POST', url, fd);
  },
};

/** 下载文件：取到 Blob 后触发保存，随即释放内存中的对象 URL */
export async function downloadFile(url: string, filename: string): Promise<void> {
  const blob = await request<Blob>('GET', url);
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** 在新标签页打开原件（PDF 用浏览器自带阅读器查看） */
export async function openFile(url: string): Promise<void> {
  const win = window.open('', '_blank');
  const blob = await request<Blob>('GET', url);
  const href = URL.createObjectURL(blob);
  if (win) win.location.href = href;
  else window.location.href = href;
  setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

export const fmtMoney = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `¥${n.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}`;

export const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—';

export const fmtSize = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 ** 2 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 ** 2).toFixed(1)} MB`;
