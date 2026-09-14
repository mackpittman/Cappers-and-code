import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
// Per-weight imports: the package index re-exports every weight, which drags all 36 .ttf files
// into the web bundle. These paths pull only the six faces the theme uses.
import { BarlowCondensed_600SemiBold } from '@expo-google-fonts/barlow-condensed/600SemiBold';
import { BarlowCondensed_700Bold } from '@expo-google-fonts/barlow-condensed/700Bold';
import { Manrope_500Medium } from '@expo-google-fonts/manrope/500Medium';
import { Manrope_700Bold } from '@expo-google-fonts/manrope/700Bold';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono/700Bold';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BoardProvider } from '@/lib/store';
import { SlipProvider } from '@/lib/slip';
import { palette, fonts } from '@/theme';

SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout() {
  const [loaded] = useFonts({
    BarlowCondensed_600SemiBold,
    BarlowCondensed_700Bold,
    Manrope_500Medium,
    Manrope_700Bold,
    JetBrainsMono_500Medium,
    JetBrainsMono_700Bold,
  });
  useEffect(() => {
    if (loaded) SplashScreen.hideAsync().catch(() => {});
  }, [loaded]);
  if (!loaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: palette.bg }}>
      <SafeAreaProvider>
        <BoardProvider>
          <SlipProvider>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: palette.surface },
                headerTintColor: palette.ink,
                headerTitleStyle: { fontFamily: fonts.display, fontSize: 20 },
                headerShadowVisible: false,
                contentStyle: { backgroundColor: palette.bg },
              }}
            >
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="game/[id]" options={{ title: 'Game' }} />
              <Stack.Screen name="results" options={{ title: 'Results' }} />
              <Stack.Screen name="send" options={{ title: 'Send to book' }} />
              <Stack.Screen name="s/[id]" options={{ title: 'Shared slip' }} />
              <Stack.Screen name="discord" options={{ title: 'The Discord' }} />
              <Stack.Screen name="join" options={{ title: 'Join the Discord' }} />
            </Stack>
          </SlipProvider>
        </BoardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
