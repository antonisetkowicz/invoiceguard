import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { Ionicons } from '@expo/vector-icons';
import { useRecorder } from '../../src/hooks/useRecorder';
import { WaveformVisualizer } from '../../src/components/WaveformVisualizer';
import { apiUpload } from '../../src/config/api';
import { colors, spacing, fontSize } from '../../src/constants/theme';

export default function RecordScreen() {
  const {
    isRecording,
    duration,
    metering,
    uri,
    error,
    startRecording,
    stopRecording,
    reset,
  } = useRecorder();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handlePressIn() {
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    await startRecording();
  }

  async function handlePressOut() {
    if (isRecording) {
      await stopRecording();
    }
  }

  async function handleSend() {
    if (!uri || duration < 1) return;

    setSending(true);
    try {
      const formData = new FormData();
      formData.append('audio', {
        uri,
        name: 'voice-note.m4a',
        type: 'audio/mp4',
      } as unknown as Blob);
      formData.append('duration', String(duration));

      await apiUpload('/api/voice/upload', formData);
      setSent(true);
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err) {
      Alert.alert('Error', 'Failed to send voice note. Try again.');
    } finally {
      setSending(false);
    }
  }

  function handleReset() {
    reset();
    setSent(false);
  }

  if (sent) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.sentContainer}>
          <View style={styles.sentIcon}>
            <Ionicons name="paper-plane" size={48} color={colors.primary} />
          </View>
          <Text style={styles.sentTitle}>Sent!</Text>
          <Text style={styles.sentSubtitle}>
            Your voice is on its way to a stranger somewhere in the world.
          </Text>
          <TouchableOpacity style={styles.recordAgainButton} onPress={handleReset}>
            <Text style={styles.recordAgainText}>Record Another</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>VoxDrop</Text>
        <Text style={styles.subtitle}>Send your voice into the void</Text>
      </View>

      <View style={styles.waveformArea}>
        <WaveformVisualizer metering={metering} isActive={isRecording} />
        <Text style={styles.timer}>
          {isRecording ? `${duration}s / 30s` : uri ? `${duration}s recorded` : ''}
        </Text>
      </View>

      {error && <Text style={styles.error}>{error}</Text>}

      <View style={styles.controls}>
        {!uri ? (
          <>
            <Text style={styles.hint}>
              {isRecording ? 'Release to stop' : 'Hold to record'}
            </Text>
            <TouchableOpacity
              style={[styles.recordButton, isRecording && styles.recordButtonActive]}
              onPressIn={handlePressIn}
              onPressOut={handlePressOut}
              activeOpacity={0.8}
            >
              <View style={[styles.recordInner, isRecording && styles.recordInnerActive]}>
                {isRecording ? (
                  <View style={styles.stopIcon} />
                ) : (
                  <Ionicons name="mic" size={32} color={colors.text} />
                )}
              </View>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.postRecordControls}>
            <TouchableOpacity style={styles.discardButton} onPress={handleReset}>
              <Ionicons name="trash-outline" size={24} color={colors.textSecondary} />
              <Text style={styles.discardText}>Discard</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.sendButton, sending && styles.sendButtonDisabled]}
              onPress={handleSend}
              disabled={sending}
            >
              <Ionicons name="send" size={20} color={colors.text} />
              <Text style={styles.sendText}>
                {sending ? 'Sending...' : 'Send to Stranger'}
              </Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
  },
  header: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  title: {
    fontSize: fontSize.hero,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: -1,
  },
  subtitle: {
    fontSize: fontSize.lg,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  waveformArea: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timer: {
    fontSize: fontSize.xl,
    color: colors.text,
    marginTop: spacing.md,
    fontVariant: ['tabular-nums'],
  },
  error: {
    color: colors.primary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  hint: {
    color: colors.textMuted,
    fontSize: fontSize.md,
    textAlign: 'center',
    marginBottom: spacing.lg,
  },
  controls: {
    alignItems: 'center',
    paddingBottom: spacing.xl,
  },
  recordButton: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: colors.primary,
  },
  recordButtonActive: {
    borderColor: colors.warning,
    transform: [{ scale: 1.1 }],
  },
  recordInner: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordInnerActive: {
    backgroundColor: colors.warning,
    borderRadius: 12,
    width: 48,
    height: 48,
  },
  stopIcon: {
    width: 20,
    height: 20,
    backgroundColor: colors.bg,
    borderRadius: 3,
  },
  postRecordControls: {
    flexDirection: 'row',
    gap: spacing.lg,
    alignItems: 'center',
  },
  discardButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  discardText: {
    color: colors.textSecondary,
    fontSize: fontSize.lg,
  },
  sendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 28,
  },
  sendButtonDisabled: {
    opacity: 0.5,
  },
  sendText: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
  },
  sentContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  sentIcon: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  sentTitle: {
    fontSize: fontSize.hero,
    fontWeight: '800',
    color: colors.text,
  },
  sentSubtitle: {
    fontSize: fontSize.lg,
    color: colors.textSecondary,
    textAlign: 'center',
    maxWidth: 280,
  },
  recordAgainButton: {
    marginTop: spacing.xl,
    backgroundColor: colors.surface,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: colors.border,
  },
  recordAgainText: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '600',
  },
});
