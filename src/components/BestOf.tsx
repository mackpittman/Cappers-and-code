import React, { useState } from 'react';
import { Platform, Pressable, Share, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Body, Card, H2, Label, Pill } from '@/components/ui';
import { AddToSlip } from '@/components/Slip';
import { fonts, space, type, useTheme } from '@/theme';
import type { BestOf, BestOfPlay } from '@/lib/types';
import type { SlipInput } from '@/lib/slip';

const am = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const pct = (x: number | null | undefined) => (x == null ? '' : `${Math.round(x * 100)}%`);

function slipOf(p: BestOfPlay): SlipInput {
  const multi = p.key === 'fiveLeg' || p.key === 'lotto';
  const kind: SlipInput['kind'] = multi
    ? 'parlay'
    : p.key === 'side' || p.key === 'moneyline' || p.key === 'dog'
      ? 'side'
      : p.key === 'total'
        ? 'total'
        : p.key === 'td2'
          ? 'td2'
          : 'atd';
  return {
    kind,
    label: p.bet,
    detail: `${p.title} · best of the slate`,
    game_id: multi ? null : p.game,
    game_label: p.gameLabel,
    price: p.price,
    book: p.key === 'atd' || p.key === 'value' || p.key === 'td2' ? 'research' : 'FD/DK',
    model_prob: p.prob,
    legs: p.legs?.map((l) => ({ label: l.label, price: l.price, book: l.book ?? null })) ?? null,
    source: 'best-of',
  };
}

/**
 * The front page lead: the model's single best play in every market for the next day of games,
 * and one button that copies the whole block for Discord.
 */
export function BestOfBlock({ best }: { best: BestOf }) {
  const t = useTheme();
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const copy = async () => {
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(best.text);
        setMsg('Copied. Paste it into Discord.');
      } else {
        await Share.share({ message: best.text });
      }
    } catch (e: any) {
      setMsg(e?.message ?? 'Could not copy.');
    }
  };
  return (
    <>
      <H2>{best.title}</H2>
      <Body small muted>
        The model's single best play in every market across {best.games} games, each with its own
        hit rate beside the price. Units, not dollars.
      </Body>
      <View style={{ height: space.sm }} />
      <Card accent="green">
        {best.plays.map((p, i) => (
          <View
            key={`${p.key}-${i}`}
            style={{
              paddingVertical: space.sm,
              borderBottomWidth: i === best.plays.length - 1 ? 0 : 1,
              borderBottomColor: t.line,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Text style={[type.label, { color: t.green, fontFamily: fonts.dataBold, flex: 1 }]}>
                {p.title}
              </Text>
              <Text style={[type.label, { color: t.mute }]}>{p.units}u</Text>
            </View>
            <Pressable
              disabled={p.key === 'lotto'}
              onPress={() =>
                p.key !== 'lotto' &&
                router.push(
                  { pathname: '/games/[id]', params: { id: p.game } },
                  { withAnchor: true },
                )
              }
            >
              <Text style={[type.h2, { color: t.ink, fontSize: 22, marginTop: 2 }]}>
                {p.key === 'fiveLeg' ? `${p.gameLabel} five-leg` : p.bet}
              </Text>
            </Pressable>
            {!!p.legs?.length && (
              <View style={{ marginTop: 2, gap: 2 }}>
                {p.legs.map((l, j) => (
                  <Text key={j} style={[type.small, { color: t.ink2 }]}>
                    {'〉'} {l.label}
                    {l.price != null ? `  ${am(l.price)}` : ''}
                  </Text>
                ))}
              </View>
            )}
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                flexWrap: 'wrap',
                marginTop: 6,
              }}
            >
              {p.price != null && <Pill text={am(p.price)} tone="accent" />}
              {p.prob != null && <Pill text={`model ${pct(p.prob)}`} tone="good" />}
              {p.implied != null && <Pill text={`book ${pct(p.implied)}`} tone="neutral" />}
              {p.key !== 'fiveLeg' && p.key !== 'lotto' && (
                <Pill
                  text={[p.gameLabel, p.kickoffLabel].filter(Boolean).join(' · ')}
                  tone="neutral"
                />
              )}
              <AddToSlip item={slipOf(p)} compact />
            </View>
            {!!p.why && (
              <Text style={[type.small, { color: t.mute, marginTop: 4 }]} numberOfLines={3}>
                {p.why}
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
        <Label>Built {new Date(best.builtAt).toLocaleString()}</Label>
      </Card>
    </>
  );
}
