export type ToastKind = 'success' | 'error' | 'info';
export interface ToastAction {
  label: string;
  onClick: () => void;
}
export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
  /** Optional inline action (e.g. Undo) — toasts carrying one live longer. */
  action?: ToastAction;
}

let items: ToastItem[] = [];
let nextId = 1;
const listeners = new Set<(items: ToastItem[]) => void>();

function emit() {
  for (const cb of listeners) cb(items);
}

export function subscribeToasts(cb: (items: ToastItem[]) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
export function getToasts(): ToastItem[] {
  return items;
}
export function dismissToast(id: number) {
  items = items.filter((t) => t.id !== id);
  emit();
}
function push(kind: ToastKind, message: string, action?: ToastAction) {
  const id = nextId++;
  items = [...items, { id, kind, message, action }];
  emit();
  // Actionable toasts need time to be clicked — 8s instead of 3s.
  setTimeout(() => dismissToast(id), action ? 8000 : 3000);
}
export const toast = {
  success: (message: string, action?: ToastAction) => push('success', message, action),
  error: (message: string) => push('error', message),
  info: (message: string, action?: ToastAction) => push('info', message, action),
};
