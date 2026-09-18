import React, { useMemo, useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { router } from 'expo-router';
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
import { GAMBLY_WARNING, discordChannelUrl, gamblyLines, gamblyMessage } from '@/lib/gambly';
import { DISCORD_GUILD_ID, GAMBLY_CHANNEL_ID, SITE_URL, gamblyConfigured } from '@/lib/site';
import { pct } from '@/lib/odds';
import { fonts, radius, space, type, useTheme } from '@/theme';

const STATUSES: SlipStatus[] = ['queued', 'placed', 'won', 'lost', 'push'];

async function copyOrShare(text: string): Promise<string> {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return 'Slip copied.';
  }
  await Share.share({ message: text });
  return 'Slip shared.';
}


/** The graphic pinned in the members' channel, shown in place so nobody has to go looking for it. */
const HOWTO_URL = `${SITE_URL}/sheets/gambly-howto.png`;
const HOWTO_RATIO = 1200 / 1360;

function HowToModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTheme();
  const { width, height } = useWindowDimensions();
  // Fit the sheet to whichever dimension runs out first, so it is never cropped and never
  // overflows on a short screen.
  const w = Math.min(width - space.md * 2, 640);
  const h = Math.min(w / HOWTO_RATIO, height * 0.78);
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        accessibilityLabel="Close"
        style={{
          flex: 1,
          backgroundColor: 'rgba(5,6,8,0.92)',
          alignItems: 'center',
          justifyContent: 'center',
          padding: space.md,
        }}
      >
        {/* Stop a tap on the sheet itself from closing it. */}
        <Pressable onPress={() => {}} style={{ maxHeight: '90%' }}>
          <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
            <Image
              source={{ uri: HOWTO_URL }}
              style={{ width: w, height: h, borderRadius: radius.sm }}
              resizeMode="contain"
              accessibilityLabel="How to send your slip to your sportsbook, in five steps"
            />
          </ScrollView>
          <Pressable
            onPress={onClose}
            style={{
              marginTop: space.md,
              paddingVertical: 13,
              borderRadius: radius.sm,
              backgroundColor: t.green,
              alignItems: 'center',
            }}
          >
            <Text style={[type.label, { color: t.onGreen, letterSpacing: 1 }]}>GOT IT</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** A square that reads as on or off at a glance, and is big enough to hit while walking. */
function SelectBox({ on, onPress }: { on: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
      accessibilityLabel={on ? 'Included in the Gambly slip' : 'Not included in the Gambly slip'}
      style={{
        width: 26,
        height: 26,
        borderRadius: 7,
        borderWidth: 2,
        borderColor: on ? t.green : t.line,
        backgroundColor: on ? t.green : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
      }}
    >
      {on && <Text style={{ color: t.onGreen, fontSize: 15, lineHeight: 17, fontWeight: '900' }}>✓</Text>}
    </Pressable>
  );
}

function Row({
  i,
  selectable,
  selected,
  onToggle,
}: {
  i: SlipItem;
  selectable?: boolean;
  selected?: boolean;
  onToggle?: () => void;
}) {
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
        {selectable && <SelectBox on={!!selected} onPress={onToggle ?? (() => {})} />}
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
  // Excluded rather than included: a pick tapped onto the slip is in the send by default, so the
  // common case of "send everything" costs no taps at all.
  const [howto, setHowto] = useState(false);
  const [sendMsg, setSendMsg] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Record<string, boolean>>({});
  const picked = useMemo(() => todays.filter((i) => !excluded[i.id]), [todays, excluded]);
  const s = slipSummary(todays);
  const sel = slipSummary(picked);
  const legCount = useMemo(() => gamblyLines(picked).length, [picked]);
  const allOn = picked.length === todays.length;
  const toggle = (id: string) => setExcluded((p) => ({ ...p, [id]: !p[id] }));
  const setAll = (on: boolean) =>
    setExcluded(on ? {} : Object.fromEntries(todays.map((i) => [i.id, true])));

  const sendToGambly = async () => {
    const text = gamblyMessage(picked);
    if (!text) return setSendMsg('Pick at least one before sending.');
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard)
        await navigator.clipboard.writeText(text);
      else await Share.share({ message: text });
      const appUrl = discordChannelUrl(DISCORD_GUILD_ID, GAMBLY_CHANNEL_ID, true);
      const webUrl = discordChannelUrl(DISCORD_GUILD_ID, GAMBLY_CHANNEL_ID);
      const useApp =
        Platform.OS !== 'web' && (await Linking.canOpenURL(appUrl).catch(() => false));
      await Linking.openURL(useApp ? appUrl : webUrl);
      setSendMsg('Copied. Paste it in the channel and send.');
    } catch (e: any) {
      setSendMsg(e?.message ?? String(e));
    }
  };
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
      {gamblyConfigured && (
        <Pressable
          onPress={() => setHowto(true)}
          hitSlop={10}
          accessibilityRole="button"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            paddingVertical: space.xs,
          }}
        >
          <Text style={[type.small, { color: t.mute }]}>New to this?</Text>
          <Text style={[type.label, { color: t.green }]}>HOW IT WORKS</Text>
        </Pressable>
      )}
      <HowToModal open={howto} onClose={() => setHowto(false)} />

      {gamblyConfigured && todays.length > 0 && (
        <Card accent="green">
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: space.sm,
            }}
          >
            <Label color={t.green}>Send to Gambly</Label>
            <Pressable onPress={() => setAll(!allOn)} hitSlop={10}>
              <Text style={[type.label, { color: t.mute }]}>{allOn ? 'CLEAR ALL' : 'SELECT ALL'}</Text>
            </Pressable>
          </View>

          {/* The count is the whole point of the card: it says exactly what is about to be sent. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, marginTop: space.sm }}>
            <Stat label="Selected" value={`${picked.length} of ${todays.length}`} />
            <Stat label="Legs" value={String(legCount)} />
            {sel.parlayPrice != null && <Stat label="Parlayed" value={fmtPrice(sel.parlayPrice)} />}
          </View>

          <Pressable
            onPress={sendToGambly}
            disabled={picked.length === 0}
            style={({ pressed }) => ({
              marginTop: space.md,
              paddingVertical: 15,
              borderRadius: radius.sm,
              backgroundColor: picked.length === 0 ? t.surface2 : t.green,
              opacity: pressed ? 0.7 : 1,
              alignItems: 'center',
            })}
          >
            <Text
              style={[
                type.label,
                { color: picked.length === 0 ? t.mute : t.onGreen, letterSpacing: 1 },
              ]}
            >
              {picked.length === 0
                ? 'SELECT A PICK'
                : `SEND ${picked.length} TO GAMBLY`}
            </Text>
          </Pressable>
          <Body small muted>
            Copies your picks and opens the Discord. Paste, send, and GamblyBot replies with a
            betslip that opens in your book. The reply lands on the Feed tab here too.
          </Body>
          {!!sendMsg && (
            <Text style={[type.small, { color: t.green, marginTop: space.sm }]}>{sendMsg}</Text>
          )}
          <Text style={[type.small, { color: t.mute, marginTop: 6, lineHeight: 18 }]}>
            {GAMBLY_WARNING}
          </Text>
        </Card>
      )}

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
          <Btn
            label="Send to book"
            disabled={!todays.length}
            onPress={() => router.push('/send')}
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
        todays.map((i) => (
          <Row
            key={i.id}
            i={i}
            selectable={gamblyConfigured}
            selected={!excluded[i.id]}
            onToggle={() => toggle(i.id)}
          />
        ))
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
