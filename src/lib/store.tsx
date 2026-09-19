import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import bundled from '../../data/board.json';
import type { Board } from './types';
import { refreshFromOddsApi, refreshLinesFromEspn } from './odds';
import {
  supabase,
  supabaseConfigured,
  fetchEntitlement,
  fetchIsAdmin,
  fetchBoard,
  fetchBoardPreview,
  type Entitlement,
} from './supabase';

const KEY_BOARD = 'cappers.board.v2';
const KEY_SETTINGS = 'cappers.settings.v2';
const extra = (Constants.expoConfig?.extra ?? {}) as { boardUrl?: string; checkoutUrl?: string };

export type Settings = {
  boardUrl: string;
  boardToken: string;
  oddsApiKey: string;
  region: string;
  hoursAhead: number;
};
export type Preview = {
  season: number;
  week: number;
  generatedAt: string;
  oddsFetchedAt?: string | null;
  lockedIn: { gameLabel: string; market: string; conf: number }[];
  tdBoard: { name: string; team: string; pos: string }[];
  games: { id: string; away: string; home: string; kickoff: string }[];
  memberCount: { games: number; picks: number; stacks: number };
};
type Ctx = {
  board: Board;
  preview: Preview | null;
  source: 'bundled' | 'cache' | 'remote' | 'live' | 'member';
  loading: boolean;
  error: string | null;
  lastSync: string | null;
  session: Session | null;
  entitlement: Entitlement | null;
  /** Server-answered: may this account see the operator controls. Never inferred from the email. */
  isAdmin: boolean;
  authReady: boolean;
  checkoutUrl: string;
  settings: Settings;
  saveSettings: (s: Partial<Settings>) => Promise<void>;
  refreshBoard: () => Promise<void>;
  refreshLines: () => Promise<void>;
  refreshPrices: () => Promise<{
    creditsRemaining: number | null;
    propsFetched: number;
    errors: string[];
  }>;
  signInWithEmail: (email: string) => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (email: string, password: string) => Promise<'signed_in' | 'confirm_email'>;
  verifyCode: (email: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshEntitlement: () => Promise<void>;
};
const BoardContext = createContext<Ctx | null>(null);

export function BoardProvider({ children }: { children: React.ReactNode }) {
  const [board, setBoard] = useState<Board>(bundled as unknown as Board);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [source, setSource] = useState<Ctx['source']>('bundled');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [entitlement, setEntitlement] = useState<Entitlement | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [authReady, setAuthReady] = useState(!supabaseConfigured);
  const [settings, setSettings] = useState<Settings>({
    boardUrl: extra.boardUrl ?? '',
    boardToken: '',
    oddsApiKey: '',
    region: 'us',
    hoursAhead: 8,
  });

  const refreshEntitlement = useCallback(async () => {
    if (!supabaseConfigured || !session) {
      setEntitlement(null);
      return;
    }
    try {
      setEntitlement(await fetchEntitlement());
    } catch (e: any) {
      setError(`Membership check failed: ${e.message ?? e}`);
    }
  }, [session]);

  /** Members get the full board from Supabase; everyone else gets the preview. Falls back to the optional GitHub URL. */
  const refreshBoard = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (supabaseConfigured) {
        const pv = (await fetchBoardPreview().catch(() => null)) as Preview | null;
        if (pv) setPreview(pv);
        if (session) {
          const ent = await fetchEntitlement();
          setEntitlement(ent);
          if (ent.active) {
            const full = (await fetchBoard()) as Board | null;
            if (full?.games?.length) {
              setBoard(full);
              setSource('member');
              await AsyncStorage.setItem(KEY_BOARD, JSON.stringify(full));
            }
          }
        }
        setLastSync(new Date().toISOString());
        return;
      }
      if (!settings.boardUrl) return;
      const headers: Record<string, string> = { 'Cache-Control': 'no-cache' };
      if (/api\.github\.com/.test(settings.boardUrl)) headers.Accept = 'application/vnd.github.raw';
      if (settings.boardToken) headers.Authorization = `Bearer ${settings.boardToken.trim()}`;
      const res = await fetch(
        `${settings.boardUrl}${settings.boardUrl.includes('?') ? '&' : '?'}t=${Date.now()}`,
        { headers },
      );
      if (!res.ok) throw new Error(`Board fetch failed (${res.status})`);
      const json = (await res.json()) as Board;
      if (!json?.games?.length) throw new Error('Board file is empty');
      setBoard(json);
      setSource('remote');
      await AsyncStorage.setItem(KEY_BOARD, JSON.stringify(json));
      setLastSync(new Date().toISOString());
    } catch (e: any) {
      const m = String(e?.message ?? e);
      setError(
        /fetch|network/i.test(m) ? 'Could not reach the board. Showing the last saved copy.' : m,
      );
    } finally {
      setLoading(false);
    }
  }, [session, settings.boardUrl, settings.boardToken]);

  const refreshLines = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await refreshLinesFromEspn(board);
      setBoard(next);
      setLastSync(new Date().toISOString());
      await AsyncStorage.setItem(KEY_BOARD, JSON.stringify(next));
    } catch (e: any) {
      setError(`Could not refresh lines: ${e.message ?? String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [board]);

  const refreshPrices = useCallback(async () => {
    if (!settings.oddsApiKey) throw new Error('Add your Odds API key in Settings first.');
    setLoading(true);
    setError(null);
    try {
      const r = await refreshFromOddsApi(board, settings.oddsApiKey.trim(), {
        region: settings.region,
        hoursAhead: settings.hoursAhead,
      });
      setBoard(r.board);
      setSource('live');
      setLastSync(new Date().toISOString());
      await AsyncStorage.setItem(KEY_BOARD, JSON.stringify(r.board));
      return {
        creditsRemaining: r.creditsRemaining,
        propsFetched: r.propsFetched,
        errors: r.errors,
      };
    } catch (e: any) {
      setError(e.message ?? String(e));
      throw e;
    } finally {
      setLoading(false);
    }
  }, [board, settings]);

  const saveSettings = useCallback(
    async (s: Partial<Settings>) => {
      const next = { ...settings, ...s };
      setSettings(next);
      await AsyncStorage.setItem(KEY_SETTINGS, JSON.stringify(next));
    },
    [settings],
  );

  const signInWithEmail = useCallback(async (email: string) => {
    // The free plan sends a link, not a code. Point the link back at this app: the web build's own
    // URL (sign-in completes there), or the native scheme.
    const emailRedirectTo =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? `${window.location.origin}${window.location.pathname}`
        : 'cappers://';
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: true, emailRedirectTo },
    });
    if (error) throw error;
  }, []);
  const signInWithPassword = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) throw error;
  }, []);
  const signUpWithPassword = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
    });
    if (error) throw error;
    return data.session ? ('signed_in' as const) : ('confirm_email' as const);
  }, []);
  const verifyCode = useCallback(async (email: string, code: string) => {
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim().toLowerCase(),
      token: code.trim(),
      type: 'email',
    });
    if (error) throw error;
  }, []);
  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setEntitlement(null);
    setSource('bundled');
    setBoard(bundled as unknown as Board);
    await AsyncStorage.removeItem(KEY_BOARD);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [b, s] = await Promise.all([
          AsyncStorage.getItem(KEY_BOARD),
          AsyncStorage.getItem(KEY_SETTINGS),
        ]);
        if (s) setSettings((prev) => ({ ...prev, ...JSON.parse(s) }));
        if (b) {
          const cached = JSON.parse(b) as Board;
          if (cached.generatedAt >= (bundled as any).generatedAt) {
            setBoard(cached);
            setSource('cache');
          }
        }
      } catch {
        /* stay on bundled */
      }
    })();
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);
  // Reload whenever the session changes (sign in, sign out, refresh).
  useEffect(() => {
    if (authReady) refreshBoard(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [authReady, session?.user?.id]);
  // Admin status rides on the session rather than on either place that sets the entitlement, so
  // signing out always clears it and no path can leave a stale yes behind.
  useEffect(() => {
    let live = true;
    if (!supabaseConfigured || !session) {
      setIsAdmin(false);
      return;
    }
    fetchIsAdmin().then((ok) => {
      if (live) setIsAdmin(ok);
    });
    return () => {
      live = false;
    };
  }, [session?.user?.id]);

  const value = useMemo(
    () => ({
      board,
      preview,
      source,
      loading,
      error,
      lastSync,
      session,
      entitlement,
      isAdmin,
      authReady,
      checkoutUrl: extra.checkoutUrl ?? '',
      settings,
      saveSettings,
      refreshBoard,
      refreshLines,
      refreshPrices,
      signInWithEmail,
      signInWithPassword,
      signUpWithPassword,
      verifyCode,
      signOut,
      refreshEntitlement,
    }),
    [
      board,
      preview,
      source,
      loading,
      error,
      lastSync,
      session,
      entitlement,
      isAdmin,
      authReady,
      settings,
      saveSettings,
      refreshBoard,
      refreshLines,
      refreshPrices,
      signInWithEmail,
      signInWithPassword,
      signUpWithPassword,
      verifyCode,
      signOut,
      refreshEntitlement,
    ],
  );
  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>;
}
export function useBoard() {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error('useBoard must be used inside BoardProvider');
  return ctx;
}
