import {fetchFile, parse} from '@loaders.gl/core';
import {CSVLoader} from '@loaders.gl/csv';

const SAMPLE_CSV_URL = '@loaders.gl/csv/test/data/sample-very-long.csv';

/*
// Comparison loader based on D3
import {csvParseRows} from 'd3-dsv';

const D3CSVLoader = {
  name: 'CSV',
  extensions: ['csv'],
  testText: null,
  parseTextSync: csvParseRows
};
*/

export default async function csvBench(bench) {
  const sample = await fetchFile(SAMPLE_CSV_URL);

  bench = bench.group('CSV Decode');

  bench = bench.addAsync('CSVLoader#decode', async () => {
    parse(sample, CSVLoader);
  });

  return bench;
}
