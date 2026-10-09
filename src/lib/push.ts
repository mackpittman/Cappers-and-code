// Push alerts on the web build: register the service worker, ask for permission, subscribe with
// the server's VAPID key and hand the subscription to the `push` edge function. Everything here
// is a no-op off the web; the native app will carry its own channel later.
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { pushKey, pushSubscribe, pushUnsubscribe } from './supabase';

export type PushState = 'unsupported' | 'needs-install' | 'denied' | 'off' | 'on';

const isWeb =
  Platform.OS === 'web' && typeof window !== 'undefined' && typeof navigator !== 'undefined';

/** The path the app is served under (`/app` on cappersandcode.com), so the worker scopes to it. */
function base(): string {
  const cfg = (Constants.expoConfig?.experiments as { baseUrl?: string } | undefined)?.baseUrl;
  if (cfg) return cfg.replace(/\/+$/, '');
  if (isWeb && /^\/app(\/|$)/.test(window.location.pathname)) return '/app';
  return '';
}
export function isIOS(): boolean {
  if (!isWeb) return false;
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}
/** Installed to the Home Screen (iOS only lets an installed web app receive push). */
export function isStandalone(): boolean {
  if (!isWeb) return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    !!nav.standalone ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches)
  );
}
export function pushSupported(): boolean {
  return (
    isWeb && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  );
}

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  return (await navigator.serviceWorker.getRegistration(`${base()}/`)) ?? null;
}
export async function registerWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.register(`${base()}/sw.js`, { scope: `${base()}/` });
  await navigator.serviceWorker.ready;
  return reg;
}
async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return reg ? await reg.pushManager.getSubscription() : null;
}

export async function pushState(): Promise<PushState> {
  if (!isWeb) return 'unsupported';
  if (isIOS() && !isStandalone()) return 'needs-install';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  try {
    return (await currentSubscription()) ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

function keyBytes(base64url: string): Uint8Array {
  const b64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Permission prompt, subscription, server registration. Call from a tap: browsers require it. */
export async function enablePush(): Promise<PushState> {
  const before = await pushState();
  if (before === 'unsupported' || before === 'needs-install' || before === 'denied') return before;
  const reg = await registerWorker();
  if (!reg) return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const key = await pushKey();
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes(key) as BufferSource,
    });
  }
  await pushSubscribe(sub.toJSON(), navigator.userAgent);
  return 'on';
}
export async function disablePush(): Promise<PushState> {
  const sub = await currentSubscription();
  if (sub) {
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => false);
    await pushUnsubscribe(endpoint).catch(() => {});
  }
  return 'off';
}
/**
 * On launch, re-send a live subscription so the server row stays fresh and a browser-side key
 * rotation is picked up. Quiet on every failure: this is housekeeping, not a feature.
 */
export async function syncPush(): Promise<void> {
  try {
    if ((await pushState()) !== 'on') return;
    const sub = await currentSubscription();
    if (sub) await pushSubscribe(sub.toJSON(), navigator.userAgent);
  } catch {
    /* housekeeping only */
  }
}
/** A notification from the open page itself, for a post that lands while the tab is hidden. */
export async function showLocalNotification(
  title: string,
  body: string,
  url: string,
): Promise<void> {
  try {
    if (!pushSupported() || Notification.permission !== 'granted') return;
    const reg = await registration();
    if (!reg) return;
    if (await reg.pushManager.getSubscription()) return; // push is on: the worker shows this post
    await reg.showNotification(title, {
      body,
      tag: 'feed-local',
      icon: `${base()}/icons/icon-192.png`,
      data: { url },
    });
  } catch {
    /* best effort */
  }
}
/** Messages from the worker: a tapped alert asks the open page to show the Feed. */
export function onWorkerMessage(
  handler: (msg: { type: string; url?: string }) => void,
): () => void {
  if (!pushSupported()) return () => {};
  const listener = (e: MessageEvent) => {
    if (e.data && typeof e.data.type === 'string') handler(e.data);
  };
  navigator.serviceWorker.addEventListener('message', listener);
  return () => navigator.serviceWorker.removeEventListener('message', listener);
}
/** An absolute URL into the web app, for notifications that may open a fresh window. */
export function appUrl(route: string): string {
  if (!isWeb) return route;
  return `${window.location.origin}${base()}${route.startsWith('/') ? route : `/${route}`}`;
}
