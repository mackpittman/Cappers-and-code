// The Games tab is a stack: the slate list, then one game. Keeping the game page inside the tab
// navigator (rather than on the root stack) is what keeps the bottom bar on screen while a member
// reads a game, scrolls it, and adds picks to the slip from it.
import React from 'react';
import { Stack } from 'expo-router';
import { fonts, palette } from '@/theme';

// Cold loads of /games/<id> (a shared link, a reload, the 404 bounce) mount the slate beneath the game.
export const unstable_settings = { initialRouteName: 'index' };

export default function GamesLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: palette.surface },
        headerTintColor: palette.ink,
        headerTitleStyle: { fontFamily: fonts.display, fontSize: 20 },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: palette.bg },
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="[id]" options={{ title: 'Game' }} />
    </Stack>
  );
}
