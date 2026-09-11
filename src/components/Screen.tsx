import React, { useEffect, useState } from 'react';
import { Image, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { copy, palette, space, type } from '@/theme';
import { useBoard } from '@/lib/store';
import { ago } from '@/lib/format';

const lockup = require('../../brand/logos/CC_PRIMARY_LOCKUP_TRANSPARENT.png');

export function Screen({
  title,
  subtitle,
  children,
  hero,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  hero?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { loading, refreshBoard, board, source, error } = useBoard();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <ScrollView
      style={{ backgroundColor: palette.bg }}
      contentContainerStyle={{
        paddingHorizontal: space.lg,
        paddingTop: insets.top + space.md,
        paddingBottom: space.xxl + insets.bottom,
      }}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={refreshBoard} tintColor={palette.green} />
      }
    >
      {hero ? (
        <View style={{ marginBottom: space.md }}>
          <Image
            source={lockup}
            style={{ width: 168, height: 70 }}
            resizeMode="contain"
            accessibilityLabel="Cappers & Code"
          />
          <Text style={[type.label, { color: palette.green, marginTop: 6 }]}>{copy.tagline}</Text>
        </View>
      ) : (
        <Text style={[type.label, { color: palette.green }]}>
          Cappers &amp; Code · Week {board.week}
        </Text>
      )}
      <Text style={[type.display, { color: palette.ink, marginTop: 6 }]}>{title}</Text>
      {!!subtitle && (
        <Text style={[type.small, { color: palette.ink2, marginTop: 6 }]}>{subtitle}</Text>
      )}
      {mounted && (
        <Text style={[type.label, { color: palette.mute, marginTop: 8, letterSpacing: 1 }]}>
          Board {ago(board.generatedAt)} ({source}) · prices{' '}
          {board.oddsFetchedAt ? ago(board.oddsFetchedAt) : 'research only'} · injuries{' '}
          {ago(board.injuriesFetchedAt)}
        </Text>
      )}
      {!!error && (
        <Text style={[type.small, { color: palette.danger, marginTop: 4 }]}>{error}</Text>
      )}
      <View style={{ marginTop: space.lg }}>{children}</View>
    </ScrollView>
  );
}
