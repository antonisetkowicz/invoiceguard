import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiGet, apiPost } from '../../src/config/api';
import { colors, spacing, fontSize } from '../../src/constants/theme';

interface Match {
  id: string;
  payment_status: string;
  unlocked_at: string | null;
  created_at: string;
  user1: { id: string; username: string | null; avatar_url: string | null };
  user2: { id: string; username: string | null; avatar_url: string | null };
}

export default function MatchesScreen() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<string | null>(null);

  const fetchMatches = useCallback(async () => {
    try {
      const data = await apiGet<{ matches: Match[] }>('/api/matches');
      setMatches(data.matches);
    } catch {
      // silently handle
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMatches();
  }, [fetchMatches]);

  async function handleUnlock(matchId: string) {
    setPaying(matchId);
    try {
      const { clientSecret } = await apiPost<{ clientSecret: string }>(
        `/api/matches/${matchId}/pay`
      );
      Alert.alert(
        'Payment',
        'In production, this opens the Stripe payment sheet. ' +
        `Payment intent created: ${clientSecret.slice(0, 20)}...`,
        [{ text: 'OK', onPress: fetchMatches }]
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Payment failed';
      Alert.alert('Error', message);
    } finally {
      setPaying(null);
    }
  }

  function renderMatch({ item }: { item: Match }) {
    const isUnlocked = item.payment_status === 'paid';

    return (
      <View style={[styles.card, isUnlocked && styles.cardUnlocked]}>
        <View style={styles.cardHeader}>
          <View style={[styles.avatar, isUnlocked && styles.avatarUnlocked]}>
            <Ionicons
              name={isUnlocked ? 'person' : 'lock-closed'}
              size={24}
              color={isUnlocked ? colors.success : colors.textMuted}
            />
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.matchTitle}>
              {isUnlocked ? (item.user1.username || item.user2.username || 'Revealed User') : 'Mystery Match'}
            </Text>
            <Text style={styles.matchSubtitle}>
              {isUnlocked
                ? `Unlocked ${getTimeAgo(item.unlocked_at!)}`
                : 'Both of you want to connect'}
            </Text>
          </View>
        </View>

        {!isUnlocked && (
          <TouchableOpacity
            style={[styles.unlockButton, paying === item.id && styles.unlockButtonDisabled]}
            onPress={() => handleUnlock(item.id)}
            disabled={paying === item.id}
          >
            <Ionicons name="lock-open" size={18} color={colors.text} />
            <Text style={styles.unlockText}>
              {paying === item.id ? 'Processing...' : 'Unlock for $2.99'}
            </Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Matches</Text>

      {matches.length === 0 && !loading ? (
        <View style={styles.empty}>
          <Ionicons name="heart-outline" size={64} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No matches yet</Text>
          <Text style={styles.emptySubtitle}>
            When you and a stranger both tap "Reveal" on the same voice note, you'll match here.
          </Text>
        </View>
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(item) => item.id}
          renderItem={renderMatch}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={fetchMatches}
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
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardUnlocked: {
    borderWidth: 1,
    borderColor: colors.success,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarUnlocked: {
    backgroundColor: 'rgba(74, 222, 128, 0.15)',
  },
  cardInfo: {
    flex: 1,
    gap: 2,
  },
  matchTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
  },
  matchSubtitle: {
    fontSize: fontSize.md,
    color: colors.textSecondary,
  },
  unlockButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accent,
    paddingVertical: spacing.md,
    borderRadius: 14,
  },
  unlockButtonDisabled: {
    opacity: 0.5,
  },
  unlockText: {
    color: colors.text,
    fontSize: fontSize.lg,
    fontWeight: '700',
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
    maxWidth: 280,
  },
});
