import React from 'react';
import { Pressable, Text, StyleSheet, ActivityIndicator, View, PressableProps } from 'react-native';
import { colors, radius } from '@/src/theme';

interface Props extends Omit<PressableProps, 'children'> {
  label: string;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'ghost' | 'ai' | 'danger';
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

export function Button({ label, loading, variant = 'primary', icon, fullWidth, disabled, style, ...rest }: Props) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      {...rest}
      disabled={isDisabled}
      style={({ pressed }) => [
        styles.base,
        variants[variant].btn,
        fullWidth && { alignSelf: 'stretch' },
        pressed && !isDisabled && { transform: [{ scale: 0.98 }], opacity: 0.95 },
        isDisabled && { opacity: 0.55 },
        style as any,
      ]}
    >
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator size="small" color={variants[variant].text.color} />
        ) : (
          <>
            {icon}
            <Text style={[styles.label, variants[variant].text]} numberOfLines={1}>{label}</Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 48,
    borderRadius: radius.md,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { fontSize: 15, fontWeight: '700' },
});

const variants = {
  primary: { btn: { backgroundColor: colors.primary }, text: { color: colors.textInverse } },
  secondary: {
    btn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong },
    text: { color: colors.text },
  },
  ghost: { btn: { backgroundColor: 'transparent' }, text: { color: colors.primary } },
  ai: { btn: { backgroundColor: '#0F172A' }, text: { color: colors.textInverse } },
  danger: { btn: { backgroundColor: colors.error }, text: { color: colors.textInverse } },
} as const;
