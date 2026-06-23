import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { VoiceNotePlayer } from '../../src/components/VoiceNotePlayer';
import { EmojiPicker } from '../../src/components/EmojiPicker';
import { apiGet, apiPost } from '../../src/config/api';
import { colors, spacing, fontSize } from '../../src/constants/theme';

interface Delivery {
  id: string;
  delivered_at: string;
  listened_at: string | null;
  responded_at: string | null;
  response_emoji: string | null;
  response_text: string | null;
  voice_notes: {
    id: string;
    audio_url: string;
    duration_seconds: number;
    created_at: string;
  };
}

export default function InboxScreen() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingTo, setRespondingTo] = useState<string | null>(null);
  const [responseText, setResponseText] = useState('');
  const [showEmojis, setShowEmojis] = useState(true);

  const fetchInbox = useCallback(async () => {
    try {
      const data = await apiGet<{ deliveries: Delivery[] }>('/api/voice/inbox');
      setDeliveries(data.deliveries);
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInbox();
  }, [fetchInbox]);

  async function markListened(deliveryId: string) {
    await apiPost(`/api/voice/${deliveryId}/listened`).catch(() => {});
  }

  async function sendResponse(deliveryId: string, emoji?: string, text?: string) {
    try {
      await apiPost(`/api/voice/${deliveryId}/respond`, { emoji, text });
      setRespondingTo(null);
      setResponseText('');
      fetchInbox();
    } catch {
      Alert.alert('Error', 'Failed to send response');
    }
  }

  async function requestReveal(deliveryId: string) {
    try {
      const result = await apiPost<{ matched?: boolean }>(`/api/matches/${deliveryId}/reveal`);
      if (result.matched) {
        Alert.alert('It\'s a Match!', 'Both of you want to connect. Unlock to reveal identities.');
      } else {
        Alert.alert('Reveal Requested', 'If the other person also wants to reveal, you\'ll be matched!');
      }
    } catch {
      Alert.alert('Error', 'Failed to request reveal');
    }
  }

  function renderDelivery({ item }: { item: Delivery }) {
    const isResponding = respondingTo === item.id;
    const timeAgo = getTimeAgo(item.delivered_at);

    return (
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View style={styles.anonymousAvatar}>
            <Ionicons name="person" size={16} color={colors.textMuted} />
          </View>
          <Text style={styles.anonymousName}>Anonymous</Text>
          <Text style={styles.timeAgo}>{timeAgo}</Text>
          {!item.listened_at && <View style={styles.newBadge} />}
        </View>

        <VoiceNotePlayer
          audioUrl={item.voice_notes.audio_url}
          duration={item.voice_notes.duration_seconds}
          onPlayComplete={() => markListened(item.id)}
        />

        {item.responded_at ? (
          <View style={styles.responseDisplay}>
            <Text style={styles.responseLabel}>Your response:</Text>
            <Text style={styles.responseValue}>
              {item.response_emoji || item.response_text}
            </Text>
          </View>
        ) : isResponding ? (
          <View style={styles.responseArea}>
            <View style={styles.responseToggle}>
              <TouchableOpacity
                style={[styles.toggleButton, showEmojis && styles.toggleActive]}
                onPress={() => setShowEmojis(true)}
              >
                <Text style={styles.toggleText}>Emoji</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toggleButton, !showEmojis && styles.toggleActive]}
                onPress={() => setShowEmojis(false)}
              >
                <Text style={styles.toggleText}>Text</Text>
              </TouchableOpacity>
            </View>

            {showEmojis ? (
              <EmojiPicker onSelect={(emoji) => sendResponse(item.id, emoji)} />
            ) : (
              <View style={styles.textInputRow}>
                <TextInput
                  style={styles.textInput}
                  value={responseText}
                  onChangeText={(t) => setResponseText(t.slice(0, 40))}
                  placeholder="Max 40 characters..."
                  placeholderTextColor={colors.textMuted}
                  maxLength={40}
                />
                <TouchableOpacity
                  style={styles.textSendButton}
                  onPress={() => sendResponse(item.id, undefined, responseText)}
                  disabled={!responseText.trim()}
                >
                  <Ionicons name="send" size={18} color={colors.text} />
                </TouchableOpacity>
              </View>
            )}
          </View>
        ) : (
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.respondButton}
              onPress={() => setRespondingTo(item.id)}
            >
              <Ionicons name="chatbubble-outline" size={18} color={colors.primary} />
              <Text style={styles.respondText}>Respond</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.revealButton}
              onPress={() => requestReveal(item.id)}
            >
              <Ionicons name="eye-outline" size={18} color={colors.accent} />
              <Text style={styles.revealText}>Reveal</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Inbox</Text>

      {deliveries.length === 0 && !loading ? (
        <View style={styles.empty}>
          <Ionicons name="headset-outline" size={64} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No voice notes yet</Text>
          <Text style={styles.emptySubtitle}>
            Send a voice note first — the universe will send one back.
          </Text>
        </View>
      ) : (
        <FlatList
          data={deliveries}
          keyExtractor={(item) => item.id}
          renderItem={renderDelivery}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={fetchInbox}
              tintColor={colors.primary}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

function getTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.text,
    padding: spacing.lg,
  },
  list: {
    padding: spacing.md,
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.md,
    gap: spacing.md,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  anonymousAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  anonymousName: {
    color: colors.textSecondary,
    fontSize: fontSize.md,
    fontWeight: '600',
    flex: 1,
  },
  timeAgo: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  newBadge: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  respondButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  respondText: {
    color: colors.primary,
    fontWeight: '600',
  },
  revealButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  revealText: {
    color: colors.accent,
    fontWeight: '600',
  },
  responseArea: {
    gap: spacing.sm,
  },
  responseToggle: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toggleButton: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.surfaceLight,
  },
  toggleActive: {
    backgroundColor: colors.primary,
  },
  toggleText: {
    color: colors.text,
    fontSize: fontSize.sm,
    fontWeight: '600',
  },
  textInputRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  textInput: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    borderRadius: 12,
    padding: spacing.md,
    color: colors.text,
    fontSize: fontSize.md,
  },
  textSendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  responseDisplay: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  responseLabel: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  responseValue: {
    color: colors.text,
    fontSize: fontSize.lg,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    padding: spacing.xl,
  },
  emptyTitle: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
  },
  emptySubtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});
