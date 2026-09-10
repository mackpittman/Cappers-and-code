import React, { useState } from 'react';
import { Alert, Linking, Pressable, Text, TextInput, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Body, Card, H2, Label } from '@/components/ui';
import { useBoard } from '@/lib/store';
import { ago } from '@/lib/format';
import { space, type, useTheme } from '@/theme';

export default function SettingsScreen() {
  const t = useTheme();
  const { settings, saveSettings, refreshBoard, refreshPrices, board, loading, lastSync } =
    useBoard();
  const [key, setKey] = useState(settings.oddsApiKey);
  const [url, setUrl] = useState(settings.boardUrl);
  const [msg, setMsg] = useState<string | null>(null);
  const input = {
    borderWidth: 1,
    borderColor: t.line,
    borderRadius: 6,
    padding: 10,
    color: t.ink,
    backgroundColor: t.surface,
    ...type.mono,
  } as const;
  const button = (label: string, onPress: () => void, primary = false) => (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={({ pressed }) => ({
        backgroundColor: primary ? t.turf : t.surface2,
        padding: 12,
        borderRadius: 6,
        alignItems: 'center',
        opacity: pressed || loading ? 0.6 : 1,
      })}
    >
      <Text style={[type.body, { color: primary ? t.onAccent : t.ink, fontWeight: '700' }]}>
        {label}
      </Text>
    </Pressable>
  );
  const pull = async () => {
    try {
      await saveSettings({ oddsApiKey: key.trim() });
      const r = await refreshPrices();
      setMsg(
        `Pulled props for ${r.propsFetched} games. Credits remaining: ${r.creditsRemaining ?? 'unknown'}.${r.errors.length ? ` Errors: ${r.errors.join('; ')}` : ''}`,
      );
    } catch (e: any) {
      Alert.alert('Could not refresh prices', e.message ?? String(e));
    }
  };
  return (
    <Screen
      title="Settings"
      subtitle="Where the daily board comes from and how live prices are pulled."
    >
      <H2>Daily board</H2>
      <Card>
        <Label>Board URL</Label>
        <Body small muted>
          The daily GitHub Action rebuilds board.json every morning (schedule, injuries, odds,
          research). The app pulls it on launch and on pull-to-refresh.
        </Body>
        <View style={{ height: space.sm }} />
        <TextInput
          id="boardUrl"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          style={input}
          placeholder="https://.../board.json"
          placeholderTextColor={t.mute}
        />
        <View style={{ height: space.sm }} />
        {button('Save and refresh board', async () => {
          await saveSettings({ boardUrl: url.trim() });
          await refreshBoard();
          setMsg('Board refreshed.');
        })}
        <Body small muted>
          Board generated {ago(board.generatedAt)} · research as of{' '}
          {new Date(board.researchAsOf).toLocaleString()} · last sync {ago(lastSync)}
        </Body>
      </Card>
      <H2>Live prices (The Odds API)</H2>
      <Card>
        <Label>API key</Label>
        <Body small muted>
          Free tier is 500 credits a month. One pull here costs about 3 credits for game lines plus
          1 per game inside the props window. The daily Action spends roughly 16 a day, so keep
          manual pulls for game day.
        </Body>
        <View style={{ height: space.sm }} />
        <TextInput
          id="oddsApiKey"
          value={key}
          onChangeText={setKey}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={input}
          placeholder="paste key"
          placeholderTextColor={t.mute}
        />
        <View style={{ height: space.sm }} />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>{button('Pull live prices now', pull, true)}</View>
          <View style={{ flex: 1 }}>
            {button('Get a free key', () => Linking.openURL('https://the-odds-api.com/'))}
          </View>
        </View>
        <View style={{ height: space.sm }} />
        <Label>Props window (days ahead)</Label>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
          {[2, 4, 7].map((d) => (
            <Pressable
              key={d}
              onPress={() => saveSettings({ daysAhead: d })}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 4,
                backgroundColor: settings.daysAhead === d ? t.turf : t.surface2,
              }}
            >
              <Text
                style={[
                  type.small,
                  { color: settings.daysAhead === d ? t.onAccent : t.ink, fontWeight: '700' },
                ]}
              >
                {d}
              </Text>
            </Pressable>
          ))}
        </View>
        {board.oddsCredits?.remaining != null && (
          <Body small muted>
            Credits remaining after last pull: {board.oddsCredits.remaining}
          </Body>
        )}
        {!!msg && <Body small>{msg}</Body>}
      </Card>
      <H2>About</H2>
      <Card>
        <Body small muted>
          Research is rebuilt weekly from each team's offseason moves, the offense-vs-defense
          matchup, and practice reports. Odds and injuries update daily. Estimates are opinions, not
          guarantees; bet responsibly.
        </Body>
      </Card>
    </Screen>
  );
}
