import React, { useState } from 'react';
import { Linking, Platform, Pressable, Share, Text, TextInput, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Body, Card, H2, Label, Pill } from '@/components/ui';
import {
  fmtPrice,
  slipSummary,
  slipText,
  useSlip,
  type SlipItem,
  type SlipStatus,
} from '@/lib/slip';
import { useBoard } from '@/lib/store';
import { pct } from '@/lib/odds';
import { fonts, space, type, useTheme } from '@/theme';

const STATUSES: SlipStatus[] = ['queued', 'placed', 'won', 'lost', 'push'];

async function copyOrShare(text: string): Promise<string> {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return 'Slip copied.';
  }
  await Share.share({ message: text });
  return 'Slip shared.';
}

function Row({ i }: { i: SlipItem }) {
  const t = useTheme();
  const { update, remove } = useSlip();
  const [price, setPrice] = useState(i.price != null ? String(i.price) : '');
  const tone =
    i.status === 'won'
      ? 'good'
      : i.status === 'lost'
        ? 'bad'
        : i.status === 'placed'
          ? 'accent'
          : 'neutral';
  return (
    <Card accent={i.status === 'won' ? 'green' : undefined}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <Text style={[type.bodyBold, { color: t.ink }]}>{i.label}</Text>
          <Text style={[type.small, { color: t.mute }]}>
            {[i.game_label, i.detail, i.book].filter(Boolean).join(' · ')}
            {i.model_prob != null ? ` · model ${pct(i.model_prob)}` : ''}
          </Text>
          {!!i.legs?.length && (
            <View style={{ marginTop: 4, gap: 2 }}>
              {i.legs.map((l, n) => (
                <Text key={n} style={[type.small, { color: t.ink2 }]}>
                  〉 {l.label}
                  {l.price != null ? ` ${fmtPrice(l.price)}` : ''}
                  {l.book ? ` ${l.book}` : ''}
                </Text>
              ))}
            </View>
          )}
        </View>
        <View style={{ alignItems: 'flex-end', gap: 8 }}>
          <Pressable onPress={() => remove(i.id)} hitSlop={10}>
            <Text style={[type.label, { color: t.mute }]}>REMOVE</Text>
          </Pressable>
          {!!i.link && (
            <Pressable
              onPress={() => Linking.openURL(i.link as string)}
              hitSlop={8}
              style={{
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 6,
                backgroundColor: t.green,
              }}
            >
              <Text style={[type.label, { color: t.onGreen, letterSpacing: 1 }]}>
                BET {i.book ?? ''} ↗
              </Text>
            </Pressable>
          )}
        </View>
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.sm,
          marginTop: space.sm,
          flexWrap: 'wrap',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={[type.label, { color: t.mute }]}>PRICE</Text>
          <TextInput
            value={price}
            onChangeText={setPrice}
            onBlur={() => {
              const n = Number(price.replace('+', ''));
              update(i.id, { price: price.trim() === '' || Number.isNaN(n) ? null : n });
            }}
            keyboardType="numbers-and-punctuation"
            placeholder="—"
            placeholderTextColor={t.mute}
            style={{
              color: t.green,
              fontFamily: fonts.dataBold,
              fontSize: 15,
              minWidth: 64,
              paddingVertical: 4,
              paddingHorizontal: 8,
              borderWidth: 1,
              borderColor: t.line,
              borderRadius: 6,
            }}
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text style={[type.label, { color: t.mute }]}>UNITS</Text>
          <Pressable
            onPress={() => update(i.id, { units: Math.max(0.25, Number(i.units) - 0.25) })}
            hitSlop={8}
          >
            <Text style={[type.h2, { color: t.green, fontSize: 20 }]}>−</Text>
          </Pressable>
          <Text
            style={[
              type.mono,
              { color: t.ink, fontFamily: fonts.dataBold, minWidth: 32, textAlign: 'center' },
            ]}
          >
            {Number(i.units)}u
          </Text>
          <Pressable onPress={() => update(i.id, { units: Number(i.units) + 0.25 })} hitSlop={8}>
            <Text style={[type.h2, { color: t.green, fontSize: 20 }]}>+</Text>
          </Pressable>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: space.sm, flexWrap: 'wrap' }}>
        {STATUSES.map((s) => (
          <Pressable key={s} onPress={() => update(i.id, { status: s })}>
            <Pill text={s} tone={i.status === s ? tone : 'neutral'} />
          </Pressable>
        ))}
      </View>
    </Card>
  );
}

export default function SlipScreen() {
  const t = useTheme();
  const { items, today, todays, clearDay, synced } = useSlip();
  const { session } = useBoard();
  const [msg, setMsg] = useState<string | null>(null);
  const s = slipSummary(todays);
  const pastDays = Array.from(new Set(items.filter((i) => i.day !== today).map((i) => i.day)))
    .sort()
    .reverse();
  const record = items.filter((i) => i.day !== today || i.status !== 'queued');
  const tally = {
    won: record.filter((i) => i.status === 'won').length,
    lost: record.filter((i) => i.status === 'lost').length,
    push: record.filter((i) => i.status === 'push').length,
  };
  return (
    <Screen
      title="My Slip"
      subtitle="Everything you tapped + SLIP on today. Set units, mark placed, grade it after the games. Units, not dollars."
    >
      <Card accent="green">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          <Stat label="Picks" value={String(s.count)} />
          <Stat label="Units" value={`${s.units}u`} />
          {s.parlayPrice != null && <Stat label="All parlayed" value={fmtPrice(s.parlayPrice)} />}
          {s.parlayProb != null && <Stat label="Model joint" value={pct(s.parlayProb)} />}
        </View>
        <Body small muted>
          {session
            ? synced
              ? 'Saved to your account; the same slip shows on every device you sign into.'
              : 'Saving to your account…'
            : 'Signed out: this slip stays on this device only.'}
        </Body>
        <View
          style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm, flexWrap: 'wrap' }}
        >
          <Btn
            label="Copy slip"
            primary
            disabled={!todays.length}
            onPress={async () => setMsg(await copyOrShare(slipText(today, todays)))}
          />
          <Btn label="Clear today" disabled={!todays.length} onPress={() => clearDay(today)} />
        </View>
        {!!msg && <Text style={[type.small, { color: t.green, marginTop: space.xs }]}>{msg}</Text>}
      </Card>

      <H2>Today · {today}</H2>
      {todays.length === 0 ? (
        <Card>
          <Label>Slip is empty</Label>
          <Body small muted>
            Tap + SLIP next to any pick on the Edge, Games, or Parlays screens and it lands here.
          </Body>
        </Card>
      ) : (
        todays.map((i) => <Row key={i.id} i={i} />)
      )}

      {pastDays.length > 0 && (
        <>
          <H2>History</H2>
          <Card>
            <Label>Your graded record</Label>
            <Text style={[type.h2, { color: t.ink }]}>
              {tally.won}-{tally.lost}
              {tally.push ? `-${tally.push}` : ''}
            </Text>
            <Body small muted>
              Only what you marked won or lost. The model's own record lives on the Edge tab.
            </Body>
          </Card>
          {pastDays.map((day) => (
            <View key={day}>
              <Label>{day}</Label>
              {items
                .filter((i) => i.day === day)
                .map((i) => (
                  <Row key={i.id} i={i} />
                ))}
            </View>
          ))}
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
function Btn({
  label,
  onPress,
  primary,
  disabled,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 6,
        backgroundColor: primary ? t.green : t.surface2,
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <Text style={[type.label, { color: primary ? t.onGreen : t.ink, letterSpacing: 1 }]}>
        {label.toUpperCase()}
      </Text>
    </Pressable>
  );
}
