module.exports = {
  preset: 'ts-jest',
  collectCoverage: false,
  testRegex: '(./__tests__/.*\\.(test|spec))\\.ts$',
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: '<rootDir>/coverage/',
  testEnvironment: 'node',
};
