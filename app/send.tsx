// Send to book: take the slip you built here and get it into the app you actually bet in,
// with the least retyping each book allows. Deep link where they let us, tap list where they don't.
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useMemo, useState } from 'react';
import { Linking, Platform, Pressable, Share, Text, View } from 'react-native';
import { Screen } from '@/components/Screen';
import { Body, Card, H2, Label, Pill } from '@/components/ui';
import { BOOKS, deepLink, importText, tapOrder, type BookKey } from '@/lib/books';
import { fmtPrice, slipSummary, slipText, useSlip } from '@/lib/slip';
import { publishSlip } from '@/lib/share';
import { GAMBLY_WARNING, discordChannelUrl, gamblyMessage } from '@/lib/gambly';
import { DISCORD_GUILD_ID, GAMBLY_CHANNEL_ID, gamblyConfigured } from '@/lib/site';
import { fonts, radius, space, type, useTheme } from '@/theme';

const BOOK_KEY = 'cappers.sendbook.v1';
const DONE_KEY = (day: string) => `cappers.buildalong.${day}`;

async function handOff(text: string, subject?: string): Promise<string> {
  if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return 'Copied.';
  }
  await Share.share({ message: text, title: subject });
  return 'Shared.';
}

export default function SendScreen() {
  const t = useTheme();
  const { today, todays } = useSlip();
  const [book, setBook] = useState<BookKey>('fanduel');
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(BOOK_KEY)
      .then((v) => v && setBook(v as BookKey))
      .catch(() => {});
  }, []);
  useEffect(() => {
    AsyncStorage.getItem(DONE_KEY(today))
      .then((v) => v && setDone(JSON.parse(v)))
      .catch(() => {});
  }, [today]);
  const mark = (id: string) => {
    setDone((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      AsyncStorage.setItem(DONE_KEY(today), JSON.stringify(next)).catch(() => {});
      return next;
    });
  };
  const chooseBook = (k: BookKey) => {
    setBook(k);
    AsyncStorage.setItem(BOOK_KEY, k).catch(() => {});
  };

  const b = BOOKS.find((x) => x.key === book) ?? BOOKS[0];
  const sections = useMemo(() => tapOrder(todays, book), [todays, book]);
  const linked = useMemo(
    () => todays.map((i) => ({ i, url: deepLink(i, book) })).filter((x) => !!x.url),
    [todays, book],
  );
  const totalSteps = sections.reduce((n, s) => n + s.steps.length, 0);
  const doneSteps = sections.reduce((n, s) => n + s.steps.filter((x) => done[x.id]).length, 0);
  const s = slipSummary(todays);

  const run = async (fn: () => Promise<string>) => {
    try {
      setMsg(await fn());
    } catch (e: any) {
      setMsg(e?.message ?? String(e));
    }
  };

  return (
    <Screen
      title="Send to book"
      subtitle="Your queue, ready to place. No book lets anyone else put a bet on for you, so the last tap is always yours. Everything else we can kill."
    >
      {todays.length === 0 ? (
        <Card>
          <Label>Slip is empty</Label>
          <Body small muted>
            Tap + SLIP on any pick and it lands on today's slip, then come back here.
          </Body>
        </Card>
      ) : (
        <>
          {gamblyConfigured && (
            <Card>
              <Label color={t.green}>One click, every book</Label>
              <Body small muted>
                Copies your picks and opens the members' Discord. Paste and send, and GamblyBot
                replies with a betslip that opens straight in your book. The reply shows up on the
                Feed tab here too.
              </Body>
              <Pressable
                onPress={() =>
                  run(async () => {
                    const text = gamblyMessage(todays);
                    if (!text) return 'Nothing on the slip yet.';
                    await handOff(text, 'Slip for GamblyBot');
                    // Try the app first so a phone lands in Discord rather than a browser tab.
                    const app = discordChannelUrl(DISCORD_GUILD_ID, GAMBLY_CHANNEL_ID, true);
                    const web = discordChannelUrl(DISCORD_GUILD_ID, GAMBLY_CHANNEL_ID);
                    const ok = Platform.OS !== 'web' && (await Linking.canOpenURL(app).catch(() => false));
                    await Linking.openURL(ok ? app : web);
                    return 'Copied. Paste it in the channel and send.';
                  })
                }
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
                  SEND TO GAMBLY
                </Text>
              </Pressable>
              <Text style={[type.small, { color: t.mute, marginTop: space.sm, lineHeight: 18 }]}>
                {GAMBLY_WARNING}
              </Text>
            </Card>
          )}

          <Card accent="green">
            <Label color={t.green}>Where are you betting</Label>
            <View
              style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm }}
            >
              {BOOKS.map((x) => {
                const on = x.key === book;
                return (
                  <Pressable
                    key={x.key}
                    onPress={() => chooseBook(x.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 14,
                      borderRadius: radius.sm,
                      borderWidth: 1,
                      borderColor: on ? t.green : t.line,
                      backgroundColor: on ? t.green : t.surface2,
                    }}
                  >
                    <Text style={[type.label, { color: on ? t.onGreen : t.ink2 }]}>{x.name}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Body small muted>
              {b.note}
            </Body>
            <View style={{ flexDirection: 'row', gap: space.md, marginTop: space.sm }}>
              <Stat label="Picks" value={String(s.count)} />
              <Stat label="Legs" value={String(totalSteps)} />
              <Stat label="Units" value={`${s.units}u`} />
              {s.parlayPrice != null && (
                <Stat label="All parlayed" value={fmtPrice(s.parlayPrice)} />
              )}
            </View>
          </Card>

          {linked.length > 0 && (
            <>
              <H2>Open straight in {b.name}</H2>
              <Card>
                <Body small muted>
                  These land the selection in their slip. One tap each; parlays get built on their
                  side once the legs are in.
                </Body>
                {linked.map(({ i, url }) => (
                  <View
                    key={i.id}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space.sm,
                      paddingVertical: 10,
                      borderBottomWidth: 1,
                      borderBottomColor: t.line,
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={[type.bodyBold, { color: t.ink }]}>{i.label}</Text>
                      <Text style={[type.small, { color: t.mute }]}>
                        {fmtPrice(i.price)} · {i.units}u
                      </Text>
                    </View>
                    <Btn label={`Open ↗`} primary onPress={() => Linking.openURL(url as string)} />
                  </View>
                ))}
              </Card>
            </>
          )}

          <H2>Hand it over</H2>
          <Card>
            <Body small muted>
              Legs copies one selection per line, which is the shape screenshot-to-betslip
              converters read. Tickets keeps each parlay together as its own block.
            </Body>
            <View
              style={{ flexDirection: 'row', gap: space.sm, marginTop: space.sm, flexWrap: 'wrap' }}
            >
              <Btn
                label="Copy legs"
                primary
                onPress={() => run(async () => handOff(importText(todays, 'legs')))}
              />
              <Btn
                label="Copy tickets"
                onPress={() => run(async () => handOff(importText(todays, 'tickets')))}
              />
              <Btn
                label="Copy full slip"
                onPress={() => run(async () => handOff(slipText(today, todays)))}
              />
              <Btn
                label="Share link"
                onPress={() =>
                  run(async () => {
                    const { url } = await publishSlip(today, todays, `Slip ${today}`);
                    setLink(url);
                    return handOff(url, 'Cappers & Code slip');
                  })
                }
              />
              {!!b.home && (
                <Btn label={`Open ${b.name} ↗`} onPress={() => Linking.openURL(b.home)} />
              )}
            </View>
            {!!link && (
              <Text style={[type.small, { color: t.green, marginTop: space.sm }]}>{link}</Text>
            )}
            {!!msg && <Text style={[type.small, { color: t.green, marginTop: 4 }]}>{msg}</Text>}
          </Card>

          <H2>Build along</H2>
          <Card>
            <View
              style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}
            >
              <Label>Grouped by game so you stay on one screen in their app</Label>
              <Label color={doneSteps === totalSteps ? t.green : t.mute}>
                {doneSteps}/{totalSteps}
              </Label>
            </View>
            {doneSteps > 0 && (
              <Pressable
                onPress={() => {
                  setDone({});
                  AsyncStorage.removeItem(DONE_KEY(today)).catch(() => {});
                }}
              >
                <Text style={[type.small, { color: t.mute }]}>Reset checklist</Text>
              </Pressable>
            )}
          </Card>
          {sections.map((sec) => (
            <View key={sec.game}>
              <Label>{sec.game}</Label>
              <Card>
                {sec.steps.map((st) => {
                  const on = !!done[st.id];
                  return (
                    <Pressable
                      key={st.id}
                      onPress={() => mark(st.id)}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space.sm,
                        paddingVertical: 10,
                        borderBottomWidth: 1,
                        borderBottomColor: t.line,
                        opacity: on ? 0.45 : 1,
                      }}
                    >
                      <View
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 6,
                          borderWidth: 1,
                          borderColor: on ? t.green : t.line,
                          backgroundColor: on ? t.green : 'transparent',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        {on && <Text style={[type.label, { color: t.onGreen }]}>✓</Text>}
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={[
                            type.bodyBold,
                            {
                              color: t.ink,
                              textDecorationLine: on ? 'line-through' : 'none',
                            },
                          ]}
                        >
                          {st.selection}
                        </Text>
                        <Text style={[type.small, { color: t.mute }]}>
                          search “{st.search}”{st.book ? ` · ${st.book}` : ''} · {st.units}u
                        </Text>
                      </View>
                      <Text
                        style={[
                          type.mono,
                          { color: t.green, fontFamily: fonts.dataBold, marginRight: 4 },
                        ]}
                      >
                        {st.price}
                      </Text>
                      {st.link ? (
                        <Pressable
                          onPress={() => Linking.openURL(st.link as string)}
                          hitSlop={8}
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 5,
                            borderRadius: 6,
                            backgroundColor: t.green,
                          }}
                        >
                          <Text style={[type.label, { color: t.onGreen }]}>OPEN</Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          onPress={() => run(async () => handOff(st.search))}
                          hitSlop={8}
                          style={{
                            paddingHorizontal: 10,
                            paddingVertical: 5,
                            borderRadius: 6,
                            borderWidth: 1,
                            borderColor: t.lineGreen,
                          }}
                        >
                          <Text style={[type.label, { color: t.green }]}>COPY</Text>
                        </Pressable>
                      )}
                    </Pressable>
                  );
                })}
              </Card>
            </View>
          ))}

          <Card>
            <Label>Why the last tap is yours</Label>
            <Body small muted>
              No sportsbook lets a third party place a wager on your account, and we would not want
              that key anyway. What this screen removes is the retyping: the legs, the prices and
              the order are already here.
            </Body>
            <Pill text="Units, not dollars" tone="good" />
          </Card>
        </>
      )}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={{ minWidth: 72 }}>
      <Text style={[type.label, { color: t.mute }]}>{label}</Text>
      <Text style={[type.h2, { color: t.green, fontSize: 22 }]}>{value}</Text>
    </View>
  );
}
function Btn({
  label,
  onPress,
  primary,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 6,
        backgroundColor: primary ? t.green : t.surface2,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Text style={[type.label, { color: primary ? t.onGreen : t.ink, letterSpacing: 1 }]}>
        {label.toUpperCase()}
      </Text>
    </Pressable>
  );
}
