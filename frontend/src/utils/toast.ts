// Dirac v2.0 _ Toast minimo multiplataforma.
// Android tiene ToastAndroid nativo; iOS no tiene equivalente en RN core,
// asi que caemos a un Alert sin botones de confirmacion extra (se autocierra
// al tocar fuera). Evita traer una libreria externa solo para esto.
import { Alert, Platform, ToastAndroid } from 'react-native';

export function showToast(message: string) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(message, ToastAndroid.SHORT);
    return;
  }
  Alert.alert(message);
}
