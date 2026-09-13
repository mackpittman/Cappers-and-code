import React, { useCallback, useEffect, useState } from 'react';
import { Image, Linking, Pressable, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Body, Card, H2, Label, Pill } from '@/components/ui';
import { useBoard } from '@/lib/store';
import { fetchFeed, subscribeFeed } from '@/lib/supabase';
import { palette, space, type, useTheme } from '@/theme';
import type { FeedPost } from '@/lib/types';

const URL_RE = /(https?:\/\/[^\s<]+)/g;

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function Linkified({ text }: { text: string }) {
  const t = useTheme();
  const parts = text.split(URL_RE);
  return (
    <Text style={[type.body, { color: t.ink }]}>
      {parts.map((p, i) =>
        URL_RE.test(p) ? (
          <Text key={i} style={{ color: t.green }} onPress={() => Linking.openURL(p)}>
            {p}
          </Text>
        ) : (
          <Text key={i}>{p}</Text>
        ),
      )}
    </Text>
  );
}

function Post({ p }: { p: FeedPost }) {
  const t = useTheme();
  const images = p.attachments.filter((a) => a.type?.startsWith('image/'));
  const files = p.attachments.filter((a) => !a.type?.startsWith('image/'));
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        {p.author_avatar ? (
          <Image
            source={{ uri: p.author_avatar }}
            style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: t.surface2 }}
          />
        ) : (
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: 14,
              backgroundColor: t.surface2,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={[type.label, { color: t.green }]}>{p.author_name.slice(0, 1)}</Text>
          </View>
        )}
        <Text style={[type.bodyBold, { color: t.ink, flexShrink: 1 }]} numberOfLines={1}>
          {p.author_name}
        </Text>
        <Pill text={p.capper ?? `#${p.channel_name}`} tone={p.capper ? 'good' : 'neutral'} />
        <Text style={[type.mono, { color: t.mute, marginLeft: 'auto' }]}>{ago(p.posted_at)}</Text>
      </View>
      {!!p.content && (
        <View style={{ marginTop: space.sm }}>
          <Linkified text={p.content} />
        </View>
      )}
      {images.map((a, i) => (
        <Image
          key={i}
          source={{ uri: a.url }}
          resizeMode="contain"
          style={{
            width: '100%',
            aspectRatio: a.width && a.height ? a.width / a.height : 4 / 3,
            marginTop: space.sm,
            borderRadius: 8,
            backgroundColor: t.surface2,
          }}
        />
      ))}
      {files.map((a, i) => (
        <Pressable key={i} onPress={() => Linking.openURL(a.url)} style={{ marginTop: space.xs }}>
          <Text style={[type.small, { color: t.green }]}>{a.name}</Text>
        </Pressable>
      ))}
      {p.embeds.map((e, i) =>
        e.title || e.description || e.image ? (
          <Pressable
            key={i}
            onPress={() => e.url && Linking.openURL(e.url)}
            style={{
              marginTop: space.sm,
              borderLeftWidth: 3,
              borderLeftColor: t.green2,
              paddingLeft: space.sm,
            }}
          >
            {!!e.title && <Text style={[type.bodyBold, { color: t.ink }]}>{e.title}</Text>}
            {!!e.description && (
              <Text style={[type.small, { color: t.ink2 }]} numberOfLines={6}>
                {e.description}
              </Text>
            )}
            {!!e.image && (
              <Image
                source={{ uri: e.image }}
                resizeMode="contain"
                style={{ width: '100%', aspectRatio: 16 / 9, marginTop: space.xs, borderRadius: 8 }}
              />
            )}
          </Pressable>
        ) : null,
      )}
    </Card>
  );
}

export default function FeedScreen() {
  const t = useTheme();
  const { session, entitlement } = useBoard();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const member = !!session && !!entitlement?.active;

  const load = useCallback(async (before?: string) => {
    setStatus('loading');
    try {
      const rows = await fetchFeed(50, before);
      setPosts((prev) => (before ? [...prev, ...rows] : rows));
      setDone(rows.length < 50);
      setStatus('idle');
      setErr(null);
    } catch (e: any) {
      setStatus('error');
      setErr(e.message ?? String(e));
    }
  }, []);

  useEffect(() => {
    if (!member) return;
    load();
    // Live: new rows arrive through Realtime; refetch the head so channel labels come along.
    return subscribeFeed(() => load());
  }, [member, load]);

  return (
    <Screen
      title="Feed"
      subtitle="Every post from the Cappers & Code Discord, as it happens. Chef, Kyle and the crew, in one place."
    >
      {!member ? (
        <Card accent="green">
          <Label>Members only</Label>
          <Body small muted>
            The live Discord feed unlocks with a membership. Sign in on the Edge tab.
          </Body>
        </Card>
      ) : (
        <>
          {status === 'error' && (
            <Card>
              <Label color={palette.danger}>Could not load the feed</Label>
              <Body small muted>
                {err}
              </Body>
            </Card>
          )}
          {posts.length === 0 && status !== 'loading' && (
            <Card>
              <Label>Nothing yet</Label>
              <Body small muted>
                Posts show up here within a minute of landing in Discord.
              </Body>
            </Card>
          )}
          {posts.map((p) => (
            <Post key={p.id} p={p} />
          ))}
          {posts.length > 0 && !done && (
            <Pressable
              onPress={() => load(posts[posts.length - 1].posted_at)}
              disabled={status === 'loading'}
              style={{
                padding: 12,
                borderRadius: 6,
                alignItems: 'center',
                backgroundColor: t.surface2,
                marginBottom: space.md,
              }}
            >
              <Text style={[type.label, { color: t.green }]}>
                {status === 'loading' ? 'Loading…' : 'Load older posts'}
              </Text>
            </Pressable>
          )}
          <H2>About the feed</H2>
          <Body small muted>
            Mirrored from the Discord by the CC Core bot once a minute. Images are copied so they
            keep working after Discord's links expire. Cappers' picks are their own; the model's
            calls live on the Edge and Parlays tabs.
          </Body>
        </>
      )}
    </Screen>
  );
}
