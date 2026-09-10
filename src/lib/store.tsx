import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import bundled from '../../data/board.json';
import type { Board } from './types';
import { refreshFromOddsApi, refreshLinesFromEspn } from './odds';

const KEY_BOARD = 'cappers.board.v1';
const KEY_SETTINGS = 'cappers.settings.v1';
const DEFAULT_URL: string = (Constants.expoConfig?.extra as any)?.boardUrl ?? '';

export type Settings = {
  boardUrl: string;
  boardToken: string;
  oddsApiKey: string;
  region: string;
  hoursAhead: number;
};
type Ctx = {
  board: Board;
  source: 'bundled' | 'cache' | 'remote' | 'live';
  loading: boolean;
  error: string | null;
  lastSync: string | null;
  settings: Settings;
  saveSettings: (s: Partial<Settings>) => Promise<void>;
  refreshBoard: () => Promise<void>;
  refreshLines: () => Promise<void>;
  refreshPrices: () => Promise<{
    creditsRemaining: number | null;
    propsFetched: number;
    errors: string[];
  }>;
};
const BoardContext = createContext<Ctx | null>(null);

export function BoardProvider({ children }: { children: React.ReactNode }) {
  const [board, setBoard] = useState<Board>(bundled as unknown as Board);
  const [source, setSource] = useState<Ctx['source']>('bundled');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({
    boardUrl: DEFAULT_URL,
    boardToken: '',
    oddsApiKey: '',
    region: 'us',
    hoursAhead: 8,
  });

  const refreshBoard = useCallback(async () => {
    if (!settings.boardUrl) return;
    setLoading(true);
    setError(null);
    try {
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
      // Never replace a newer board with an older one.
      if (json.generatedAt >= board.generatedAt || source === 'bundled') {
        setBoard(json);
        setSource('remote');
        await AsyncStorage.setItem(KEY_BOARD, JSON.stringify(json));
      }
      setLastSync(new Date().toISOString());
    } catch (e: any) {
      const m = String(e?.message ?? e);
      setError(
        /fetch|network/i.test(m)
          ? 'Could not reach the daily board. Showing the last saved copy.'
          : m,
      );
    } finally {
      setLoading(false);
    }
  }, [settings.boardUrl, settings.boardToken, board.generatedAt, source]);

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

  const saveSettings = useCallback(
    async (s: Partial<Settings>) => {
      const next = { ...settings, ...s };
      setSettings(next);
      await AsyncStorage.setItem(KEY_SETTINGS, JSON.stringify(next));
    },
    [settings],
  );

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
        /* storage unavailable: stay on bundled */
      }
    })();
  }, []);
  // Pull the daily board once settings are known.
  useEffect(() => {
    if (settings.boardUrl)
      refreshBoard(); /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [settings.boardUrl]);

  const value = useMemo(
    () => ({
      board,
      source,
      loading,
      error,
      lastSync,
      settings,
      saveSettings,
      refreshBoard,
      refreshLines,
      refreshPrices,
    }),
    [
      board,
      source,
      loading,
      error,
      lastSync,
      settings,
      saveSettings,
      refreshBoard,
      refreshLines,
      refreshPrices,
    ],
  );
  return <BoardContext.Provider value={value}>{children}</BoardContext.Provider>;
}
export function useBoard() {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error('useBoard must be used inside BoardProvider');
  return ctx;
}
