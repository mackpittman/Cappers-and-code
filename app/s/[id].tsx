// A shared slip, opened from a link. Read-only: the picks, the prices, the stakes, nothing else.
import { useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Platform, Pressable, Share, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Body, Card, H2, Label } from '@/components/ui';
import { importText } from '@/lib/books';
import { fmtPrice, toAmerican, toDecimal } from '@/lib/slip';
import { loadSharedSlip, sharedSlipUrl, type SharedSlip } from '@/lib/share';
import { fonts, space, type, useTheme } from '@/theme';

export default function SharedSlipScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [slip, setSlip] = useState<SharedSlip | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (!id) return;
    loadSharedSlip(String(id))
      .then(
        (s) => live && (s ? setSlip(s) : setErr('That slip link has expired or never existed.')),
      )
      .catch((e) => live && setErr(String(e.message ?? e)));
    return () => {
      live = false;
    };
  }, [id]);

  const picks = slip?.payload?.picks ?? [];
  const priced = picks.filter((p) => typeof p.price === 'number');
  const parlay =
    priced.length > 1
      ? toAmerican(priced.reduce((d, p) => d * toDecimal(p.price as number), 1))
      : null;
  const units = picks.reduce((n, p) => n + (Number(p.units) || 0), 0);

  const copy = async () => {
    const text = picks
      .flatMap((p) =>
        p.legs?.length
          ? p.legs.map((l) => `${l.label}${l.price != null ? ` ${fmtPrice(l.price)}` : ''}`)
          : [`${p.label}${p.price != null ? ` ${fmtPrice(p.price)}` : ''}`],
      )
      .join('\n');
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      setMsg('Legs copied.');
    } else {
      await Share.share({ message: text });
    }
  };

  return (
    <Screen
      hero
      title={slip?.title ?? 'Shared slip'}
      subtitle={
        slip ? `${picks.length} picks · ${units}u · ${slip.day}` : 'Loading the slip from its link.'
      }
    >
      {err && (
        <Card>
          <Label>Nothing here</Label>
          <Body small muted>
            {err}
          </Body>
        </Card>
      )}
      {slip && (
        <>
          <Card accent="green">
            <View style={{ flexDirection: 'row', gap: space.lg, flexWrap: 'wrap' }}>
              <Stat label="Picks" value={String(picks.length)} />
              <Stat label="Units" value={`${units}u`} />
              {parlay != null && <Stat label="All parlayed" value={fmtPrice(parlay)} />}
            </View>
            <Pressable onPress={copy}>
              <Text style={[type.label, { color: t.green, marginTop: space.sm }]}>
                COPY THE LEGS
              </Text>
            </Pressable>
            {!!msg && <Text style={[type.small, { color: t.green }]}>{msg}</Text>}
          </Card>
          <H2>The slip</H2>
          <Card>
            {picks.map((p, n) => (
              <View
                key={n}
                style={{
                  paddingVertical: 10,
                  borderBottomWidth: 1,
                  borderBottomColor: t.line,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
                  <Text style={[type.bodyBold, { color: t.ink, flex: 1 }]}>{p.label}</Text>
                  <Text style={[type.mono, { color: t.green, fontFamily: fonts.dataBold }]}>
                    {fmtPrice(p.price)}
                  </Text>
                </View>
                <Text style={[type.small, { color: t.mute }]}>
                  {[p.game, p.detail, p.book, `${p.units}u`].filter(Boolean).join(' · ')}
                </Text>
                {p.legs?.map((l, m) => (
                  <Text key={m} style={[type.small, { color: t.ink2, marginTop: 2 }]}>
                    〉 {l.label}
                    {l.price != null ? ` ${fmtPrice(l.price)}` : ''}
                  </Text>
                ))}
              </View>
            ))}
          </Card>
          <Body small muted>
            {sharedSlipUrl(slip.id)} · units, not dollars.
          </Body>
        </>
      )}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ minWidth: 80 }}>
      <Text style={[type.label, { color: t.mute }]}>{label}</Text>
      <Text style={[type.h2, { color: t.green, fontSize: 24 }]}>{value}</Text>
    </View>
  );
}
