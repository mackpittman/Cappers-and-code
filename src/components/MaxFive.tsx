import React, { useState } from 'react';
import { Platform, Pressable, Share, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Body, Card, H2, Label, Pill } from '@/components/ui';
import { AddToSlip } from '@/components/Slip';
import { fonts, space, type, useTheme } from '@/theme';
import type { MaxFive, MaxFiveTicket } from '@/lib/types';
import type { SlipInput } from '@/lib/slip';

const am = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const pct = (x: number | null | undefined) => (x == null ? '' : `${Math.round(x * 100)}%`);

function slipOf(t: MaxFiveTicket): SlipInput {
  return {
    kind: 'parlay',
    label: `${t.gameLabel} five-leg, no TDs`,
    detail: `Max-confidence five-leg #${t.rank}`,
    game_id: t.game,
    game_label: t.gameLabel,
    price: t.price,
    book: 'FD/DK',
    model_prob: t.joint,
    legs: t.legs.map((l) => ({ label: l.label, price: l.price, book: l.book })),
    source: 'max-five',
  };
}

/**
 * The front page's headline card: the day's five-leg tickets (volume props, no touchdowns) with
 * the best joint hit rate after the morning check, and one button that copies them for Discord.
 */
export function MaxFiveBlock({ card }: { card: MaxFive }) {
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
        The {card.tickets.length} five-leg tickets with the best hit rate on the slate. Every leg is
        a volume prop at an alternate line, no touchdowns, and every one was checked this morning
        against the injury report, the main line and the weather. 0.25u each.
      </Body>
      <View style={{ height: space.sm }} />
      <Card accent="green">
        {card.tickets.map((x, i) => (
          <View
            key={x.game}
            style={{
              paddingVertical: space.sm,
              borderBottomWidth: i === card.tickets.length - 1 ? 0 : 1,
              borderBottomColor: t.line,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
              <Text style={[type.label, { color: t.green, fontFamily: fonts.dataBold, flex: 1 }]}>
                #{x.rank} · {x.kickoffLabel}
              </Text>
              <Text style={[type.label, { color: t.mute }]}>0.25u</Text>
            </View>
            <Pressable
              onPress={() =>
                router.push(
                  { pathname: '/games/[id]', params: { id: x.game } },
                  { withAnchor: true },
                )
              }
            >
              <Text style={[type.h2, { color: t.ink, fontSize: 22, marginTop: 2 }]}>
                {x.gameLabel} five-leg
              </Text>
            </Pressable>
            <View style={{ marginTop: 2, gap: 2 }}>
              {x.legs.map((l, j) => (
                <Text key={j} style={[type.small, { color: t.ink2 }]}>
                  {'〉'} {l.label}
                  {`  ${am(l.price)}`}
                </Text>
              ))}
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
              <Pill text={am(x.price)} tone="accent" />
              <Pill text={`model ${pct(x.joint)}`} tone="good" />
              <Pill text={`book ${pct(x.bookJoint)}`} tone="neutral" />
              <AddToSlip item={slipOf(x)} compact />
            </View>
            {!!x.check && (
              <Text style={[type.small, { color: t.mute, marginTop: 4 }]} numberOfLines={3}>
                {x.check}
              </Text>
            )}
          </View>
        ))}
        {card.pulled.length > 0 && (
          <Text style={[type.small, { color: t.mute, marginTop: space.sm }]}>
            Left off after the morning check:{' '}
            {card.pulled.map((p) => `${p.gameLabel} (${p.reason})`).join(' ')}
          </Text>
        )}
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
        <Label>Checked {new Date(card.checkedAt ?? card.builtAt).toLocaleString()}</Label>
      </Card>
      <View style={{ height: space.md }} />
    </>
  );
}
