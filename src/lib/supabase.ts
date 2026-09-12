import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createClient } from '@supabase/supabase-js';

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
      detectSessionInUrl: false,
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
