// Play-sheet graphics: the cards posted to Discord, served from the public site under /sheets.
// The list lives in /sheets/index.json so a new sheet is one JSON edit plus the PNGs, no app build.
import React, { useEffect, useState } from 'react';
import { Image, Linking, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Body, Card, H2, Label } from '@/components/ui';
import { SITE_URL } from '@/lib/site';
import { space, type, useTheme } from '@/theme';

type SheetImage = { title: string; file: string; h?: number };
type Sheet = {
  id: string;
  week?: number;
  season?: number;
  title: string;
  subtitle?: string;
  postedAt: string;
  featured?: boolean;
  images: SheetImage[];
};

const url = (file: string) => `${SITE_URL}/sheets/${file}`;

/** Shared fetch: the index is small, cached for five minutes, and every sheet view reads it. */
function useSheets() {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${SITE_URL}/sheets/index.json?t=${Math.floor(Date.now() / 300000)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => live && setSheets(j?.sheets ?? []))
      .catch(() => live && setSheets([]));
    return () => {
      live = false;
    };
  }, []);
  return sheets;
}

/**
 * The one sheet that leads the Edge tab. A play sheet is tall by design, so the front page shows
 * the top of it at a readable width and sends anyone who wants the rest to the full image: the
 * headline and the first section are what decide whether you open it. Which sheet appears here is
 * a flag in the index, not a build, so featuring tonight's game is a data change.
 */
export function FeaturedSheet({ week }: { week?: number }) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const sheets = useSheets();
  if (!sheets?.length) return null;
  const inWeek = sheets.filter((s) => week == null || s.week === week);
  const sheet = inWeek.find((s) => s.featured) ?? sheets.find((s) => s.featured);
  if (!sheet?.images?.length) return null;
  const img = sheet.images[0];
  const w = Math.min(width - 2 * space.md, 1200);
  const full = (w * (img.h ?? 1150)) / 1200;
  // Show the masthead and the first block, never less than a readable slab of the card.
  const preview = Math.min(full, Math.max(320, Math.round(w * 0.95)));
  return (
    <Pressable onPress={() => Linking.openURL(url(img.file))} accessibilityRole="button">
      <Card accent="green">
        <Label color={t.green}>Tonight&rsquo;s sheet</Label>
        <Text style={[type.h2, { color: t.ink, marginBottom: 4 }]}>{sheet.title}</Text>
        {!!sheet.subtitle && (
          <Body small muted>
            {sheet.subtitle}
          </Body>
        )}
        <View
          style={{
            height: preview,
            overflow: 'hidden',
            borderRadius: 10,
            marginTop: space.sm,
            backgroundColor: t.surface2,
          }}
        >
          <Image
            source={{ uri: url(img.file) }}
            accessibilityLabel={img.title}
            resizeMode="cover"
            style={{ width: w, height: full }}
          />
        </View>
        <View style={{ height: space.sm }} />
        <Label color={t.green}>
          {full > preview ? 'Tap to open the full sheet' : 'Tap to open full size'}
        </Label>
      </Card>
    </Pressable>
  );
}

/**
 * `week` shows only that week's sheets (the front page passes the board's week); `archive` shows
 * every week that is not the current one, grouped and labeled, for the Archive screen.
 */
export function PlaySheets({
  week,
  archive,
  currentWeek,
}: {
  week?: number;
  archive?: boolean;
  currentWeek?: number;
}) {
  const t = useTheme();
  const { width } = useWindowDimensions();
  const sheets = useSheets();
  const [open, setOpen] = useState<string | null>(null);
  const list = (sheets ?? []).filter((s) =>
    archive ? s.week != null && s.week !== currentWeek : week == null || s.week === week,
  );
  if (!list.length) return null;
  const latest = list[0];
  const shown = open ?? latest.id;
  const sheet = list.find((s) => s.id === shown) ?? latest;
  // Cards are rendered at 1200x1150; keep the aspect ratio inside the screen's content width.
  const w = Math.min(width - 2 * space.md, 1200);
  return (
    <>
      <H2>{archive ? 'Archived play sheets' : 'Play sheets'}</H2>
      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: space.sm }}>
        {list.map((s) => (
          <Pressable
            key={s.id}
            onPress={() => setOpen(s.id)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: t.green,
              backgroundColor: s.id === shown ? t.green : 'transparent',
            }}
          >
            <Text style={[type.label, { color: s.id === shown ? t.onGreen : t.green }]}>
              {(s.week != null && archive ? `WK ${s.week} · ` : '') + s.title.toUpperCase()}
            </Text>
          </Pressable>
        ))}
      </View>
      <Card>
        <Label>{sheet.title}</Label>
        {!!sheet.subtitle && (
          <Body small muted>
            {sheet.subtitle}
          </Body>
        )}
      </Card>
      {sheet.images.map((img) => (
        <Pressable key={img.file} onPress={() => Linking.openURL(url(img.file))}>
          <Image
            source={{ uri: url(img.file) }}
            accessibilityLabel={img.title}
            resizeMode="contain"
            style={{
              width: w,
              height: (w * (img.h ?? 1150)) / 1200,
              borderRadius: 10,
              marginBottom: space.sm,
              backgroundColor: t.surface2,
            }}
          />
        </Pressable>
      ))}
      <Body small muted>
        Same cards the bot posts to #nfl-sunday-board. Tap one to open it full size.
      </Body>
    </>
  );
}
