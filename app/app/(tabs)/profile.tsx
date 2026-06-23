import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { apiGet, apiPost } from '../../src/config/api';
import { useAuth } from '../../src/hooks/useAuth';
import { colors, spacing, fontSize } from '../../src/constants/theme';

interface UserProfile {
  id: string;
  username: string | null;
  avatar_url: string | null;
  is_revealed: boolean;
  created_at: string;
}

export default function ProfileScreen() {
  const { session } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [username, setUsername] = useState('');
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchProfile();
  }, []);

  async function fetchProfile() {
    try {
      const data = await apiGet<{ user: UserProfile }>('/api/auth/me');
      setProfile(data.user);
      setUsername(data.user.username || '');
    } catch {
      // silently handle
    }
  }

  async function saveProfile() {
    setSaving(true);
    try {
      await apiPost('/api/auth/profile', { username });
      setEditing(false);
      fetchProfile();
    } catch {
      Alert.alert('Error', 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>Profile</Text>

      <View style={styles.card}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}>
            <Ionicons name="person" size={40} color={colors.textMuted} />
          </View>
          {profile?.is_revealed && (
            <View style={styles.revealedBadge}>
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            </View>
          )}
        </View>

        <View style={styles.info}>
          {editing ? (
            <View style={styles.editRow}>
              <TextInput
                style={styles.input}
                value={username}
                onChangeText={setUsername}
                placeholder="Choose a username"
                placeholderTextColor={colors.textMuted}
                maxLength={24}
                autoFocus
              />
              <TouchableOpacity
                style={styles.saveButton}
                onPress={saveProfile}
                disabled={saving}
              >
                <Text style={styles.saveText}>{saving ? '...' : 'Save'}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={() => setEditing(true)} style={styles.usernameRow}>
              <Text style={styles.username}>
                {profile?.username || 'Anonymous'}
              </Text>
              <Ionicons name="pencil" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          )}
          <Text style={styles.userId}>
            ID: {profile?.id?.slice(0, 8) || '...'}
          </Text>
        </View>
      </View>

      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <Ionicons name="shield-checkmark" size={24} color={colors.primary} />
          <Text style={styles.statLabel}>Status</Text>
          <Text style={styles.statValue}>
            {profile?.is_revealed ? 'Revealed' : 'Anonymous'}
          </Text>
        </View>
        <View style={styles.statCard}>
          <Ionicons name="calendar" size={24} color={colors.accent} />
          <Text style={styles.statLabel}>Joined</Text>
          <Text style={styles.statValue}>
            {profile?.created_at
              ? new Date(profile.created_at).toLocaleDateString()
              : '...'}
          </Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>How it works</Text>
        <View style={styles.stepList}>
          <Step num="1" text="Record a 30-second voice note" />
          <Step num="2" text="It gets delivered to one random stranger" />
          <Step num="3" text="They respond with an emoji or short message" />
          <Step num="4" text="If you both tap Reveal, pay to unlock identities" />
        </View>
      </View>

      <Text style={styles.version}>VoxDrop v1.0.0</Text>
    </SafeAreaView>
  );
}

function Step({ num, text }: { num: string; text: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepNum}>
        <Text style={styles.stepNumText}>{num}</Text>
      </View>
      <Text style={styles.stepText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    padding: spacing.lg,
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: '800',
    color: colors.text,
    marginBottom: spacing.lg,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: spacing.lg,
  },
  avatarContainer: {
    position: 'relative',
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surfaceLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  revealedBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 2,
  },
  info: {
    flex: 1,
    gap: spacing.xs,
  },
  usernameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  username: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.text,
  },
  userId: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontFamily: 'monospace',
  },
  editRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  input: {
    flex: 1,
    backgroundColor: colors.surfaceLight,
    borderRadius: 8,
    padding: spacing.sm,
    color: colors.text,
    fontSize: fontSize.lg,
  },
  saveButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: 8,
  },
  saveText: {
    color: colors.text,
    fontWeight: '700',
  },
  statsContainer: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  statLabel: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  statValue: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.text,
  },
  section: {
    marginTop: spacing.xl,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.text,
    marginBottom: spacing.md,
  },
  stepList: {
    gap: spacing.md,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  stepNum: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepNumText: {
    color: colors.text,
    fontWeight: '800',
    fontSize: fontSize.sm,
  },
  stepText: {
    flex: 1,
    color: colors.textSecondary,
    fontSize: fontSize.md,
  },
  version: {
    marginTop: 'auto',
    textAlign: 'center',
    color: colors.textMuted,
    fontSize: fontSize.sm,
    paddingBottom: spacing.md,
  },
});
