import React from 'react';
import { View, ActivityIndicator, StyleSheet, Image } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '@/src/auth-context';
import { homeRouteForRole } from '@/src/utils/roles';
import { colors } from '@/src/theme';

export default function Index() {
  const { user, loading } = useAuth();
  console.log('[Index] rendering, auth state:', { user: !!user, loading });

  if (loading) {
    return (
      <View style={styles.container}>
        <Image source={require('../assets/images/dirac-logo.png')} style={styles.logo} resizeMode="contain" />
        <ActivityIndicator color={colors.primary} size="large" style={{ marginTop: 24 }} />
      </View>
    );
  }

  if (!user) return <Redirect href="/(auth)/login" />;
  return <Redirect href={homeRouteForRole(user.role) as any} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: 140, height: 140 },
});
