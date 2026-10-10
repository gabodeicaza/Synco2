// Pruebas unitarias del corrector de ortografía (scripts/ortografia.js y su diccionario).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { analizarFuente, aplicar } = require('../../scripts/ortografia.js');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { corregirPalabras } = require('../../scripts/ortografia-diccionario.js');

jest.setTimeout(60000);

function corregir(codigo: string): string {
  const { ediciones } = analizarFuente(codigo, 'prueba.tsx');
  return aplicar(codigo, ediciones);
}

describe('diccionario', () => {
  it('conserva la capitalización', () => {
    expect(corregirPalabras('Configuracion')).toBe('Configuración');
    expect(corregirPalabras('configuracion')).toBe('configuración');
    expect(corregirPalabras('CONFIGURACION DEL AREA')).toBe('CONFIGURACIÓN DEL ÁREA');
    expect(corregirPalabras('Albaniles y Topografos')).toBe('Albañiles y Topógrafos');
  });

  it('no toca lo ambiguo ni lo que ya está bien escrito', () => {
    for (const ok of ['Esta es una prueba', 'Yo creo que si', 'Marco de referencia', 'Cargo del usuario', 'Acepto', 'Configuración', 'Session']) {
      expect(corregirPalabras(ok)).toBe(ok);
    }
  });

  it('usa el contexto para los pretéritos (se guardó) y no para el presente (creo)', () => {
    expect(corregirPalabras('Se actualizo correctamente')).toBe('Se actualizó correctamente');
    expect(corregirPalabras('No se guardo el reporte')).toBe('No se guardó el reporte');
    expect(corregirPalabras('Este mes creo un reporte')).toBe('Este mes creo un reporte');
  });

  it('corrige ñ y "aún" solo con contexto claro', () => {
    expect(corregirPalabras('Este ano y hace 3 anos')).toBe('Este año y hace 3 años');
    expect(corregirPalabras('Aun no hay datos')).toBe('Aún no hay datos');
    expect(corregirPalabras('aun asi')).toBe('aun así');
  });

  it('no altera nombres de variables entre llaves ni escapes', () => {
    expect(corregirPalabras('Mínimo {minimo} caracteres')).toBe('Mínimo {minimo} caracteres');
    expect(corregirPalabras('Titulo\\nDescripcion')).toBe('Título\\nDescripción');
  });
});

describe('script (AST)', () => {
  it('corrige JsxText y literales de texto visible', () => {
    expect(corregir('const a = <Text>Configuracion del proyecto</Text>;')).toContain('Configuración del proyecto');
    expect(corregir("Alert.alert('Titulo', 'Descripcion del reporte');")).toBe("Alert.alert('Título', 'Descripción del reporte');");
  });

  it('NO modifica identificadores, claves de objeto ni valores comparados', () => {
    const codigo = "const Configuracion = { Configuracion: 1 }; if (tab === 'Configuracion') {} switch (x) { case 'Operacion': break; }";
    expect(corregir(codigo)).toBe(codigo);
  });

  it('NO modifica claves i18n, rutas, imports ni nombres de ícono ni claves de almacenamiento', () => {
    const codigo = [
      "import x from '@/src/utils/configuracion';",
      "const a = t('errores.configuracion');",
      "router.push('/(coord)/configuracion');",
      'const b = <Ionicons name="calendar" />;',
      "const c = storage.getItem('syncsite_token');",
      "const d = ['a', 'b'].join('_');",
    ].join('\n');
    expect(corregir(codigo)).toBe(codigo);
  });

  it('NO modifica valores de la API en mayúsculas pero sí sus etiquetas visibles', () => {
    expect(corregir("const dia = 'MIERCOLES'; const etiqueta = 'Miercoles';")).toBe("const dia = 'MIERCOLES'; const etiqueta = 'Miércoles';");
  });

  it('restaura símbolos: … · — y la máscara de contraseña', () => {
    expect(corregir("const p = 'Escribe un mensaje_';")).toBe("const p = 'Escribe un mensaje…';");
    expect(corregir("const m = '________';")).toBe("const m = '••••••••';");
    expect(corregir("const s = 'PDF . Word . Excel';")).toBe("const s = 'PDF · Word · Excel';");
    expect(corregir("const s = a || '_';")).toBe("const s = a || '—';");
    expect(corregir('const j = <Text>{a} _ {b}</Text>;')).toBe('const j = <Text>{a} · {b}</Text>;');
    expect(corregir("const j = partes.join(' _ ');")).toBe("const j = partes.join(' · ');");
  });

  it('restaura ¿ y ¡ que el script anterior había convertido en ? y !', () => {
    expect(corregir("confirm('?Eliminar este mensaje?');")).toBe("confirm('¿Eliminar este mensaje?');");
    expect(corregir("msg('Se ocultará. ?Continuar?');")).toBe("msg('Se ocultará. ¿Continuar?');");
    expect(corregir("msg('!Listo! Configura tu acceso');")).toBe("msg('¡Listo! Configura tu acceso');");
    expect(corregir('const q = `Eliminar el nodo ${n}?`;')).toBe('const q = `¿Eliminar el nodo ${n}?`;');
  });

  it('quita el prefijo "__" que sustituyó a un emoji y cambia la marca anterior', () => {
    expect(corregir("notify('__ Nueva Noticia');")).toBe("notify('Nueva Noticia');");
    expect(corregir("console.log('[SynCo][BASE]', base);")).toBe("console.log('[Dirac][BASE]', base);");
    expect(corregir('// SynCo v2.0 _ Tab "Calendario"\nconst a = 1;')).toBe('// Dirac · Tab "Calendario"\nconst a = 1;');
  });

  it('es idempotente: aplicarlo dos veces no cambia nada más', () => {
    const una = corregir("Alert.alert('Titulo', '?Eliminar la configuracion?');");
    expect(corregir(una)).toBe(una);
  });
});
