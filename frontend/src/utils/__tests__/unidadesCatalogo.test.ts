import {
  UNIDADES, claveComparable, unidadesDelProyecto, validarNombreNivel, validarUnidadPersonalizada,
} from '../unidades';
import { validarNuevaPartida, validarNuevoConcepto } from '../validacionCatalogo';

describe('claveComparable', () => {
  it('ignora acentos, mayúsculas y espacios', () => {
    expect(claveComparable('  Kilómetro ')).toBe('kilometro');
    expect(claveComparable('ALBAÑILES')).toBe('albaniles');
    expect(claveComparable(null)).toBe('');
  });
});

describe('unidadesDelProyecto (C-04 / C-12)', () => {
  it('sin personalizadas devuelve solo la lista base', () => {
    expect(unidadesDelProyecto()).toEqual(UNIDADES);
    expect(unidadesDelProyecto([])).toEqual(UNIDADES);
  });

  it('agrega las personalizadas después de la base', () => {
    expect(unidadesDelProyecto(['SACO', 'TRAMO']).slice(-2)).toEqual(['SACO', 'TRAMO']);
  });

  it('no repite una unidad de la base ni una personalizada repetida (sin acentos ni mayúsculas)', () => {
    const lista = unidadesDelProyecto(['pza', 'Saco', 'SACO', 'saco ', 'KM']);
    expect(lista.filter((u) => u.toLowerCase() === 'pza')).toHaveLength(1);
    expect(lista.filter((u) => u.toLowerCase() === 'saco')).toHaveLength(1);
    expect(lista.filter((u) => u.toLowerCase() === 'km')).toHaveLength(1);
    expect(lista).toHaveLength(UNIDADES.length + 1);
  });

  it('ignora entradas vacías', () => {
    expect(unidadesDelProyecto(['', '  '])).toEqual(UNIDADES);
  });
});

describe('validarUnidadPersonalizada', () => {
  it('normaliza a mayúsculas conservando acentos y ñ', () => {
    expect(validarUnidadPersonalizada([], ' costal ')).toEqual({ ok: true, unidad: 'COSTAL' });
    expect(validarUnidadPersonalizada([], 'peña')).toEqual({ ok: true, unidad: 'PEÑA' });
  });

  it('rechaza vacía', () => {
    expect(validarUnidadPersonalizada([], '   ')).toEqual({ ok: false, motivo: 'vacia' });
  });

  it('rechaza las que ya están en la lista base, por clave o por nombre', () => {
    expect(validarUnidadPersonalizada([], 'pza')).toEqual({ ok: false, motivo: 'repetida' });
    expect(validarUnidadPersonalizada([], 'Kilómetro')).toEqual({ ok: false, motivo: 'repetida' });
    expect(validarUnidadPersonalizada([], 'metro cuadrado')).toEqual({ ok: false, motivo: 'repetida' });
  });

  it('rechaza las que el proyecto ya tiene', () => {
    expect(validarUnidadPersonalizada(['SACO'], 'saco')).toEqual({ ok: false, motivo: 'repetida' });
  });
});

describe('validarNombreNivel (niveles repetidos)', () => {
  it('acepta un nombre nuevo y lo recorta', () => {
    expect(validarNombreNivel(['Frente'], '  Tramo ')).toEqual({ ok: true, nombre: 'Tramo' });
  });

  it('rechaza vacío y repetido sin importar acentos ni mayúsculas', () => {
    expect(validarNombreNivel([], ' ')).toEqual({ ok: false, motivo: 'vacio' });
    expect(validarNombreNivel(['Sección'], 'seccion')).toEqual({ ok: false, motivo: 'repetido' });
  });
});

describe('validarNuevaPartida', () => {
  const hermanas = [{ clave: '1', nombre: 'Obra civil' }];
  const todas = [{ clave: '1', nombre: 'Obra civil' }, { clave: '2', nombre: 'Instalaciones' }];

  it('pide clave y nombre', () => {
    expect(validarNuevaPartida({ clave: ' ', nombre: '' }, [], [])).toEqual({
      clave: 'La clave es obligatoria.', nombre: 'El nombre es obligatorio.',
    });
  });

  it('rechaza clave repetida en el proyecto y nombre repetido entre hermanas', () => {
    const e = validarNuevaPartida({ clave: '2', nombre: 'obra CIVIL' }, hermanas, todas);
    expect(e.clave).toBe('La clave «2» ya está en uso.');
    expect(e.nombre).toBe('El nombre «obra CIVIL» ya está en uso en este nivel.');
  });

  it('un nombre repetido en otro nivel no cuenta', () => {
    expect(validarNuevaPartida({ clave: '3', nombre: 'Instalaciones' }, hermanas, todas)).toEqual({});
  });
});

describe('validarNuevoConcepto (C-05)', () => {
  const opciones = { separador: '.' as const, unidadesValidas: [...UNIDADES, 'SACO'], clavesExistentes: ['1.1'] };
  const base = { clave: '1.2', descripcion: 'Muro', unidad: 'M2', cantidad: '1,500.5', precioUnitario: '10', extraordinario: false };

  it('interpreta cantidad y P.U. con el formato es-MX y arma el payload', () => {
    const r = validarNuevoConcepto(base, opciones);
    expect(r.errores).toEqual({});
    expect(r.valores).toEqual({
      clave: '1.2', descripcion: 'Muro', unidad: 'M2', cantidad: '1500.5', precio_unitario: '10',
      meta: '1500.5', periodicidad_meta: 'SEMANAL', extraordinario: false,
    });
  });

  it('marca cada campo faltante', () => {
    const r = validarNuevoConcepto({ ...base, clave: '', descripcion: ' ', cantidad: '', precioUnitario: '' }, opciones);
    expect(Object.keys(r.errores).sort()).toEqual(['cantidad', 'clave', 'descripcion', 'precioUnitario']);
    expect(r.valores).toBeNull();
  });

  it('cantidad cero o negativa y decimales de más', () => {
    expect(validarNuevoConcepto({ ...base, cantidad: '0' }, opciones).errores.cantidad).toBe('La cantidad debe ser mayor que cero.');
    expect(validarNuevoConcepto({ ...base, cantidad: '-3' }, opciones).errores.cantidad).toBe('Cantidad contratada debe ser un número válido.');
    expect(validarNuevoConcepto({ ...base, cantidad: '1.12345' }, opciones).errores.cantidad).toBe('Cantidad contratada admite hasta 4 decimales.');
    expect(validarNuevoConcepto({ ...base, precioUnitario: '1.234' }, opciones).errores.precioUnitario).toBe('Precio unitario admite hasta 2 decimales.');
  });

  it('P.U. en cero es válido; texto no', () => {
    expect(validarNuevoConcepto({ ...base, precioUnitario: '0' }, opciones).valores?.precio_unitario).toBe('0');
    expect(validarNuevoConcepto({ ...base, precioUnitario: 'abc' }, opciones).errores.precioUnitario).toBe('Precio unitario debe ser un número válido.');
  });

  it('clave repetida y unidad fuera de la lista', () => {
    const r = validarNuevoConcepto({ ...base, clave: '1.1', unidad: 'COSTAL' }, opciones);
    expect(r.errores.clave).toBe('La clave «1.1» ya está en uso.');
    expect(r.errores.unidad).toBe('Elige una unidad de la lista.');
    expect(validarNuevoConcepto({ ...base, unidad: 'SACO' }, opciones).valores?.unidad).toBe('SACO');
  });

  it('un extraordinario puede dejar el P.U. vacío (queda en 0, pendiente de autorización)', () => {
    const r = validarNuevoConcepto({ ...base, precioUnitario: '', extraordinario: true }, opciones);
    expect(r.valores).toMatchObject({ precio_unitario: '0', extraordinario: true });
    const mal = validarNuevoConcepto({ ...base, precioUnitario: 'x', extraordinario: true }, opciones);
    expect(mal.errores.precioUnitario).toBe('Precio unitario propuesto debe ser un número válido.');
  });

  it('con coma decimal en el proyecto, "1.500,5" es mil quinientos y medio', () => {
    const r = validarNuevoConcepto({ ...base, cantidad: '1.500,5', precioUnitario: '10,25' }, { ...opciones, separador: ',' });
    expect(r.valores).toMatchObject({ cantidad: '1500.5', precio_unitario: '10.25' });
  });
});
