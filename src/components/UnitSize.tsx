// Unit-size control. Sets what one unit is worth to this reader so every P&L on the page
// reads in their money. Units stay the source of truth; dollars are a view of them.
import React, { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { Body, Card, Label } from '@/components/ui';
import { UNIT_PRESETS, money, useUnitSize } from '@/lib/units';
import { fonts, radius, space, type, useTheme } from '@/theme';

export function UnitSizeCard({ note }: { note?: string }) {
  const t = useTheme();
  const [size, setSize] = useUnitSize();
  const [draft, setDraft] = useState(String(size));
  useEffect(() => {
    setDraft(size ? String(size) : '');
  }, [size]);

  const commit = (raw: string) => {
    const n = Number(raw.replace(/[^0-9.]/g, ''));
    setSize(Number.isFinite(n) && n > 0 ? n : 0);
  };

  return (
    <Card accent="green">
      <Label color={t.green}>Your unit size</Label>
      <Body small muted>
        {note ??
          'We post everything in units, not dollars. Set what one unit is worth to you and every number below converts.'}
      </Body>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: space.sm,
          marginTop: space.md,
        }}
      >
        {UNIT_PRESETS.map((p) => {
          const on = p === size;
          return (
            <Pressable
              key={p}
              onPress={() => setSize(p)}
              accessibilityRole="button"
              accessibilityLabel={`Set unit size to ${p} dollars`}
              accessibilityState={{ selected: on }}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 14,
                borderRadius: radius.sm,
                borderWidth: 1,
                borderColor: on ? t.green : t.line,
                backgroundColor: on ? t.green : t.surface2,
              }}
            >
              <Text
                style={[
                  type.bodyBold,
                  { color: on ? t.onGreen : t.ink2, fontFamily: fonts.dataBold },
                ]}
              >
                ${p}
              </Text>
            </Pressable>
          );
        })}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            borderRadius: radius.sm,
            borderWidth: 1,
            borderColor: t.line,
            backgroundColor: t.surface2,
            paddingHorizontal: 12,
          }}
        >
          <Text style={[type.bodyBold, { color: t.mute, fontFamily: fonts.dataBold }]}>$</Text>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            onEndEditing={(e) => commit(e.nativeEvent.text)}
            onSubmitEditing={(e) => commit(e.nativeEvent.text)}
            onBlur={() => commit(draft)}
            keyboardType="numeric"
            inputMode="decimal"
            placeholder="custom"
            placeholderTextColor={t.mute}
            accessibilityLabel="Custom unit size in dollars"
            style={[
              type.bodyBold,
              {
                color: t.ink,
                fontFamily: fonts.dataBold,
                minWidth: 74,
                paddingVertical: 8,
                paddingHorizontal: 4,
                outlineStyle: 'none',
              } as object,
            ]}
          />
        </View>
      </View>
      <Body small muted>
        {size > 0
          ? `1 unit = ${money(size)}. A 0.25u play risks ${money(size * 0.25)} and a +1400 winner at that stake returns ${money(size * 0.25 * 14)} profit.`
          : 'Enter a unit size to see dollars.'}
      </Body>
    </Card>
  );
}
