// AsyncStorage no existe como módulo nativo en Jest: se usa el mock oficial en todas las
// pruebas. Una prueba que necesite otro comportamiento lo sobrescribe con su propio jest.mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
