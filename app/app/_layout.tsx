import React, { useEffect, useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from '../src/hooks/useAuth';
import { colors } from '../src/constants/theme';

export default function RootLayout() {
  const { session, loading, signInAnonymously } = useAuth();
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    async function init() {
      if (!loading && !session) {
        try {
          await signInAnonymously();
        } catch (err) {
          console.error('Anonymous auth failed:', err);
        }
      }
      if (!loading) setInitializing(false);
    }
    init();
  }, [loading, session]);

  if (initializing) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="(tabs)" />
      </Stack>
    </>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
