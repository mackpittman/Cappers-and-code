import React from 'react';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/theme';

export default function TabLayout() {
  const t = useTheme();
  const icon =
    (name: React.ComponentProps<typeof Ionicons>['name']) =>
    ({ color }: { color: string }) => <Ionicons name={name} size={22} color={color} />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.turf,
        tabBarInactiveTintColor: t.mute,
        tabBarStyle: { backgroundColor: t.surface, borderTopColor: t.line },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Board', tabBarIcon: icon('podium-outline') }} />
      <Tabs.Screen
        name="games"
        options={{ title: 'Games', tabBarIcon: icon('american-football-outline') }}
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
