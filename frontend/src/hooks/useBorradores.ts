// Lista de borradores del usuario, siempre al día: se vuelve a leer al enfocar la
// pantalla y cada vez que un borrador se guarda o se descarta.
import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { BorradorResumen, listarBorradores, suscribirBorradores } from '@/src/utils/borradores';

export function useBorradores(userId: string) {
  const [lista, setLista] = useState<BorradorResumen[]>([]);
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(async () => {
    setLista(await listarBorradores(userId));
    setCargando(false);
  }, [userId]);

  useFocusEffect(useCallback(() => { recargar(); }, [recargar]));
  useEffect(() => suscribirBorradores(() => { recargar(); }), [recargar]);

  return { lista, cargando, recargar };
}
