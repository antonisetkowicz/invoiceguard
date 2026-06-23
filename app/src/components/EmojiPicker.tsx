import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { colors, spacing, fontSize } from '../constants/theme';

const EMOJI_GROUPS = [
  ['❤️', '🔥', '😂', '😍', '🥺', '😭', '🤯', '👏'],
  ['💀', '🙏', '💯', '✨', '🎵', '🫶', '🤝', '👀'],
  ['😊', '🥰', '😎', '🤔', '😴', '🫡', '💪', '🎉'],
];

interface Props {
  onSelect: (emoji: string) => void;
}

export function EmojiPicker({ onSelect }: Props) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {EMOJI_GROUPS.map((group, gi) => (
        <View key={gi} style={styles.row}>
          {group.map((emoji) => (
            <TouchableOpacity
              key={emoji}
              style={styles.emojiButton}
              onPress={() => onSelect(emoji)}
              activeOpacity={0.6}
            >
              <Text style={styles.emoji}>{emoji}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    maxHeight: 200,
  },
  content: {
    padding: spacing.sm,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  emojiButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: {
    fontSize: fontSize.xl,
  },
});
