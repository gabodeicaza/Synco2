// En pruebas (Jest) se usa el babel-preset-expo que trae `expo` (SDK 54), porque el de
// la raíz es más viejo y no entiende la sintaxis Flow de React Native 0.81 al
// renderizar componentes. La app (Metro) sigue usando el preset de la raíz.
function presetExpo(api) {
  if (api.env('test')) {
    try {
      return require.resolve('expo/node_modules/babel-preset-expo');
    } catch (e) {
      // sin preset anidado: se queda el de la raíz
    }
  }
  return 'babel-preset-expo';
}

module.exports = function (api) {
  api.cache.using(() => process.env.NODE_ENV);
  return {
    presets: [presetExpo(api)],
  };
};
