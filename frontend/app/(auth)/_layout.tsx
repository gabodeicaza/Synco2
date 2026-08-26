import React from 'react';
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F8FAFC' } }}>
      <Stack.Screen name="login" />
      <Stack.Screen name="redeem" />
      <Stack.Screen name="invite/[token]" />
    </Stack>
  );
}
