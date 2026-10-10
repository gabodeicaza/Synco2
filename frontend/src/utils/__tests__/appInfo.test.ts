jest.mock('@/src/httpClient', () => ({ BACKEND_URL: 'https://apm-app.mx' }));
jest.mock('expo-constants', () => ({ __esModule: true, default: {} }));

import { urlLegal, versionApp } from '../appInfo';

describe('appInfo', () => {
  it('arma las URLs legales sin dobles diagonales', () => {
    expect(urlLegal('privacidad')).toBe('https://apm-app.mx/api/privacidad');
    expect(urlLegal('terminos', 'https://x.mx/')).toBe('https://x.mx/api/terminos');
    expect(urlLegal('eliminar-cuenta')).toBe('https://apm-app.mx/api/eliminar-cuenta');
  });

  it('lee versión y compilación del binario', () => {
    expect(versionApp({ expoConfig: { version: '1.2.0' }, nativeBuildVersion: '42' })).toEqual({ version: '1.2.0', build: '42' });
  });

  it('cae al versionCode de Android o a un guion', () => {
    expect(versionApp({ expoConfig: { version: '1.0.0', android: { versionCode: 7 } } }).build).toBe('7');
    expect(versionApp({}).version).toBe('—');
  });
});
