import {
  evaluateCell,
  adjustFormulaOnDrag,
  colIndexToLetter,
  colLetterToIndex,
  expandRange
} from './spreadsheetEngine.js';

let passed = 0;
let failed = 0;

function assert(description, actual, expected) {
  if (String(actual) === String(expected)) {
    console.log(`✓ ${description}`);
    passed++;
  } else {
    console.error(`✗ ${description} — Expected: "${expected}", Got: "${actual}"`);
    failed++;
  }
}

console.log('--- Running Spreadsheet Formula Engine Unit Tests ---');

// Test 1: Coordinate mapping
assert('colIndexToLetter(0) -> A', colIndexToLetter(0), 'A');
assert('colIndexToLetter(25) -> Z', colIndexToLetter(25), 'Z');
assert('colIndexToLetter(26) -> AA', colIndexToLetter(26), 'AA');
assert('colLetterToIndex("A") -> 0', colLetterToIndex('A'), 0);
assert('colLetterToIndex("Z") -> 25', colLetterToIndex('Z'), 25);
assert('colLetterToIndex("AA") -> 26', colLetterToIndex('AA'), 26);

// Test 2: Range expansion
const rangeA1C2 = expandRange('A1:C2');
assert('expandRange("A1:C2") length', rangeA1C2.length, 6);
assert('expandRange("A1:C2") content', rangeA1C2.join(','), 'A1,B1,C1,A2,B2,C2');

// Test 3: Math formulas
const testWorkbook = {
  sheets: [
    {
      id: 'sheet_1',
      name: 'Sheet1',
      data: {
        A1: { raw: '10' },
        A2: { raw: '20' },
        A3: { raw: '30' },
        B1: { raw: '=SUM(A1:A3)' },
        B2: { raw: '=AVERAGE(A1:A3)' },
        B3: { raw: '=MIN(A1:A3)' },
        B4: { raw: '=MAX(A1:A3)' },
        B5: { raw: '=COUNT(A1:A3)' },
        C1: { raw: '=A1*2 + A2/2' },
        C2: { raw: '=IF(A1>=10, "Pass", "Fail")' },
        C3: { raw: '=IF(A1<5, "Low", "High")' },
        D1: { raw: '=CONCAT("Total: ", B1)' },
        D2: { raw: '=LEFT("Trinetra", 3)' },
        D3: { raw: '=RIGHT("Trinetra", 5)' },
        D4: { raw: '=MID("Trinetra", 4, 3)' },
        D5: { raw: '=LEN("Trinetra")' },
        // Circular reference test
        E1: { raw: '=E2+1' },
        E2: { raw: '=E1+1' }
      }
    }
  ],
  activeSheetId: 'sheet_1'
};

assert('SUM(A1:A3)', evaluateCell('B1', testWorkbook, 'sheet_1'), '60');
assert('AVERAGE(A1:A3)', evaluateCell('B2', testWorkbook, 'sheet_1'), '20');
assert('MIN(A1:A3)', evaluateCell('B3', testWorkbook, 'sheet_1'), '10');
assert('MAX(A1:A3)', evaluateCell('B4', testWorkbook, 'sheet_1'), '30');
assert('COUNT(A1:A3)', evaluateCell('B5', testWorkbook, 'sheet_1'), '3');
assert('Arithmetic: A1*2 + A2/2', evaluateCell('C1', testWorkbook, 'sheet_1'), '30');
assert('IF condition (Pass)', evaluateCell('C2', testWorkbook, 'sheet_1'), 'Pass');
assert('IF condition (High)', evaluateCell('C3', testWorkbook, 'sheet_1'), 'High');
assert('CONCAT', evaluateCell('D1', testWorkbook, 'sheet_1'), 'Total: 60');
assert('LEFT("Trinetra", 3)', evaluateCell('D2', testWorkbook, 'sheet_1'), 'Tri');
assert('RIGHT("Trinetra", 5)', evaluateCell('D3', testWorkbook, 'sheet_1'), 'netra');
assert('MID("Trinetra", 4, 3)', evaluateCell('D4', testWorkbook, 'sheet_1'), 'net');
assert('LEN("Trinetra")', evaluateCell('D5', testWorkbook, 'sheet_1'), '8');
assert('Circular reference detection', evaluateCell('E1', testWorkbook, 'sheet_1'), '#CIRCULAR!');

// Test 4: Relative Reference shifting
assert('adjustFormulaOnDrag("=A1+B1", 1, 0)', adjustFormulaOnDrag('=A1+B1', 1, 0), '=A2+B2');
assert('adjustFormulaOnDrag("=A$1+$B1", 1, 1)', adjustFormulaOnDrag('=A$1+$B1', 1, 1), '=B$1+$B2');
assert('adjustFormulaOnDrag("=$A$1", 5, 5)', adjustFormulaOnDrag('=$A$1', 5, 5), '=$A$1');

console.log(`\nResults: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
