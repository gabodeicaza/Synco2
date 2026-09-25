import React from 'react';
import { StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { colors } from '@/src/theme';
import { AccesoPredioManager } from '@/src/components/AccesoPredioManager';
import { ScreenHeader } from '@/src/components/ScreenHeader';

export default function AccesoPredioScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const pid = id as string;

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader
        title="Acceso al Predio"
        fallbackHref={{ pathname: '/(coord)/projects/[id]', params: { id: pid } }}
      />
      <AccesoPredioManager projectId={pid} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
});
