const { webcrypto } = require('crypto');
if (!globalThis.crypto) {
  globalThis.crypto = webcrypto;
}

module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': ['ts-jest', {
      tsconfig: 'tsconfig.test.json',
    }],
  },
  collectCoverageFrom: [
    'src/**/*.(t|j)s',
    '!src/main.ts',
  ],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  roots: ['<rootDir>/src/', '<rootDir>/test/'],
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
  },
  testTimeout: 30000,
};
