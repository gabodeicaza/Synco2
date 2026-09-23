// Textos visibles de la app en español de México. Todo texto nuevo va aquí,
// con acentos y ñ correctos; las pantallas lo leen con t() de "@/src/i18n".
export const esMX = {
  marca: {
    nombre: 'Dirac',
    compartirReporte: 'Compartir reporte Dirac',
    resumenEjecutivo: 'Resumen ejecutivo · Dirac',
    reporteDeObra: 'Reporte de obra · Dirac',
    invitacion: 'Hola {nombre}, te invito a Dirac.\nEnlace: {enlace}\nToken: {token}',
  },
  auth: {
    bienvenida: 'Bienvenido a Dirac',
    accesoSoloInvitacion:
      'El acceso a Dirac es solo por invitación. Tu Coordinador General te enviará un código por WhatsApp o correo.',
    olvideIntro:
      'Escribe el correo con el que entras a Dirac. Te enviaremos un enlace para crear una contraseña nueva.',
  },
  perfil: {
    proyectosAccesibles: 'Proyectos accesibles',
    accesoTodosProyectos: 'Acceso a todos los proyectos',
  },
  proyecto: {
    plantillaWordOpcional: 'Word (opcional)',
    plantillaWordDescripcion: 'Se usa como base tal cual, sin sustitución de campos',
    mapaUbicacion: 'Mapa / Ubicación',
    mapaUbicacionDescripcion: 'Imagen (JPG/PNG) que se muestra como mapa en los reportes',
  },
  errores: {
    campoObligatorio: 'este dato es obligatorio',
    numeroInvalido: 'debe ser un número',
    enteroInvalido: 'debe ser un número entero',
    correoInvalido: 'no es un correo válido',
    fechaInvalida: 'no es una fecha válida',
    valorInvalido: 'el valor no es válido',
    muyCorto: 'el texto es demasiado corto',
    muyLargo: 'el texto es demasiado largo',
    menorAlMinimo: 'el valor es menor al mínimo permitido',
    mayorAlMaximo: 'el valor es mayor al máximo permitido',
    solicitudInvalida: 'La solicitud no es válida. Revisa los datos e inténtalo de nuevo.',
  },
} as const;
