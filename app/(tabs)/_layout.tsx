import React from 'react';
import { Tabs } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { fonts, palette } from '@/theme';

export default function TabLayout() {
  const icon =
    (name: React.ComponentProps<typeof Ionicons>['name']) =>
    ({ color }: { color: import('react-native').ColorValue }) => (
      <Ionicons name={name} size={22} color={color as string} />
    );
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.green,
        tabBarInactiveTintColor: palette.mute,
        tabBarStyle: { backgroundColor: palette.surface, borderTopColor: palette.line },
        tabBarLabelStyle: {
          fontFamily: fonts.displayMed,
          fontSize: 12,
          letterSpacing: 0.8,
          textTransform: 'uppercase',
        },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Edge', tabBarIcon: icon('flash-outline') }} />
      <Tabs.Screen
        name="games"
        options={{ title: 'Games', tabBarIcon: icon('american-football-outline') }}
      />
      <Tabs.Screen
        name="parlays"
        options={{ title: 'Parlays', tabBarIcon: icon('git-merge-outline') }}
      />
      <Tabs.Screen
        name="feed"
        options={{ title: 'Feed', tabBarIcon: icon('chatbubbles-outline') }}
      />
      <Tabs.Screen
        name="stacks"
        options={{ title: 'Stacks', tabBarIcon: icon('layers-outline') }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: icon('settings-outline') }}
      />
    </Tabs>
  );
}
