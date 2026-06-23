import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors } from '../constants/theme';

interface Props {
  metering: number[];
  isActive: boolean;
  barCount?: number;
}

export function WaveformVisualizer({ metering, isActive, barCount = 40 }: Props) {
  const bars = Array.from({ length: barCount }, (_, i) => {
    const value = metering[metering.length - barCount + i] ?? -60;
    const normalized = Math.max(0, (value + 60) / 60);
    const height = Math.max(4, normalized * 80);
    return height;
  });

  return (
    <View style={styles.container}>
      {bars.map((height, i) => (
        <View
          key={i}
          style={[
            styles.bar,
            {
              height,
              backgroundColor: isActive ? colors.primary : colors.textMuted,
              opacity: isActive ? 0.6 + (height / 80) * 0.4 : 0.3,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: 80,
    gap: 2,
  },
  bar: {
    width: 3,
    borderRadius: 2,
  },
});
