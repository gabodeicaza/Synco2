// Cross-platform confirmation helper.
// On React Native Web, Alert.alert with multiple buttons is unreliable
// (only the first button renders and destructive callbacks never fire).
// This helper falls back to window.confirm() on web and uses native Alert on iOS/Android.
import { Alert, Platform } from 'react-native';

export interface ConfirmOptions {
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

export function confirm(
  title: string,
  message: string,
  options: ConfirmOptions = {},
): Promise<boolean> {
  const { confirmText = 'Confirmar', cancelText = 'Cancelar', destructive = false } = options;

  return new Promise((resolve) => {
    if (Platform.OS === 'web') {
      const text = message ? `${title}\n\n${message}` : title;
      // eslint-disable-next-line no-alert
      const ok = typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(text)
        : false;
      resolve(!!ok);
      return;
    }
    Alert.alert(
      title,
      message,
      [
        { text: cancelText, style: 'cancel', onPress: () => resolve(false) },
        {
          text: confirmText,
          style: destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/**
 * Simple cross-platform notify (single-button info). Works fine with Alert.alert
 * on every platform but keeps the call site explicit.
 */
export function notify(title: string, message?: string): void {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
    return;
  }
  Alert.alert(title, message);
}
