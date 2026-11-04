module.exports = {
  preset: 'ts-jest',
  collectCoverage: false,
  testRegex: '(./__tests__/.*\\.(test|spec))\\.ts$',
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/__tests__/unit/'],
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: '<rootDir>/coverage/',
  testEnvironment: 'node',
  snapshotFormat: {
    escapeString: false,
    printBasicPrototype: false,
  },
};
