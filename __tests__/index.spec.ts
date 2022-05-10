import * as fs from 'fs';
import * as path from 'path';

const { parseMd } = require('../dist/lint-md-parser');

describe('test lint-md-parser', () => {
  const mdDemo = fs
    .readFileSync(path.resolve(__dirname, './common-demo.md'))
    .toString();

  test('expose method (parseMd) is bundled as function', () => {
    expect(typeof parseMd).toStrictEqual('function');
  });

  test('invoke parseMd', () => {
    expect(parseMd(mdDemo)).toMatchSnapshot();
  });
});
