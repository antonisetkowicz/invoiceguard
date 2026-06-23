import React, { useState, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, fontSize } from '../constants/theme';

interface Props {
  audioUrl: string;
  duration: number;
  onPlayComplete?: () => void;
}

export function VoiceNotePlayer({ audioUrl, duration, onPlayComplete }: Props) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const soundRef = useRef<Audio.Sound | null>(null);

  async function togglePlay() {
    if (isPlaying && soundRef.current) {
      await soundRef.current.pauseAsync();
      setIsPlaying(false);
      return;
    }

    if (soundRef.current) {
      await soundRef.current.playAsync();
      setIsPlaying(true);
      return;
    }

    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri: audioUrl },
        { shouldPlay: true },
        (status) => {
          if (!status.isLoaded) return;
          if (status.durationMillis) {
            setProgress(status.positionMillis / status.durationMillis);
          }
          if (status.didJustFinish) {
            setIsPlaying(false);
            setProgress(0);
            soundRef.current?.unloadAsync();
            soundRef.current = null;
            onPlayComplete?.();
          }
        }
      );
      soundRef.current = sound;
      setIsPlaying(true);
    } catch {
      setIsPlaying(false);
    }
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={togglePlay} style={styles.playButton}>
        <Ionicons
          name={isPlaying ? 'pause' : 'play'}
          size={24}
          color={colors.text}
        />
      </TouchableOpacity>

      <View style={styles.progressContainer}>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
        </View>
        <Text style={styles.duration}>{duration}s</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceLight,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.md,
  },
  playButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressContainer: {
    flex: 1,
    gap: spacing.xs,
  },
  progressTrack: {
    height: 4,
    backgroundColor: colors.border,
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.primary,
    borderRadius: 2,
  },
  duration: {
    color: colors.textSecondary,
    fontSize: fontSize.sm,
  },
});
