jest.mock('@/src/httpClient', () => ({ BASE: 'https://apm-app.mx/api' }));
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { configure: jest.fn(), addEventListener: jest.fn(), refresh: jest.fn() },
}));

import NetInfo from '@react-native-community/netinfo';
import { configurarPing, estaEnLinea, respuestaHealthOk, urlPing } from '../connectivity';

const res = (status: number, cuerpo: any) => ({ status, json: async () => cuerpo });

describe('ping de conectividad', () => {
  it('sondea /api/health (no HEAD /)', () => {
    expect(urlPing()).toBe('https://apm-app.mx/api/health');
    configurarPing();
    const cfg = (NetInfo.configure as jest.Mock).mock.calls[0][0];
    expect(cfg.reachabilityUrl).toBe('https://apm-app.mx/api/health');
    expect(cfg.reachabilityMethod).toBe('GET');
    expect(cfg.useNativeReachability).toBe(false);
  });

  it('solo cuenta como éxito un 200 con ok=true', async () => {
    expect(await respuestaHealthOk(res(200, { ok: true }))).toBe(true);
    expect(await respuestaHealthOk(res(503, { ok: false }))).toBe(false);
    expect(await respuestaHealthOk(res(200, { ok: false }))).toBe(false);
    expect(await respuestaHealthOk({ status: 200, json: async () => { throw new Error('x'); } })).toBe(false);
  });

  it('estaEnLinea distingue sin red, servidor caído y en línea', () => {
    expect(estaEnLinea({ isConnected: false, isInternetReachable: null })).toBe(false);
    expect(estaEnLinea({ isConnected: true, isInternetReachable: false })).toBe(false);
    expect(estaEnLinea({ isConnected: true, isInternetReachable: null })).toBe(true);
    expect(estaEnLinea({ isConnected: true, isInternetReachable: true })).toBe(true);
  });
});
