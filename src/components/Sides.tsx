import React, { useState } from 'react';
import { Platform, Pressable, Share, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Body, Card, H2, Label, Pill } from '@/components/ui';
import { AddToSlip } from '@/components/Slip';
import { fonts, space, type, useTheme } from '@/theme';
import type { MoneylinePick, SideRow, Sides } from '@/lib/types';
import type { SlipInput } from '@/lib/slip';

const am = (n: number | null) => (n == null ? '' : n > 0 ? `+${n}` : `${n}`);
const pct = (x: number | null | undefined) => (x == null ? '' : `${Math.round(x * 100)}%`);

const spreadSlip = (r: SideRow): SlipInput => ({
  kind: 'side',
  label: r.spread.bet,
  detail: `Spread · projected ${r.projected.away}-${r.projected.home}`,
  game_id: r.game,
  game_label: r.gameLabel,
  price: r.spread.price,
  model_prob: r.spread.prob,
  source: 'sides',
});
const mlSlip = (r: SideRow, m: MoneylinePick, detail: string): SlipInput => ({
  kind: 'ml',
  label: m.bet,
  detail,
  game_id: r.game,
  game_label: r.gameLabel,
  price: m.price,
  model_prob: m.prob,
  source: 'sides',
});

/**
 * The front page's lead block: every game on the next slate day, the side the projected score
 * covers most often at the current number, the favourite's moneyline, and any underdog the
 * projection prices above the market. Most likely cover first.
 */
export function SidesBlock({ card }: { card: Sides }) {
  const t = useTheme();
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const copy = async () => {
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(card.text);
        setMsg('Copied. Paste it into Discord.');
      } else {
        await Share.share({ message: card.text });
      }
    } catch (e: any) {
      setMsg(e?.message ?? 'Could not copy.');
    }
  };
  return (
    <>
      <H2>{card.title}</H2>
      <Body small muted>
        Every game on the slate, the side most likely to cover first. Our projected score against
        the posted number, with the moneyline the projection picks and any underdog it rates above
        the price. 1u singles.
      </Body>
      <View style={{ height: space.sm }} />
      <Card accent="green">
        {card.rows.map((r, i) => (
          <View
            key={r.game}
            style={{
              paddingVertical: space.sm,
              borderBottomWidth: i === card.rows.length - 1 ? 0 : 1,
              borderBottomColor: t.line,
            }}
          >
            <Pressable
              onPress={() =>
                router.push(
                  { pathname: '/games/[id]', params: { id: r.game } },
                  { withAnchor: true },
                )
              }
            >
              <Text style={[type.label, { color: t.mute }]}>
                {r.gameLabel} · {r.kickoffLabel} · projected {r.projected.away}-{r.projected.home}
              </Text>
            </Pressable>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                flexWrap: 'wrap',
                marginTop: 4,
              }}
            >
              <Text style={[type.h2, { color: t.ink, fontSize: 22 }]}>{r.spread.bet}</Text>
              <Pill text={`${pct(r.spread.prob)} to cover`} tone="good" />
              {r.spread.conf > 0 && (
                <Text style={[type.label, { color: t.green, fontFamily: fonts.dataBold }]}>
                  {'▮'.repeat(r.spread.conf)}
                  {'▯'.repeat(5 - r.spread.conf)}
                </Text>
              )}
              <AddToSlip item={spreadSlip(r)} compact />
            </View>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                flexWrap: 'wrap',
                marginTop: 6,
              }}
            >
              <Text style={[type.body, { color: t.ink2 }]}>
                {r.ml.bet} {am(r.ml.price)}
              </Text>
              <Pill text={`wins ${pct(r.ml.prob)}`} tone="neutral" />
              {r.ml.implied != null && <Pill text={`book ${pct(r.ml.implied)}`} tone="neutral" />}
              <AddToSlip item={mlSlip(r, r.ml, 'Moneyline · the projection’s winner')} compact />
            </View>
            {!!r.dog && (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                  flexWrap: 'wrap',
                  marginTop: 6,
                }}
              >
                <Text style={[type.body, { color: t.green }]}>
                  Dog: {r.dog.bet} {am(r.dog.price)}
                </Text>
                <Pill text={`${pct(r.dog.prob)} vs book ${pct(r.dog.implied)}`} tone="accent" />
                <AddToSlip item={mlSlip(r, r.dog, 'Moneyline · underdog value')} compact />
              </View>
            )}
            {!r.spread.agrees && !!r.spread.desk && (
              <Text style={[type.small, { color: t.mute, marginTop: 4 }]}>
                The desk wrote up {r.spread.desk}; at today’s number the projection sits on the
                other side.
              </Text>
            )}
          </View>
        ))}
        <Pressable
          onPress={copy}
          accessibilityRole="button"
          style={({ pressed }) => ({
            marginTop: space.sm,
            backgroundColor: t.green,
            padding: 12,
            borderRadius: 6,
            alignItems: 'center',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Text style={[type.label, { color: t.onGreen, fontFamily: fonts.dataBold }]}>
            COPY FOR DISCORD
          </Text>
        </Pressable>
        {!!msg && <Text style={[type.small, { color: t.green, marginTop: 4 }]}>{msg}</Text>}
        <Label>Built {new Date(card.builtAt).toLocaleString()}</Label>
      </Card>
      <View style={{ height: space.md }} />
    </>
  );
}
