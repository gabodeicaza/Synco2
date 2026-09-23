// Dirac v2.0 _ Toast minimo multiplataforma.
// Android tiene ToastAndroid nativo. En web Alert.alert no hace nada, asi que
// se pinta un aviso propio (no bloquea y se cierra solo). iOS no tiene
// equivalente en RN core: cae a un Alert sin botones extra.
import { Alert, Platform, ToastAndroid } from 'react-native';
import { colors } from '@/src/theme';

function toastWeb(message: string) {
  if (typeof document === 'undefined') return;
  const el = document.createElement('div');
  el.textContent = message;
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  Object.assign(el.style, {
    position: 'fixed', left: '50%', bottom: '32px', transform: 'translateX(-50%)',
    maxWidth: '90vw', padding: '12px 18px', borderRadius: '10px', zIndex: '99999',
    background: colors.text, color: colors.textInverse, fontSize: '14px', fontWeight: '600',
    fontFamily: 'system-ui, sans-serif', boxShadow: '0 6px 20px rgba(0,0,0,.25)',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

export function showToast(message: string) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
    return;
  }
  if (Platform.OS === 'web') {
    toastWeb(message);
    return;
  }
  Alert.alert(message);
}
