import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import type { FeedPost } from './types';

const extra = (Constants.expoConfig?.extra ?? {}) as {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
};
export const supabaseConfigured = !!(extra.supabaseUrl && extra.supabaseAnonKey);

export const supabase = createClient(
  extra.supabaseUrl ?? 'https://invalid.supabase.co',
  extra.supabaseAnonKey ?? 'anon',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // On the web build a magic link lands on the app URL with the session in the hash.
      detectSessionInUrl: Platform.OS === 'web',
    },
  },
);

export type Entitlement = {
  active: boolean;
  plan: 'monthly' | 'founder_season' | 'manual' | null;
  status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
};

export async function fetchEntitlement(): Promise<Entitlement> {
  const { data, error } = await supabase.rpc('my_entitlement');
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return (
    row ?? {
      active: false,
      plan: null,
      status: null,
      current_period_end: null,
      cancel_at_period_end: null,
    }
  );
}
export async function fetchBoard(): Promise<unknown | null> {
  const { data, error } = await supabase.rpc('get_board');
  if (error) throw error;
  return data ?? null;
}
export async function fetchBoardPreview(): Promise<unknown | null> {
  const { data, error } = await supabase.rpc('get_board_preview');
  if (error) throw error;
  return data ?? null;
}

/** Members-only Discord mirror: newest first; pass `before` (posted_at) to page older posts. */
export async function fetchFeed(pageSize = 50, before?: string): Promise<FeedPost[]> {
  const { data, error } = await supabase.rpc('get_feed', {
    page_size: pageSize,
    before: before ?? null,
  });
  if (error) throw error;
  return (data ?? []) as FeedPost[];
}
/** Calls `onChange` whenever a post is inserted or updated; returns the unsubscribe function. */
export function subscribeFeed(onChange: () => void): () => void {
  const channel = supabase
    .channel('feed_posts')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'feed_posts' }, () => onChange())
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

/** Starts Stripe Checkout for the signed-in user and returns the URL to open in the browser. */
export async function startCheckout(plan: 'monthly' | 'founder_season'): Promise<string> {
  const { data, error } = await supabase.functions.invoke('stripe-checkout', { body: { plan } });
  if (error)
    throw new Error((await error.context?.json?.().catch(() => null))?.error ?? error.message);
  if (!data?.url) throw new Error(data?.error ?? 'Checkout unavailable');
  return data.url as string;
}
/** Returns the Stripe Customer Portal URL (cancel, update card, receipts). */
export async function openPortal(): Promise<string> {
  const { data, error } = await supabase.functions.invoke('stripe-portal', { body: {} });
  if (error)
    throw new Error((await error.context?.json?.().catch(() => null))?.error ?? error.message);
  if (!data?.url) throw new Error(data?.error ?? 'Portal unavailable');
  return data.url as string;
}

/** The members' Discord is invite-only. Entitled members get a standing single-use invite. */
export async function myDiscordInvite(): Promise<{ url: string; expires_at: string }> {
  const { data, error } = await supabase.functions.invoke('discord-invite', {
    body: { action: 'me' },
  });
  if (error)
    throw new Error((await error.context?.json?.().catch(() => null))?.error ?? error.message);
  if (!data?.url) throw new Error(data?.error ?? 'Invite unavailable');
  return data as { url: string; expires_at: string };
}
export type DiscordLink = {
  linked: boolean;
  discord_username: string | null;
  linked_at: string | null;
  role_granted: boolean;
  entitled: boolean;
  configured: boolean;
  last_error: string | null;
};
/** Where this account stands with Discord: connected, and does it hold the members role. */
export async function myDiscordLink(): Promise<DiscordLink> {
  const { data, error } = await supabase.functions.invoke('discord-access', {
    body: { action: 'me' },
  });
  if (error)
    throw new Error((await error.context?.json?.().catch(() => null))?.error ?? error.message);
  return data as DiscordLink;
}
/**
 * Begin the Discord connection. Returns the authorize URL to send the member to; Discord hands
 * them back to the edge function, which stores the link and grants the role in one step.
 */
export async function startDiscordLink(redirectTo?: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke('discord-access', {
    body: { action: 'start', redirect_to: redirectTo ?? null },
  });
  if (error)
    throw new Error((await error.context?.json?.().catch(() => null))?.error ?? error.message);
  if (!data?.url) throw new Error(data?.error ?? 'Discord linking is unavailable right now.');
  return data.url as string;
}
/** Disconnect Discord and drop the role. */
export async function unlinkDiscord(): Promise<void> {
  const { error } = await supabase.functions.invoke('discord-access', {
    body: { action: 'unlink' },
  });
  if (error)
    throw new Error((await error.context?.json?.().catch(() => null))?.error ?? error.message);
}

/** Redeem a handed-out code. Works signed out: the code is the credential. */
export async function redeemInviteCode(code: string): Promise<{ url: string; expires_at: string }> {
  const { data, error } = await supabase.functions.invoke('discord-invite', {
    body: { action: 'redeem', code },
  });
  if (error)
    throw new Error((await error.context?.json?.().catch(() => null))?.error ?? error.message);
  if (!data?.url) throw new Error(data?.error ?? 'That code is not valid.');
  return data as { url: string; expires_at: string };
}
