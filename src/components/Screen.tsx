import React, { useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { space, type, useTheme } from '@/theme';
import { useBoard } from '@/lib/store';
import { ago } from '@/lib/format';

export function Screen({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { loading, refreshBoard, board, source, error } = useBoard();
  // Relative times are rendered after mount so static web output matches the client.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <ScrollView
      style={{ backgroundColor: t.bg }}
      contentContainerStyle={{
        paddingHorizontal: space.lg,
        paddingTop: insets.top + space.md,
        paddingBottom: space.xxl + insets.bottom,
      }}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={refreshBoard} tintColor={t.turf} />
      }
    >
      <Text style={[type.label, { color: t.turf }]}>Cappers & Code · Week {board.week}</Text>
      <Text style={[type.display, { color: t.ink, marginTop: 4 }]}>{title}</Text>
      {!!subtitle && <Text style={[type.small, { color: t.ink2, marginTop: 4 }]}>{subtitle}</Text>}
      <Text style={[type.small, { color: t.mute, marginTop: 4 }]}>
        Board {ago(board.generatedAt)} ({source}) · prices{' '}
        {board.oddsFetchedAt ? ago(board.oddsFetchedAt) : 'research only'} · injuries{' '}
        {ago(board.injuriesFetchedAt)}
      </Text>
      {!!error && <Text style={[type.small, { color: t.down, marginTop: 4 }]}>{error}</Text>}
      <View style={{ marginTop: space.lg }}>{children}</View>
    </ScrollView>
  );
}
