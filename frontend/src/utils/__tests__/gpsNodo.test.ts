import { errorGpsDe, formatoGps, gpsValido, puntoGpsDeCoords, puntoGpsDeNodo, urlMapas } from '../gpsNodo';

describe('gpsValido', () => {
  it('acepta los extremos y rechaza fuera de rango, no numéricos y no finitos', () => {
    expect(gpsValido(19.432608, -99.133209)).toBe(true);
    expect(gpsValido(-90, 180)).toBe(true);
    expect(gpsValido(90.0001, 0)).toBe(false);
    expect(gpsValido(0, -180.01)).toBe(false);
    expect(gpsValido(NaN, 0)).toBe(false);
    expect(gpsValido(0, Infinity)).toBe(false);
    expect(gpsValido('19', '-99')).toBe(false);
    expect(gpsValido(null, undefined)).toBe(false);
  });
});

describe('puntoGpsDeNodo', () => {
  it('devuelve el punto si hay ambos valores válidos', () => {
    expect(puntoGpsDeNodo({ gps_lat: 19.4, gps_lon: -99.1 })).toEqual({ lat: 19.4, lon: -99.1 });
  });

  it('nodo viejo, vacío o con un solo valor → null', () => {
    expect(puntoGpsDeNodo({})).toBeNull();
    expect(puntoGpsDeNodo(null)).toBeNull();
    expect(puntoGpsDeNodo({ gps_lat: 19.4, gps_lon: null })).toBeNull();
    expect(puntoGpsDeNodo({ gps_lat: 2_150_000, gps_lon: 480_000 })).toBeNull(); // UTM, no GPS
  });
});

describe('puntoGpsDeCoords', () => {
  it('lee latitude/longitude de expo-location', () => {
    expect(puntoGpsDeCoords({ latitude: 19.4, longitude: -99.1 })).toEqual({ lat: 19.4, lon: -99.1 });
    expect(puntoGpsDeCoords({ latitude: 19.4 })).toBeNull();
    expect(puntoGpsDeCoords(undefined)).toBeNull();
  });
});

describe('formato y enlace', () => {
  it('muestra 6 decimales', () => {
    expect(formatoGps({ lat: 19.4, lon: -99.1 })).toBe('19.400000, -99.100000');
    expect(formatoGps({ lat: 19.4326077, lon: -99.1332089 })).toBe('19.432608, -99.133209');
  });

  it('el enlace de mapas lleva latitud y longitud', () => {
    expect(urlMapas({ lat: 19.432608, lon: -99.133209 })).toBe(
      'https://www.google.com/maps/search/?api=1&query=19.432608,-99.133209',
    );
  });
});

describe('errorGpsDe', () => {
  it('clasifica los fallos de expo-location', () => {
    expect(errorGpsDe({ code: 'E_LOCATION_SERVICES_DISABLED', message: 'Location services are disabled' })).toBe('servicio_apagado');
    expect(errorGpsDe({ code: 'E_LOCATION_UNAUTHORIZED', message: 'Not authorized to use location services' })).toBe('sin_permiso');
    expect(errorGpsDe(new Error('Location request timed out'))).toBe('no_disponible');
    expect(errorGpsDe(undefined)).toBe('no_disponible');
  });
});
