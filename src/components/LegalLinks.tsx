import React from 'react';
import { Linking, Pressable, Text, View } from 'react-native';
import { fonts, palette, space, type } from '@/theme';
import { LEGAL_PAGES, legalUrl } from '@/lib/site';

// Row of links to the legal pages on the public site. Used on the paywall and in Settings.
export function LegalLinks() {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm }}>
      {LEGAL_PAGES.map((p) => (
        <Pressable key={p.key} onPress={() => Linking.openURL(legalUrl(p.key))} hitSlop={6}>
          <Text
            style={[
              type.small,
              {
                color: palette.green,
                fontFamily: fonts.data,
                letterSpacing: 1,
                textTransform: 'uppercase',
              },
            ]}
          >
            {p.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
