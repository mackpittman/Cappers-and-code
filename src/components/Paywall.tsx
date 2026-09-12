import React, { useState } from 'react';
import { Linking, Pressable, Text, TextInput, View } from 'react-native';
import { copy, fonts, palette, radius, space, type } from '@/theme';
import { useBoard } from '@/lib/store';
import { Card, Label, Pill } from './ui';
import { startCheckout } from '@/lib/supabase';
import { LegalLinks } from './LegalLinks';

/** Sign-in and membership gate. Shown on the Edge tab to anyone who is not an active member. */
export function Paywall() {
  const {
    session,
    entitlement,
    preview,
    signInWithEmail,
    signInWithPassword,
    signUpWithPassword,
    verifyCode,
    signOut,
    checkoutUrl,
    refreshBoard,
  } = useBoard();
  const [mode, setMode] = useState<'signin' | 'signup' | 'code'>('signin');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const input = {
    borderWidth: 1,
    borderColor: palette.line,
    borderRadius: radius.sm,
    padding: 12,
    color: palette.ink,
    backgroundColor: palette.surface2,
    fontFamily: fonts.data,
    fontSize: 15,
  } as const;
  const run = async (fn: () => Promise<void>, ok: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
    } catch (e: any) {
      setMsg(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };
  const Button = ({
    label,
    onPress,
    primary,
  }: {
    label: string;
    onPress: () => void;
    primary?: boolean;
  }) => (
    <Pressable
      onPress={onPress}
      disabled={busy}
      style={({ pressed }) => ({
        backgroundColor: primary ? palette.green : palette.surface2,
        borderWidth: 1,
        borderColor: primary ? palette.green : palette.line,
        padding: 14,
        borderRadius: radius.sm,
        alignItems: 'center',
        opacity: pressed || busy ? 0.6 : 1,
      })}
    >
      <Text style={[type.h2, { color: primary ? palette.onGreen : palette.ink, fontSize: 18 }]}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={{ gap: space.sm }}>
      <Card accent="green">
        <Label color={palette.green}>{copy.positioning}</Label>
        <Text style={[type.h1, { color: palette.ink, marginTop: 6 }]}>Unlock the Edge</Text>
        <Text style={[type.body, { color: palette.ink2, marginTop: 8 }]}>
          Every game priced. Every touchdown scorer with live odds and edge. Market leans, prop
          lines, correlated stacks, injuries, and the members-only Discord. $10 a month. Cancel
          anytime.
        </Text>
        {preview && (
          <View style={{ flexDirection: 'row', gap: 8, marginTop: space.md, flexWrap: 'wrap' }}>
            <Pill text={`${preview.memberCount.games} games`} tone="good" />
            <Pill text={`${preview.memberCount.picks} scorer calls`} tone="good" />
            <Pill text={`${preview.memberCount.stacks} stacks`} tone="good" />
          </View>
        )}
      </Card>

      {!session ? (
        <Card>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: space.sm }}>
            {(['signin', 'signup', 'code'] as const).map((m) => (
              <Pressable
                key={m}
                onPress={() => {
                  setMode(m);
                  setSent(false);
                  setMsg(null);
                }}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 4,
                  backgroundColor: mode === m ? palette.green : palette.surface2,
                }}
              >
                <Text
                  style={[
                    type.label,
                    { color: mode === m ? palette.onGreen : palette.ink, letterSpacing: 1 },
                  ]}
                >
                  {m === 'signin' ? 'Sign in' : m === 'signup' ? 'Create account' : 'Email code'}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            id="email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            placeholder="you@email.com"
            placeholderTextColor={palette.mute}
            style={input}
          />
          <View style={{ height: space.sm }} />
          {mode !== 'code' ? (
            <>
              <TextInput
                id="password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                placeholder={mode === 'signup' ? 'Choose a password (8+ characters)' : 'Password'}
                placeholderTextColor={palette.mute}
                style={input}
              />
              <View style={{ height: space.sm }} />
              {mode === 'signin' ? (
                <Button
                  label="Sign in"
                  primary
                  onPress={() =>
                    run(async () => {
                      await signInWithPassword(email, password);
                      await refreshBoard();
                    }, 'Signed in.')
                  }
                />
              ) : (
                <Button
                  label="Create account"
                  primary
                  onPress={() =>
                    run(async () => {
                      const r = await signUpWithPassword(email, password);
                      if (r === 'signed_in') await refreshBoard();
                      else
                        throw new Error('Check your email to confirm the account, then sign in.');
                    }, 'Account created. You are signed in.')
                  }
                />
              )}
            </>
          ) : !sent ? (
            <Button
              label="Send code"
              primary
              onPress={() =>
                run(async () => {
                  await signInWithEmail(email);
                  setSent(true);
                }, 'Code sent. Check your inbox.')
              }
            />
          ) : (
            <>
              <TextInput
                id="code"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                placeholder="6-digit code"
                placeholderTextColor={palette.mute}
                style={input}
              />
              <View style={{ height: space.sm }} />
              <Button
                label="Verify and sign in"
                primary
                onPress={() =>
                  run(async () => {
                    await verifyCode(email, code);
                    await refreshBoard();
                  }, 'Signed in.')
                }
              />
            </>
          )}
          <Text style={[type.small, { color: palette.mute, marginTop: space.sm }]}>
            By continuing you confirm you are of legal age in your jurisdiction and understand this
            is analysis, not financial advice. Units, not dollars.
          </Text>
          <LegalLinks />
        </Card>
      ) : (
        <Card>
          <Label>Signed in as {session.user.email}</Label>
          <View style={{ height: space.sm }} />
          {entitlement?.active ? (
            <Pill text={`Member · ${entitlement.plan}`} tone="good" />
          ) : (
            <>
              <Text style={[type.body, { color: palette.ink2 }]}>
                No active membership on this account yet.
              </Text>
              <View style={{ height: space.sm }} />
              <Button
                label="Start membership · $10/mo"
                primary
                onPress={() =>
                  run(async () => {
                    const url = await startCheckout('monthly');
                    await Linking.openURL(url);
                  }, 'Opening secure checkout…')
                }
              />
              <View style={{ height: space.xs }} />
              <Button
                label="Founder season pass · $20"
                onPress={() =>
                  run(async () => {
                    const url = await startCheckout('founder_season');
                    await Linking.openURL(url);
                  }, 'Opening secure checkout…')
                }
              />
              <View style={{ height: space.xs }} />
              <Button
                label="I already paid, refresh"
                onPress={() => run(refreshBoard, 'Membership refreshed.')}
              />
            </>
          )}
          <View style={{ height: space.xs }} />
          <Button label="Sign out" onPress={() => run(signOut, 'Signed out.')} />
          <LegalLinks />
        </Card>
      )}
      {!!msg && <Text style={[type.small, { color: palette.ink2 }]}>{msg}</Text>}

      {preview && (
        <Card>
          <Label color={palette.green}>This week, for members</Label>
          <Text style={[type.small, { color: palette.mute, marginBottom: 6 }]}>
            Week {preview.week} · locked in plays by market and confidence
          </Text>
          {preview.lockedIn.map((b, i) => (
            <View
              key={i}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingVertical: 6,
                borderBottomWidth: i === preview.lockedIn.length - 1 ? 0 : 1,
                borderColor: palette.line,
              }}
            >
              <Text style={[type.bodyBold, { color: palette.ink }]}>{b.gameLabel}</Text>
              <Text style={[type.body, { color: palette.ink2 }]}>{b.market}</Text>
              <Text style={[type.mono, { color: palette.green }]}>
                {'▮'.repeat(b.conf)}
                {'▯'.repeat(5 - b.conf)}
              </Text>
            </View>
          ))}
          <Text style={[type.small, { color: palette.mute, marginTop: 8 }]}>
            TD board names this week: {preview.tdBoard.map((p) => p.name).join(' · ')}
          </Text>
        </Card>
      )}
    </View>
  );
}
