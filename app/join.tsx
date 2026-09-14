// Redeem an invite code for a one-time Discord link. Public: the code is the credential, so this
// works signed out. Nothing here reveals whether a code exists, is spent, or has expired.
import React, { useState } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Body, Card, Label } from '@/components/ui';
import { redeemInviteCode } from '@/lib/supabase';
import { fonts, radius, space, type, useTheme } from '@/theme';

export default function JoinScreen() {
  const t = useTheme();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await redeemInviteCode(code.trim().toUpperCase());
      setUrl(r.url);
    } catch (e: any) {
      setErr(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      hero
      title="Join the Discord"
      subtitle="The room is invite-only. Enter the code you were given and we'll open a door for you."
    >
      {url ? (
        <Card accent="green">
          <Label color={t.green}>Your door is open</Label>
          <Body small muted>
            This link works once and expires in 24 hours. Use it on the device you have Discord on.
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
          <Label color={t.green}>Invite code</Label>
          <TextInput
            value={code}
            onChangeText={(v) => setCode(v.toUpperCase())}
            onSubmitEditing={submit}
            autoCapitalize="characters"
            autoCorrect={false}
            placeholder="CC-XXXXXX"
            placeholderTextColor={t.mute}
            accessibilityLabel="Invite code"
            style={{
              marginTop: space.sm,
              borderWidth: 1,
              borderColor: t.line,
              borderRadius: radius.sm,
              backgroundColor: t.surface2,
              color: t.ink,
              fontFamily: fonts.dataBold,
              fontSize: 22,
              letterSpacing: 3,
              padding: 14,
            }}
          />
          <Pressable
            onPress={submit}
            disabled={busy || code.trim().length < 4}
            style={({ pressed }) => ({
              marginTop: space.md,
              paddingVertical: 14,
              borderRadius: radius.sm,
              backgroundColor: t.green,
              opacity: busy || code.trim().length < 4 ? 0.4 : pressed ? 0.7 : 1,
              alignItems: 'center',
            })}
          >
            <Text style={[type.label, { color: t.onGreen, letterSpacing: 1 }]}>
              {busy ? 'CHECKING…' : 'REDEEM CODE'}
            </Text>
          </Pressable>
          {!!err && (
            <Text style={[type.small, { color: t.danger, marginTop: space.sm }]}>{err}</Text>
          )}
        </Card>
      )}
      <Card>
        <Label>No code?</Label>
        <Body small muted>
          Codes go to members. Subscribe on the Edge tab and your invite appears in the app, or ask
          whoever sent you here for one.
        </Body>
      </Card>
    </Screen>
  );
}
