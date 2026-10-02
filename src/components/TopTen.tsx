import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { fonts, space, type, useTheme } from '@/theme';
import { Body, Card, H2, Label } from '@/components/ui';
import { AddToSlip } from '@/components/Slip';
import type { Board, TopTenPlay } from '@/lib/types';
import type { SlipInput } from '@/lib/slip';

const am = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const pct = (x: number | null | undefined) => (x == null ? '—' : `${Math.round(x * 100)}%`);

function slipOf(p: TopTenPlay, key: string): SlipInput {
  const kind =
    key === 'sides'
      ? 'side'
      : key === 'totals'
        ? 'total'
        : key === 'moneyline'
          ? 'side'
          : key === 'props'
            ? 'prop'
            : 'atd';
  return {
    kind: kind as SlipInput['kind'],
    label: p.bet,
    detail: `Top 10 · ${p.gameLabel}`,
    game_id: p.game,
    game_label: p.gameLabel,
    price: p.price ?? null,
    book:
      p.price != null
        ? key === 'atd' || key === 'value' || key === 'td2'
          ? 'research'
          : 'FD/DK'
        : null,
    model_prob: p.prob ?? null,
    source: 'top10',
  };
}

/** The front page lead: ten plays per market, each with the model's number beside the price. */
export function TopTen({ board }: { board: Board }) {
  const t = useTheme();
  const router = useRouter();
  const cats = (board.topTen?.categories ?? []).filter((c) => c.plays.length);
  const [key, setKey] = useState(cats[0]?.key ?? 'sides');
  if (!cats.length) return null;
  const cat = cats.find((c) => c.key === key) ?? cats[0];
  return (
    <>
      <H2>Top 10 by market · Week {board.week}</H2>
      <View
        style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, marginBottom: space.sm }}
      >
        {cats.map((c) => {
          const on = c.key === cat.key;
          return (
            <Pressable
              key={c.key}
              onPress={() => setKey(c.key)}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 10,
                borderRadius: 999,
                borderWidth: 1,
                borderColor: on ? t.green : t.line,
                backgroundColor: on ? t.green : t.surface,
              }}
            >
              <Text
                style={[type.label, { color: on ? t.onGreen : t.ink2, fontFamily: fonts.dataBold }]}
              >
                {c.title.toUpperCase()}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Body small muted>
        {cat.blurb}
      </Body>
      <View style={{ height: space.xs }} />
      <Card accent="green">
        {cat.plays.map((p, i) => (
          <Pressable
            key={`${cat.key}-${i}`}
            onPress={() => router.push({ pathname: '/game/[id]', params: { id: p.game } })}
            style={{
              paddingVertical: 8,
              borderBottomWidth: i === cat.plays.length - 1 ? 0 : 1,
              borderBottomColor: t.line,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Text style={[type.label, { color: t.green, width: 22, fontFamily: fonts.dataBold }]}>
                {i + 1}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={[type.body, { color: t.ink, fontFamily: fonts.dataBold }]}>
                  {p.bet}
                </Text>
                <Text style={[type.small, { color: t.ink2 }]}>
                  {p.gameLabel}
                  {p.price != null
                    ? ` · ${am(p.price)}`
                    : p.fair != null
                      ? ` · fair ${am(p.fair)}`
                      : ''}
                  {p.price != null && p.priceNote ? ` (${p.priceNote})` : ''}
                  {p.prob != null ? ` · model ${pct(p.prob)}` : ''}
                  {p.implied != null ? ` · book ${pct(p.implied)}` : ''}
                  {p.edge != null
                    ? ` · edge ${p.edge > 0 ? '+' : ''}${Math.round(p.edge * 100)}`
                    : ''}
                  {p.conf ? ` · conf ${p.conf}/5` : ''}
                </Text>
              </View>
              <AddToSlip item={slipOf(p, cat.key)} compact />
            </View>
          </Pressable>
        ))}
      </Card>
      {!!board.topTen?.note && (
        <Body small muted>
          {board.topTen.note}
        </Body>
      )}
      <Label>
        Prices from the desk's research and the line feed; check your book before you fire.
      </Label>
      <View style={{ height: space.md }} />
    </>
  );
}
