// In-app alerts for the Discord feed. A post that lands while a member is on another tab bumps
// the Feed badge and shows a banner; if the page is hidden it also raises a local notification.
// Push from the service worker (lib/push.ts) is the other half: it covers the app being closed.
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBoard } from './store';
import { fetchFeed, supabase, supabaseConfigured } from './supabase';
import { appUrl, onWorkerMessage, showLocalNotification, syncPush } from './push';
import { palette, space, type } from '@/theme';

export type FeedAlert = { id: string; title: string; body: string };
type Ctx = {
  /** Posts that arrived while the member was somewhere other than the Feed tab. */
  unseen: number;
  banner: FeedAlert | null;
  markSeen: () => void;
  dismiss: () => void;
  /** The Feed screen reports its focus so arrivals there count as seen. */
  setFeedFocused: (on: boolean) => void;
  /** Bumps on every insert or edit in feed_posts; the Feed screen reloads on it. */
  version: number;
};
const noop = () => {};
const FeedAlertsContext = createContext<Ctx>({
  unseen: 0,
  banner: null,
  markSeen: noop,
  dismiss: noop,
  setFeedFocused: noop,
  version: 0,
});
export const useFeedAlerts = () => useContext(FeedAlertsContext);

const BANNER_MS = 8000;
const FRESH_MS = 15 * 60_000; // older than this on arrival is a backfill, not news

export function FeedAlertsProvider({ children }: { children: React.ReactNode }) {
  const { session, entitlement } = useBoard();
  const member = supabaseConfigured && !!session && !!entitlement?.active;
  const router = useRouter();
  const [unseen, setUnseen] = useState(0);
  const [banner, setBanner] = useState<FeedAlert | null>(null);
  const [version, setVersion] = useState(0);
  const focused = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    setBanner(null);
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const markSeen = useCallback(() => {
    setUnseen(0);
    dismiss();
  }, [dismiss]);
  const setFeedFocused = useCallback(
    (on: boolean) => {
      focused.current = on;
      if (on) markSeen();
    },
    [markSeen],
  );

  useEffect(() => {
    if (!member) return;
    syncPush();
    const channel = supabase
      .channel('feed_alerts')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'feed_posts' },
        async (payload) => {
          setVersion((v) => v + 1);
          if (payload.eventType !== 'INSERT') return; // edits refresh the feed, they do not alert
          const row = payload.new as {
            id?: string;
            author_name?: string;
            content?: string;
            posted_at?: string;
          };
          if (row.posted_at && Date.now() - Date.parse(row.posted_at) > FRESH_MS) return;
          if (focused.current) return; // the Feed screen reloads itself
          let title = row.author_name || 'The Discord';
          let body = (row.content || '').replace(/\s+/g, ' ').trim();
          try {
            // The row carries no channel label; the feed RPC does.
            const [head] = await fetchFeed(1);
            if (head && (!row.id || head.id === row.id)) {
              title = `${head.capper ?? head.author_name} in #${head.channel_name}`;
              body =
                (head.content || '').replace(/\s+/g, ' ').trim() ||
                (head.attachments.length ? 'Posted an image.' : '');
            }
          } catch {
            /* the banner still shows with what the row carried */
          }
          if (!body) body = 'New post.';
          if (body.length > 140) body = `${body.slice(0, 137)}...`;
          setUnseen((n) => n + 1);
          setBanner({ id: row.id ?? String(Date.now()), title, body });
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => setBanner(null), BANNER_MS);
          if (Platform.OS === 'web' && typeof document !== 'undefined' && document.hidden)
            showLocalNotification(title, body, appUrl('/feed'));
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [member]);
  // A tapped alert (a test one included, which needs no membership) asks the page for the Feed.
  useEffect(
    () =>
      onWorkerMessage((m) => {
        if (m.type === 'open') {
          router.push('/feed');
          markSeen();
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const value = useMemo<Ctx>(
    () => ({ unseen, banner, markSeen, dismiss, setFeedFocused, version }),
    [unseen, banner, markSeen, dismiss, setFeedFocused, version],
  );
  return <FeedAlertsContext.Provider value={value}>{children}</FeedAlertsContext.Provider>;
}

/** The banner, laid over the tabs. Tap it to open the Feed; it leaves on its own after a bit. */
export function FeedBanner() {
  const { banner, markSeen, dismiss } = useFeedAlerts();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  if (!banner) return null;
  return (
    <View
      pointerEvents="box-none"
      accessibilityLiveRegion="polite"
      style={{
        position: 'absolute',
        top: insets.top + space.sm,
        left: space.md,
        right: space.md,
        zIndex: 50,
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.sm,
        backgroundColor: palette.surface2,
        borderWidth: 1,
        borderColor: palette.lineGreen,
        borderLeftWidth: 4,
        borderLeftColor: palette.green,
        borderRadius: 8,
        padding: space.md,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`New Discord post from ${banner.title}. Open the Feed.`}
        onPress={() => {
          router.push('/feed');
          markSeen();
        }}
        style={{ flex: 1 }}
      >
        <Text style={[type.label, { color: palette.green }]}>New in the Discord</Text>
        <Text style={[type.bodyBold, { color: palette.ink, marginTop: 2 }]} numberOfLines={1}>
          {banner.title}
        </Text>
        <Text style={[type.small, { color: palette.ink2 }]} numberOfLines={2}>
          {banner.body}
        </Text>
      </Pressable>
      <Pressable
        onPress={dismiss}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
      >
        <Text style={[type.label, { color: palette.mute }]}>Dismiss</Text>
      </Pressable>
    </View>
  );
}
