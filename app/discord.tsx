// A member's own door into the Discord. One standing single-use invite per account, reissued
// when it expires, so a forwarded link is spent the moment someone else walks through it.
import React, { useState } from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { Screen } from '@/components/Screen';
import { Body, Card, Label } from '@/components/ui';
import { useBoard } from '@/lib/store';
import { myDiscordInvite } from '@/lib/supabase';
import { radius, space, type, useTheme } from '@/theme';

export default function DiscordScreen() {
  const t = useTheme();
  const { session, entitlement } = useBoard();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const member = !!entitlement?.active;

  const get = async () => {
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
      subtitle="Board drops, live plays and the room where the day gets called. Invite-only."
    >
      {!session ? (
        <Card>
          <Label>Sign in first</Label>
          <Body small muted>
            Your invite is tied to your membership. Sign in on the Edge tab, then come back.
          </Body>
        </Card>
      ) : !member ? (
        <Card>
          <Label>Members only</Label>
          <Body small muted>
            The Discord comes with a membership. Subscribe on the Edge tab and your invite appears
            here.
          </Body>
        </Card>
      ) : url ? (
        <Card accent="green">
          <Label color={t.green}>Your invite is ready</Label>
          <Body small muted>
            Single use, good for 24 hours. If it lapses, come back and tap again.
          </Body>
          <Pressable
            onPress={() => Linking.openURL(url)}
            style={({ pressed }) => ({
              marginTop: space.md,
              paddingVertical: 14,
              borderRadius: radius.sm,
              backgroundColor: t.green,
              opacity: pressed ? 0.7 : 1,
              alignItems: 'center',
            })}
          >
            <Text style={[type.label, { color: t.onGreen, letterSpacing: 1 }]}>
              OPEN DISCORD ↗
            </Text>
          </Pressable>
          <Text style={[type.small, { color: t.mute, marginTop: space.sm }]}>{url}</Text>
        </Card>
      ) : (
        <Card accent="green">
          <Label color={t.green}>Get your invite</Label>
          <Body small muted>
            We mint a link that works once, for you. Do not forward it: whoever opens it first is
            the one who gets in.
          </Body>
          <Pressable
            onPress={get}
            disabled={busy}
            style={({ pressed }) => ({
              marginTop: space.md,
              paddingVertical: 14,
              borderRadius: radius.sm,
              backgroundColor: t.green,
              opacity: busy ? 0.4 : pressed ? 0.7 : 1,
              alignItems: 'center',
            })}
          >
            <Text style={[type.label, { color: t.onGreen, letterSpacing: 1 }]}>
              {busy ? 'MINTING…' : 'GET MY INVITE'}
            </Text>
          </Pressable>
          {!!err && (
            <Text style={[type.small, { color: t.danger, marginTop: space.sm }]}>{err}</Text>
          )}
        </Card>
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
