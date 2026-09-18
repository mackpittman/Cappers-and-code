// A member's door into the Discord.
//
// Connecting a Discord account is the real step: once it is linked, membership drives the role
// automatically, so a lapsed card takes the role back without anyone doing anything. The single-use
// invite stays as the fallback for anyone who would rather walk in the front door, and as the whole
// flow while Discord linking is still unconfigured.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Body, Card, Label } from '@/components/ui';
import { useBoard } from '@/lib/store';
import { myDiscordInvite, myDiscordLink, startDiscordLink, unlinkDiscord, type DiscordLink } from '@/lib/supabase';
import { radius, space, type, useTheme } from '@/theme';

/** What Discord told us on the way back, translated for a human. */
const RETURN_MESSAGE: Record<string, string> = {
  linked: 'Discord connected. Your access is live.',
  linked_no_role: 'Discord connected, but the role did not apply. We are on it.',
  linked_unconfigured: 'Discord connected. Role access is not switched on yet.',
  taken: 'That Discord account is already tied to another membership.',
  expired: 'That link timed out. Try connecting again.',
  unconfigured: 'Discord linking is not switched on yet.',
  error: 'Something went wrong connecting Discord. Try again.',
};

function useReturnStatus(): string | null {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const p = new URLSearchParams(window.location.search).get('discord');
    if (!p) return;
    setMsg(RETURN_MESSAGE[p] ?? null);
    // Clear it so a refresh does not replay the message.
    const u = new URL(window.location.href);
    u.searchParams.delete('discord');
    window.history.replaceState({}, '', u.toString());
  }, []);
  return msg;
}

function Button({
  label,
  onPress,
  busy,
  tone = 'green',
}: {
  label: string;
  onPress: () => void;
  busy?: boolean;
  tone?: 'green' | 'quiet';
}) {
  const t = useTheme();
  const green = tone === 'green';
  return (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => ({
        marginTop: space.md,
        paddingVertical: 14,
        borderRadius: radius.sm,
        backgroundColor: green ? t.green : 'transparent',
        borderWidth: green ? 0 : 1,
        borderColor: t.line,
        opacity: busy ? 0.4 : pressed ? 0.7 : 1,
        alignItems: 'center',
      })}
    >
      <Text style={[type.label, { color: green ? t.onGreen : t.mute, letterSpacing: 1 }]}>{label}</Text>
    </Pressable>
  );
}

export default function DiscordScreen() {
  const t = useTheme();
  const { session, entitlement } = useBoard();
  const member = !!entitlement?.active;
  const returned = useReturnStatus();

  const [link, setLink] = useState<DiscordLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) {
      setLoading(false);
      return;
    }
    try {
      setLink(await myDiscordLink());
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    refresh();
  }, [refresh, returned]);

  const connect = async () => {
    setBusy(true);
    setErr(null);
    try {
      const to = Platform.OS === 'web' && typeof window !== 'undefined' ? window.location.href.split('?')[0] : undefined;
      const authorize = await startDiscordLink(to);
      if (Platform.OS === 'web' && typeof window !== 'undefined') window.location.assign(authorize);
      else await Linking.openURL(authorize);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    setErr(null);
    try {
      await unlinkDiscord();
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const getInvite = async () => {
    setBusy(true);
    setErr(null);
    try {
      setUrl((await myDiscordInvite()).url);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      hero
      title="The Discord"
      subtitle="Board drops, live plays and the room where the day gets called. Members only."
    >
      {!!returned && (
        <Card accent="green">
          <Body small>{returned}</Body>
        </Card>
      )}

      {!session ? (
        <Card>
          <Label>Sign in first</Label>
          <Body small muted>
            Your access is tied to your membership. Sign in on the Edge tab, then come back.
          </Body>
        </Card>
      ) : !member ? (
        <Card>
          <Label>Members only</Label>
          <Body small muted>
            The Discord comes with a membership. Subscribe on the Edge tab and your access turns on
            here the moment the payment lands.
          </Body>
        </Card>
      ) : loading ? (
        <Card>
          <ActivityIndicator color={t.green} />
        </Card>
      ) : link?.linked && link.role_granted ? (
        <Card accent="green">
          <Label color={t.green}>You are in</Label>
          <Body small muted>
            Connected as {link.discord_username ?? 'your Discord account'}. The members role is on
            your account and stays there as long as your membership is active.
          </Body>
          <Button label="OPEN DISCORD ↗" onPress={() => Linking.openURL('https://discord.com/channels/@me')} />
          <Button label="DISCONNECT" tone="quiet" busy={busy} onPress={disconnect} />
        </Card>
      ) : link?.linked ? (
        <Card>
          <Label>Access pending</Label>
          <Body small muted>
            Connected as {link.discord_username ?? 'your Discord account'}, but the members role is
            not on your account yet. It retries every hour on its own. If it stays stuck, tell us.
          </Body>
          {!!link.last_error && (
            <Text style={[type.small, { color: t.mute, marginTop: space.sm }]}>{link.last_error}</Text>
          )}
          <Button label="DISCONNECT" tone="quiet" busy={busy} onPress={disconnect} />
        </Card>
      ) : link?.configured ? (
        <Card accent="green">
          <Label color={t.green}>Connect your Discord</Label>
          <Body small muted>
            One tap. We read your username and add you to the server with the members role. We never
            post as you and we cannot read your messages.
          </Body>
          <Button label={busy ? 'OPENING…' : 'CONNECT DISCORD'} busy={busy} onPress={connect} />
        </Card>
      ) : url ? (
        <Card accent="green">
          <Label color={t.green}>Your invite is ready</Label>
          <Body small muted>Single use, good for 24 hours. If it lapses, come back and tap again.</Body>
          <Button label="OPEN DISCORD ↗" onPress={() => Linking.openURL(url)} />
          <Text style={[type.small, { color: t.mute, marginTop: space.sm }]}>{url}</Text>
        </Card>
      ) : (
        <Card accent="green">
          <Label color={t.green}>Get your invite</Label>
          <Body small muted>
            We mint a link that works once, for you. Do not forward it: whoever opens it first is the
            one who gets in.
          </Body>
          <Button label={busy ? 'MINTING…' : 'GET MY INVITE'} busy={busy} onPress={getInvite} />
        </Card>
      )}

      {!!err && (
        <View style={{ marginTop: space.sm }}>
          <Text style={[type.small, { color: t.danger }]}>{err}</Text>
        </View>
      )}

      <Card>
        <Label>Got a code instead?</Label>
        <Body small muted>
          If someone handed you an invite code, redeem it on the join screen.
        </Body>
        <Pressable onPress={() => router.push('/join')}>
          <Text style={[type.label, { color: t.green, marginTop: space.sm }]}>REDEEM A CODE →</Text>
        </Pressable>
      </Card>
    </Screen>
  );
}
