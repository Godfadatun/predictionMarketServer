module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/src/**/tests/*.bdd.spec.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  setupFiles: ['<rootDir>/test/env.ts'],
  setupFilesAfterEnv: ['<rootDir>/test/setup-app.ts'],
  testTimeout: 30000,
};
