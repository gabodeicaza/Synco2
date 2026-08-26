module.exports = {
  preset: 'jest-expo',
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  // Espeja el alias "@/*" -> raiz del proyecto que ya usa tsconfig.json /
  // Metro en runtime. Jest resuelve modulos con su propio resolver y no lee
  // tsconfig paths solo, asi que sin esto cualquier test que importe un
  // archivo de produccion con imports "@/src/..." (offlineQueue.ts, etc.)
  // falla con "Cannot find module".
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
};
