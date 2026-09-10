import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { space, type, useTheme } from '@/theme';
import { fmtAmerican, pct } from '@/lib/odds';
import type { InjuryEntry, Pick } from '@/lib/types';

export function Label({ children, color }: { children: React.ReactNode; color?: string }) {
  const t = useTheme();
  return <Text style={[type.label, { color: color ?? t.mute }]}>{children}</Text>;
}
export function H1({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  return <Text style={[type.h1, { color: t.ink }]}>{children}</Text>;
}
export function H2({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return (
    <Text
      style={[type.h2, { color: t.ink, marginTop: space.xl, marginBottom: space.sm }, style as any]}
    >
      {children}
    </Text>
  );
}
export function Body({
  children,
  muted,
  small,
}: {
  children: React.ReactNode;
  muted?: boolean;
  small?: boolean;
}) {
  const t = useTheme();
  return (
    <Text style={[small ? type.small : type.body, { color: muted ? t.ink2 : t.ink }]}>
      {children}
    </Text>
  );
}
export function Card({
  children,
  style,
  accent,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  accent?: 'gold' | 'turf';
}) {
  const t = useTheme();
  return (
    <View
      style={[
        s.card,
        { backgroundColor: t.surface, borderColor: t.line },
        accent === 'gold' && { borderLeftColor: t.gold, borderLeftWidth: 3 },
        accent === 'turf' && { borderLeftColor: t.turf, borderLeftWidth: 3 },
        style,
      ]}
    >
      {children}
    </View>
  );
}
export function Pill({
  text,
  tone = 'neutral',
}: {
  text: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent';
}) {
  const t = useTheme();
  const bg = {
    neutral: t.surface2,
    good: t.turfSoft,
    warn: t.goldSoft,
    bad: '#F3DCD8',
    accent: t.turf,
  }[tone];
  const fg = { neutral: t.ink2, good: t.turf, warn: t.gold, bad: '#8C2E1F', accent: t.onAccent }[
    tone
  ];
  return (
    <View style={[s.pill, { backgroundColor: bg }]}>
      <Text style={[type.small, { color: fg, fontWeight: '700' }]}>{text}</Text>
    </View>
  );
}
/** Two-team win probability bar. */
export function WinBar({
  away,
  home,
  pa,
  ph,
  live,
}: {
  away: string;
  home: string;
  pa: number;
  ph: number;
  live?: boolean;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <View style={s.row}>
        <Text style={[type.small, { color: t.ink, fontWeight: '700' }]}>
          {away} {pct(pa)}
        </Text>
        <Text style={[type.small, { color: t.mute }]}>{live ? 'live' : 'research'}</Text>
        <Text style={[type.small, { color: t.ink, fontWeight: '700' }]}>
          {home} {pct(ph)}
        </Text>
      </View>
      <View style={[s.bar, { backgroundColor: t.barBg }]}>
        <View
          style={{ width: `${Math.round(pa * 100)}%`, backgroundColor: t.bar, height: '100%' }}
        />
      </View>
    </View>
  );
}
/** Price cell: shows live consensus/best when available, otherwise the research price. */
export function Price({ p }: { p: Pick }) {
  const t = useTheme();
  const live = p.live;
  if (live) {
    const move = live.move ?? 0;
    return (
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={[type.mono, { color: t.ink, fontWeight: '700', fontSize: 16 }]}>
          {fmtAmerican(live.consensus)}
        </Text>
        <Text style={[type.small, { color: t.mute }]}>
          best {fmtAmerican(live.best)}
          {live.bestBook ? ` · ${live.bestBook}` : ''}
        </Text>
        {move !== 0 && live.open != null && (
          <Text style={[type.small, { color: move > 0 ? t.up : t.down }]}>
            {move > 0 ? '▲' : '▼'} {Math.abs(move)} since open
          </Text>
        )}
      </View>
    );
  }
  return (
    <View style={{ alignItems: 'flex-end' }}>
      <Text style={[type.mono, { color: t.ink, fontWeight: '700', fontSize: 16 }]}>
        {fmtAmerican(p.price)}
      </Text>
      <Text style={[type.small, { color: t.mute }]}>{p.priceNote ?? 'research'}</Text>
    </View>
  );
}
export function EdgeChip({ p }: { p: Pick }) {
  const edge = p.edge ?? (p.implied != null ? p.est - p.implied : null);
  if (edge == null) return <Pill text={`est ${pct(p.est)}`} />;
  const e = Math.round(edge * 100);
  return (
    <Pill
      text={`est ${pct(p.est)} · ${e >= 0 ? '+' : ''}${e} edge`}
      tone={e >= 5 ? 'good' : e <= -3 ? 'warn' : 'neutral'}
    />
  );
}
export function PlayerRow({
  p,
  rank,
  game,
  onPress,
}: {
  p: Pick;
  rank?: number;
  game?: string;
  onPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.prow, { borderColor: t.line, opacity: pressed ? 0.7 : 1 }]}
    >
      {rank != null && <Text style={[type.mono, { color: t.mute, width: 24 }]}>{rank}</Text>}
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={[type.body, { color: t.ink, fontWeight: '700' }]}>{p.name}</Text>
        <Text style={[type.small, { color: t.ink2 }]}>
          {p.team} · {p.pos}
          {game ? ` · ${game}` : ''}
        </Text>
        <EdgeChip p={p} />
      </View>
      <Price p={p} />
    </Pressable>
  );
}
export function PickCard({ p, rank }: { p: Pick; rank: number }) {
  const t = useTheme();
  return (
    <Card accent={rank === 1 ? 'turf' : undefined}>
      <View style={[s.row, { alignItems: 'flex-start' }]}>
        <View style={{ flex: 1, gap: 4 }}>
          <Label>{rank === 1 ? 'Top play' : `Pick ${rank}`}</Label>
          <Text style={[type.h2, { color: t.ink }]}>{p.name}</Text>
          <Text style={[type.small, { color: t.ink2 }]}>
            {p.team} · {p.pos}
          </Text>
        </View>
        <Price p={p} />
      </View>
      <View style={{ marginTop: space.sm }}>
        <EdgeChip p={p} />
      </View>
      <Text style={[type.body, { color: t.ink2, marginTop: space.sm }]}>{p.why}</Text>
    </Card>
  );
}
export function StackCard({ legs, why, kind }: { legs: string[]; why: string; kind?: string }) {
  const t = useTheme();
  return (
    <Card accent={kind === 'contrarian' ? 'gold' : undefined}>
      <View style={{ gap: 6 }}>
        {legs.map((l, i) => (
          <View key={i} style={s.row}>
            <View style={[s.dot, { backgroundColor: t.turf }]} />
            <Text style={[type.body, { color: t.ink, fontWeight: '600', flex: 1 }]}>{l}</Text>
          </View>
        ))}
      </View>
      <Text style={[type.small, { color: t.ink2, marginTop: space.sm }]}>{why}</Text>
    </Card>
  );
}
export function InjuryList({ items, team }: { items: InjuryEntry[]; team: string }) {
  const t = useTheme();
  if (!items.length)
    return (
      <Body small muted>
        {team}: no Out / Doubtful / Questionable entries on the feed.
      </Body>
    );
  const tone = (st: string) =>
    st === 'Out' || st === 'Injured Reserve' || st === 'Suspension'
      ? 'bad'
      : st === 'Doubtful'
        ? 'warn'
        : st === 'Questionable'
          ? 'warn'
          : 'neutral';
  return (
    <View style={{ gap: 6 }}>
      {items.map((i, idx) => (
        <View key={idx} style={{ gap: 2 }}>
          <View style={[s.row, { justifyContent: 'flex-start', gap: 8 }]}>
            <Pill text={i.status} tone={tone(i.status)} />
            <Text style={[type.body, { color: t.ink, fontWeight: '600' }]}>{i.name}</Text>
            <Text style={[type.small, { color: t.mute }]}>{i.pos}</Text>
          </View>
          {!!i.detail && i.detail !== 'ir' && (
            <Text style={[type.small, { color: t.ink2 }]}>{i.detail}</Text>
          )}
        </View>
      ))}
    </View>
  );
}
/** Minimal markdown: paragraphs, **bold**, "- " bullets. */
export function Markdown({ text }: { text: string }) {
  const t = useTheme();
  const blocks = text.split(/\n\s*\n/);
  return (
    <View style={{ gap: 8 }}>
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <View key={i} style={{ gap: 4 }}>
              {lines.map((l, j) => (
                <View
                  key={j}
                  style={[s.row, { justifyContent: 'flex-start', alignItems: 'flex-start' }]}
                >
                  <Text style={[type.body, { color: t.mute }]}>•</Text>
                  <Text style={[type.body, { color: t.ink, flex: 1 }]}>
                    {rich(l.replace(/^\s*[-*]\s+/, ''), t.ink)}
                  </Text>
                </View>
              ))}
            </View>
          );
        }
        return (
          <Text key={i} style={[type.body, { color: t.ink }]}>
            {rich(lines.join(' '), t.ink)}
          </Text>
        );
      })}
    </View>
  );
}
function rich(s: string, color: string) {
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') ? (
      <Text key={i} style={{ fontWeight: '700', color }}>
        {p.slice(2, -2)}
      </Text>
    ) : (
      <Text key={i}>{p}</Text>
    ),
  );
}
export function Expandable({
  title,
  children,
  open = false,
}: {
  title: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  const t = useTheme();
  const [isOpen, setOpen] = useState(open);
  return (
    <View style={[s.expand, { borderColor: t.line, backgroundColor: t.surface }]}>
      <Pressable
        onPress={() => setOpen(!isOpen)}
        style={[s.row, { padding: space.md }]}
        accessibilityRole="button"
        accessibilityState={{ expanded: isOpen }}
      >
        <Text style={[type.h2, { color: t.ink }]}>{title}</Text>
        <Text style={[type.body, { color: t.mute }]}>{isOpen ? '−' : '+'}</Text>
      </Pressable>
      {isOpen && (
        <View style={{ paddingHorizontal: space.md, paddingBottom: space.md }}>{children}</View>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 8, padding: space.md, marginBottom: space.sm },
  pill: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  prow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  expand: { borderWidth: 1, borderRadius: 8, marginBottom: space.sm },
});
