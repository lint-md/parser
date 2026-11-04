module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/__tests__/unit/**/*.spec.ts',
  ],
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/tsconfig.source-test.json',
      },
    ],
  },
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/**/*.d.ts',
    '!<rootDir>/src/types.ts',
    '!<rootDir>/src/source-map/types.ts',
  ],
  coverageProvider: 'v8',
  coverageDirectory: '<rootDir>/coverage/source',
  coverageReporters: [
    'text',
    'lcov',
    'json-summary',
  ],
};
