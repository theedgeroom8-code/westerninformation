import { Alert, Platform } from "react-native";

// Lightweight toast bus. React Native Web does NOT implement Alert.alert
// (it silently no-ops), so on web all feedback goes through toasts instead.

export type ToastKind = "success" | "error" | "info";
export interface ToastItem { id: number; kind: ToastKind; title: string; message?: string }

type Listener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
let listeners: Listener[] = [];
let nextId = 1;

const emit = () => listeners.forEach((l) => l([...toasts]));

export function subscribeToasts(listener: Listener): () => void {
  listeners.push(listener);
  listener([...toasts]);
  return () => { listeners = listeners.filter((l) => l !== listener); };
}

export function toast(kind: ToastKind, title: string, message?: string) {
  const item: ToastItem = { id: nextId++, kind, title, message };
  toasts = [...toasts, item];
  emit();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== item.id);
    emit();
  }, 4000); // auto-dismiss (UX: 3–5s)
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

/** Platform-safe confirmation for destructive actions. Resolves true if confirmed. */
export function confirmAction(title: string, message: string): Promise<boolean> {
  if (Platform.OS === "web") {
    return Promise.resolve(typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`));
  }
  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Confirm", style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}
