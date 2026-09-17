// Play-sheet graphics: the cards posted to Discord, served from the public site under /sheets.
// The list lives in /sheets/index.json so a new sheet is one JSON edit plus the PNGs, no app build.
import React, { useEffect, useState } from 'react';
import { Image, Linking, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { Body, Card, H2, Label } from '@/components/ui';
import { SITE_URL } from '@/lib/site';
import { space, type, useTheme } from '@/theme';

type SheetImage = { title: string; file: string };
type Sheet = {
  id: string;
  week?: number;
  season?: number;
  title: string;
  subtitle?: string;
  postedAt: string;
  images: SheetImage[];
};

const url = (file: string) => `${SITE_URL}/sheets/${file}`;

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
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
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
              height: (w * 1150) / 1200,
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
