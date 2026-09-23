import { esMX } from './es-MX';

type Hojas<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Hojas<T[K], `${P}${K}.`>;
}[keyof T & string];

export type ClaveI18n = Hojas<typeof esMX>;

/** Devuelve el texto es-MX de `clave`; sustituye {variables} si se pasan. */
export function t(clave: ClaveI18n, vars?: Record<string, string | number>): string {
  let valor: any = esMX;
  for (const parte of clave.split('.')) valor = valor?.[parte];
  const texto = typeof valor === 'string' ? valor : clave;
  if (!vars) return texto;
  return texto.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export { esMX };
