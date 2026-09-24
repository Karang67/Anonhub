/**
 * @file spreadsheetEngine.js
 * @description Advanced Microsoft Excel-compatible Formula Engine for Trinetra.
 * Supports relative & absolute cell references ($A$1), multi-cell ranges (A1:B10),
 * cross-sheet references (Sheet1!A1), circular dependency detection, and a rich function catalog.
 */

// ─── Cell Coordinate Utilities ────────────────────────────────────────────────

/**
 * Converts a 0-based column index to Excel column letters (0 -> 'A', 25 -> 'Z', 26 -> 'AA')
 * @param {number} colIndex 
 * @returns {string}
 */
export function colIndexToLetter(colIndex) {
  let temp, letter = '';
  let col = colIndex + 1;
  while (col > 0) {
    temp = (col - 1) % 26;
    letter = String.fromCharCode(65 + temp) + letter;
    col = Math.floor((col - temp) / 26);
  }
  return letter;
}

/**
 * Converts Excel column letters to a 0-based column index ('A' -> 0, 'Z' -> 25, 'AA' -> 26)
 * @param {string} colStr 
 * @returns {number}
 */
export function colLetterToIndex(colStr) {
  let index = 0;
  const str = colStr.toUpperCase();
  for (let i = 0; i < str.length; i++) {
    index = index * 26 + (str.charCodeAt(i) - 64);
  }
  return index - 1;
}

/**
 * Parses a cell coordinate string like 'A1', '$B$2', 'Sheet1!A1'
 * @param {string} cellId 
 * @returns {{ sheet: string|null, colStr: string, col: number, row: number, absCol: boolean, absRow: boolean } | null}
 */
export function parseCellAddress(cellId) {
  if (!cellId || typeof cellId !== 'string') return null;
  const match = cellId.trim().match(/^(?:(?:'([^']+)'|([A-Za-z0-9_]+))!)?(\$?)([A-Za-z]+)(\$?)(\d+)$/);
  if (!match) return null;

  const sheet = match[1] || match[2] || null;
  const absCol = match[3] === '$';
  const colStr = match[4].toUpperCase();
  const absRow = match[5] === '$';
  const row = parseInt(match[6], 10);

  return {
    sheet,
    colStr,
    col: colLetterToIndex(colStr),
    row,
    absCol,
    absRow
  };
}

/**
 * Expands an Excel range like 'A1:C3' into an array of cell coordinates.
 * @param {string} rangeStr - E.g. 'A1:C3' or 'Sheet1!A1:B2'
 * @returns {string[]}
 */
export function expandRange(rangeStr) {
  if (!rangeStr || typeof rangeStr !== 'string') return [];
  const parts = rangeStr.split(':');
  if (parts.length === 1) return [parts[0].trim().toUpperCase()];
  if (parts.length !== 2) return [];

  const startAddr = parseCellAddress(parts[0]);
  const endAddr = parseCellAddress(parts[1]);
  if (!startAddr || !endAddr) return [];

  const minCol = Math.min(startAddr.col, endAddr.col);
  const maxCol = Math.max(startAddr.col, endAddr.col);
  const minRow = Math.min(startAddr.row, endAddr.row);
  const maxRow = Math.max(startAddr.row, endAddr.row);

  const sheetPrefix = startAddr.sheet ? `${startAddr.sheet}!` : '';
  const cells = [];

  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      cells.push(`${sheetPrefix}${colIndexToLetter(c)}${r}`);
    }
  }
  return cells;
}

/**
 * Adjusts relative formula references when dragging autofill handle or pasting.
 * @param {string} formula - Original formula string (e.g. '=A1+B$2')
 * @param {number} rowDelta - Number of rows shifted
 * @param {number} colDelta - Number of columns shifted
 * @returns {string}
 */
export function adjustFormulaOnDrag(formula, rowDelta = 0, colDelta = 0) {
  if (!formula || typeof formula !== 'string' || !formula.startsWith('=')) {
    return formula;
  }
  if (rowDelta === 0 && colDelta === 0) return formula;

  // Regex to find cell references like A1, $A1, A$1, $A$1, Sheet1!A1, etc.
  const cellRefRegex = /((?:'[^']+'|[A-Za-z0-9_]+)!)?(\$?)([A-Za-z]+)(\$?)(\d+)/g;

  return formula.replace(cellRefRegex, (match, sheet, colFixed, colLetters, rowFixed, rowNumber) => {
    let newColLetters = colLetters;
    let newRowNumber = parseInt(rowNumber, 10);

    if (!colFixed && colDelta !== 0) {
      const currentIdx = colLetterToIndex(colLetters);
      const newIdx = Math.max(0, currentIdx + colDelta);
      newColLetters = colIndexToLetter(newIdx);
    }

    if (!rowFixed && rowDelta !== 0) {
      newRowNumber = Math.max(1, newRowNumber + rowDelta);
    }

    return `${sheet || ''}${colFixed || ''}${newColLetters}${rowFixed || ''}${newRowNumber}`;
  });
}

// ─── Function Library & Catalog ───────────────────────────────────────────────

export const FORMULA_CATALOG = [
  // Math & Stats
  { name: 'SUM', category: 'Math', syntax: 'SUM(number1, [number2], ...)', desc: 'Adds all numbers in a range or set of arguments.' },
  { name: 'AVERAGE', category: 'Math', syntax: 'AVERAGE(number1, [number2], ...)', desc: 'Calculates the arithmetic mean of a range.' },
  { name: 'MIN', category: 'Math', syntax: 'MIN(number1, [number2], ...)', desc: 'Returns the smallest number in a set of values.' },
  { name: 'MAX', category: 'Math', syntax: 'MAX(number1, [number2], ...)', desc: 'Returns the largest number in a set of values.' },
  { name: 'COUNT', category: 'Math', syntax: 'COUNT(value1, [value2], ...)', desc: 'Counts the number of cells that contain numbers.' },
  { name: 'COUNTA', category: 'Math', syntax: 'COUNTA(value1, [value2], ...)', desc: 'Counts the number of non-empty cells.' },
  { name: 'COUNTIF', category: 'Math', syntax: 'COUNTIF(range, criteria)', desc: 'Counts the number of cells matching criteria.' },
  { name: 'SUMIF', category: 'Math', syntax: 'SUMIF(range, criteria, [sum_range])', desc: 'Adds cells specified by a given condition.' },
  { name: 'ROUND', category: 'Math', syntax: 'ROUND(number, num_digits)', desc: 'Rounds a number to a specified number of digits.' },
  { name: 'ROUNDUP', category: 'Math', syntax: 'ROUNDUP(number, num_digits)', desc: 'Rounds a number up, away from 0.' },
  { name: 'ROUNDDOWN', category: 'Math', syntax: 'ROUNDDOWN(number, num_digits)', desc: 'Rounds a number down, toward 0.' },
  { name: 'ABS', category: 'Math', syntax: 'ABS(number)', desc: 'Returns the absolute value of a number.' },
  { name: 'SQRT', category: 'Math', syntax: 'SQRT(number)', desc: 'Returns the square root of a positive number.' },
  { name: 'POWER', category: 'Math', syntax: 'POWER(number, power)', desc: 'Returns the result of a number raised to a power.' },
  { name: 'MOD', category: 'Math', syntax: 'MOD(number, divisor)', desc: 'Returns the remainder after division.' },
  { name: 'PRODUCT', category: 'Math', syntax: 'PRODUCT(number1, [number2], ...)', desc: 'Multiplies all the numbers given as arguments.' },

  // Logic
  { name: 'IF', category: 'Logic', syntax: 'IF(logical_test, value_if_true, [value_if_false])', desc: 'Specifies a logical test to perform.' },
  { name: 'AND', category: 'Logic', syntax: 'AND(logical1, [logical2], ...)', desc: 'Returns TRUE if all its arguments are TRUE.' },
  { name: 'OR', category: 'Logic', syntax: 'OR(logical1, [logical2], ...)', desc: 'Returns TRUE if any argument is TRUE.' },
  { name: 'NOT', category: 'Logic', syntax: 'NOT(logical)', desc: 'Reverses the logic of its argument.' },
  { name: 'IFERROR', category: 'Logic', syntax: 'IFERROR(value, value_if_error)', desc: 'Returns value_if_error if formula evaluates to an error.' },

  // Text
  { name: 'CONCAT', category: 'Text', syntax: 'CONCAT(text1, [text2], ...)', desc: 'Combines the text from multiple ranges and/or strings.' },
  { name: 'TEXTJOIN', category: 'Text', syntax: 'TEXTJOIN(delimiter, ignore_empty, text1, ...)', desc: 'Combines text from multiple ranges with a delimiter.' },
  { name: 'LEFT', category: 'Text', syntax: 'LEFT(text, [num_chars])', desc: 'Returns the first character(s) in a text string.' },
  { name: 'RIGHT', category: 'Text', syntax: 'RIGHT(text, [num_chars])', desc: 'Returns the last character(s) in a text string.' },
  { name: 'MID', category: 'Text', syntax: 'MID(text, start_num, num_chars)', desc: 'Returns a specific number of characters from a text string.' },
  { name: 'LEN', category: 'Text', syntax: 'LEN(text)', desc: 'Returns the number of characters in a text string.' },
  { name: 'UPPER', category: 'Text', syntax: 'UPPER(text)', desc: 'Converts text to uppercase.' },
  { name: 'LOWER', category: 'Text', syntax: 'LOWER(text)', desc: 'Converts text to lowercase.' },
  { name: 'TRIM', category: 'Text', syntax: 'TRIM(text)', desc: 'Removes all spaces from text except for single spaces between words.' },
  { name: 'PROPER', category: 'Text', syntax: 'PROPER(text)', desc: 'Capitalizes the first letter in each word of a text value.' },

  // Date & Time
  { name: 'TODAY', category: 'Date', syntax: 'TODAY()', desc: 'Returns the current date.' },
  { name: 'NOW', category: 'Date', syntax: 'NOW()', desc: 'Returns the current date and time.' },
  { name: 'DATE', category: 'Date', syntax: 'DATE(year, month, day)', desc: 'Returns the sequential serial number that represents a date.' },
  { name: 'YEAR', category: 'Date', syntax: 'YEAR(serial_number)', desc: 'Returns the year of a date.' },
  { name: 'MONTH', category: 'Date', syntax: 'MONTH(serial_number)', desc: 'Returns the month of a date.' },
  { name: 'DAY', category: 'Date', syntax: 'DAY(serial_number)', desc: 'Returns the day of the month.' },

  // Lookup
  { name: 'VLOOKUP', category: 'Lookup', syntax: 'VLOOKUP(lookup_value, table_array, col_index, [range_lookup])', desc: 'Looks in first column of array and returns value from another column.' },
  { name: 'INDEX', category: 'Lookup', syntax: 'INDEX(array, row_num, [col_num])', desc: 'Returns a value or reference of the cell at the intersection of a row/col.' },
  { name: 'MATCH', category: 'Lookup', syntax: 'MATCH(lookup_value, lookup_array, [match_type])', desc: 'Returns the relative position of an item in an array.' },
  { name: 'CHOOSE', category: 'Lookup', syntax: 'CHOOSE(index_num, value1, [value2], ...)', desc: 'Chooses a value from a list of values.' }
];

// ─── Formula Parser & Evaluator ───────────────────────────────────────────────

/**
 * Extracts raw cell content from sheetData or multi-sheet workbook structure.
 * @param {string} cellCoord - E.g. 'A1' or 'Sheet1!A1'
 * @param {Object} sheetData - Current sheet cells or full workbook object
 * @param {string} [currentSheetId] - ID/Name of the current active sheet
 * @returns {string}
 */
export function getRawCellValue(cellCoord, sheetData, currentSheetId) {
  if (!cellCoord || !sheetData) return '';
  const parsed = parseCellAddress(cellCoord);
  if (!parsed) return '';

  const targetSheet = parsed.sheet;
  const localCoord = `${parsed.colStr}${parsed.row}`;

  // Multi-sheet workbook object format: { sheets: [{ id, name, data: { A1: "..." } }] }
  if (sheetData.sheets && Array.isArray(sheetData.sheets)) {
    const sheetObj = targetSheet
      ? sheetData.sheets.find(s => s.name.toLowerCase() === targetSheet.toLowerCase() || s.id === targetSheet)
      : sheetData.sheets.find(s => s.id === currentSheetId || s.name === currentSheetId) || sheetData.sheets[0];

    if (!sheetObj || !sheetObj.data) return '';
    const cellVal = sheetObj.data[localCoord];
    if (typeof cellVal === 'object' && cellVal !== null) {
      return cellVal.raw ?? cellVal.value ?? '';
    }
    return cellVal !== undefined ? String(cellVal) : '';
  }

  // Flat sheetData object format: { A1: "10", "Sheet1!A1": "20" }
  if (targetSheet) {
    const fullKey = `${targetSheet}!${localCoord}`;
    if (sheetData[fullKey] !== undefined) {
      const val = sheetData[fullKey];
      return typeof val === 'object' && val !== null ? (val.raw ?? val.value ?? '') : String(val);
    }
  }

  const val = sheetData[localCoord];
  if (typeof val === 'object' && val !== null) {
    return val.raw ?? val.value ?? '';
  }
  return val !== undefined ? String(val) : '';
}

/**
 * Evaluates a single cell value or formula string with cycle detection.
 * @param {string} cellCoord - E.g. 'A1'
 * @param {Object} sheetData - Sheet cells map or workbook structure
 * @param {string} [currentSheetId] - Active sheet identifier
 * @param {Set<string>} [visited] - Dependency cycle detection set
 * @returns {string|number}
 */
export function evaluateCell(cellCoord, sheetData, currentSheetId = 'sheet_1', visited = new Set()) {
  const normKey = `${currentSheetId}!${cellCoord.toUpperCase()}`;
  if (visited.has(normKey)) {
    return '#CIRCULAR!';
  }
  visited.add(normKey);

  const rawVal = getRawCellValue(cellCoord, sheetData, currentSheetId);
  if (!rawVal || typeof rawVal !== 'string' || !rawVal.startsWith('=')) {
    return rawVal;
  }

  const formula = rawVal.slice(1).trim();
  const res = evaluateFormulaExpression(formula, sheetData, currentSheetId, new Set(visited));
  return res;
}

/**
 * Internal recursive parser & calculator for Excel formulas.
 */
function evaluateFormulaExpression(expression, sheetData, currentSheetId, visited) {
  if (!expression) return '';
  const expr = expression.trim();

  // Try function matching (e.g. SUM(A1:B3), IF(A1>5, "Pass", "Fail"), etc.)
  const fnMatch = expr.match(/^([A-Za-z_]+)\s*\((.*)\)$/s);
  if (fnMatch) {
    const fnName = fnMatch[1].toUpperCase();
    const argsContent = fnMatch[2];
    const args = splitFormulaArguments(argsContent);

    try {
      return executeFormulaFunction(fnName, args, sheetData, currentSheetId, visited);
    } catch (err) {
      if (err.message && err.message.startsWith('#')) return err.message;
      return '#VALUE!';
    }
  }

  // Expression math / string comparison evaluation: replace cell references with their evaluated values
  let mathExpr = expr;

  // Replace ranges in non-wrapped expressions (e.g. A1:A3 -> array representation or sum)
  const rangeRegex = /(?:(?:'[^']+'|[A-Za-z0-9_]+)!)?\$?[A-Za-z]+\$?\d+:\$?[A-Za-z]+\$?\d+/g;
  mathExpr = mathExpr.replace(rangeRegex, (rMatch) => {
    const cells = expandRange(rMatch);
    const sumVal = cells.reduce((acc, c) => {
      const v = parseFloat(evaluateCell(c, sheetData, currentSheetId, new Set(visited)));
      return acc + (isNaN(v) ? 0 : v);
    }, 0);
    return String(sumVal);
  });

  // Replace single cell references (A1, $B$2, Sheet1!A1)
  try {
    const cellRefRegex = /(?:(?:'[^']+'|[A-Za-z0-9_]+)!)?\$?[A-Za-z]+\$?\d+/g;
    mathExpr = mathExpr.replace(cellRefRegex, (cMatch) => {
      const val = evaluateCell(cMatch, sheetData, currentSheetId, new Set(visited));
      if (typeof val === 'string' && val.startsWith('#')) {
        throw new Error(val);
      }
      const num = parseFloat(val);
      if (!isNaN(num)) {
        return `(${num})`;
      }
      // String literal wrap
      const cleanStr = String(val).replace(/"/g, '\\"');
      return `"${cleanStr}"`;
    });
  } catch (err) {
    if (err.message && err.message.startsWith('#')) return err.message;
    return '#ERROR!';
  }

  // Safe evaluation
  try {
    // Replace Excel operators
    mathExpr = mathExpr.replace(/\^/g, '**');
    mathExpr = mathExpr.replace(/<>/g, '!==');
    mathExpr = mathExpr.replace(/=/g, '===');

    // Whitelist check
    const isSafe = /^[\s\d+\-*/().%*<>=!&|"'\w\\]+$/.test(mathExpr);
    if (!isSafe) return '#ERROR!';

    const evalFn = new Function(`"use strict"; return (${mathExpr})`);
    const evaluated = evalFn();

    if (evaluated === Infinity || evaluated === -Infinity || Number.isNaN(evaluated)) {
      return '#DIV/0!';
    }
    if (typeof evaluated === 'boolean') {
      return evaluated ? 'TRUE' : 'FALSE';
    }
    return evaluated !== undefined && evaluated !== null ? evaluated : '';
  } catch (e) {
    if (e.message && e.message.startsWith('#')) return e.message;
    return '#ERROR!';
  }
}

/**
 * Splits formula arguments while honoring nested parentheses and string quotes.
 */
function splitFormulaArguments(argsString) {
  const args = [];
  let current = '';
  let parenDepth = 0;
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < argsString.length; i++) {
    const ch = argsString[i];

    if ((ch === '"' || ch === "'") && (i === 0 || argsString[i - 1] !== '\\')) {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = ch;
      } else if (quoteChar === ch) {
        inQuotes = false;
      }
    }

    if (!inQuotes) {
      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;
      else if (ch === ',' && parenDepth === 0) {
        args.push(current.trim());
        current = '';
        continue;
      }
    }
    current += ch;
  }
  if (current.trim() || args.length > 0) {
    args.push(current.trim());
  }
  return args;
}

/**
 * Resolves a list of formula arguments, expanding ranges to arrays of evaluated values.
 */
function resolveArgumentsToValues(args, sheetData, currentSheetId, visited) {
  const values = [];

  for (const arg of args) {
    if (arg === undefined || arg === null) continue;
    const trimmedArg = String(arg).trim();
    if ((trimmedArg.startsWith('"') && trimmedArg.endsWith('"')) || (trimmedArg.startsWith("'") && trimmedArg.endsWith("'"))) {
      // String literal
      values.push(trimmedArg.slice(1, -1));
    } else if (trimmedArg.includes(':')) {
      // Range argument
      const cells = expandRange(trimmedArg);
      for (const c of cells) {
        const val = evaluateCell(c, sheetData, currentSheetId, new Set(visited));
        values.push(val);
      }
    } else if (parseCellAddress(trimmedArg)) {
      // Single cell reference
      const val = evaluateCell(trimmedArg, sheetData, currentSheetId, new Set(visited));
      values.push(val);
    } else {
      // Number or sub-formula
      const evaluated = evaluateFormulaExpression(trimmedArg, sheetData, currentSheetId, visited);
      values.push(evaluated);
    }
  }
  return values;
}

/**
 * Executes supported Excel functions.
 */
function executeFormulaFunction(fnName, rawArgs, sheetData, currentSheetId, visited) {
  switch (fnName) {
    // ─── Math & Statistics ───────────────────────────────────────────────────
    case 'SUM': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      let sum = 0;
      for (const v of vals) {
        const n = parseFloat(v);
        if (!isNaN(n)) sum += n;
      }
      return sum;
    }

    case 'AVERAGE': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      let sum = 0, count = 0;
      for (const v of vals) {
        const n = parseFloat(v);
        if (!isNaN(n)) {
          sum += n;
          count++;
        }
      }
      if (count === 0) return '#DIV/0!';
      const avg = sum / count;
      return Number.isInteger(avg) ? avg : parseFloat(avg.toFixed(4));
    }

    case 'MIN': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      const nums = vals.map(v => parseFloat(v)).filter(n => !isNaN(n));
      return nums.length > 0 ? Math.min(...nums) : 0;
    }

    case 'MAX': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      const nums = vals.map(v => parseFloat(v)).filter(n => !isNaN(n));
      return nums.length > 0 ? Math.max(...nums) : 0;
    }

    case 'COUNT': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      return vals.filter(v => !isNaN(parseFloat(v)) && String(v).trim() !== '').length;
    }

    case 'COUNTA': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      return vals.filter(v => v !== null && v !== undefined && String(v).trim() !== '').length;
    }

    case 'COUNTIF': {
      if (rawArgs.length < 2) return '#VALUE!';
      const rangeCells = expandRange(rawArgs[0]);
      const criteriaRaw = rawArgs[1].replace(/^["']|["']$/g, '').trim();
      let count = 0;

      for (const c of rangeCells) {
        const val = String(evaluateCell(c, sheetData, currentSheetId, new Set(visited))).trim();
        if (matchesCriteria(val, criteriaRaw)) count++;
      }
      return count;
    }

    case 'SUMIF': {
      if (rawArgs.length < 2) return '#VALUE!';
      const rangeCells = expandRange(rawArgs[0]);
      const criteriaRaw = rawArgs[1].replace(/^["']|["']$/g, '').trim();
      const sumCells = rawArgs[2] ? expandRange(rawArgs[2]) : rangeCells;

      let sum = 0;
      for (let i = 0; i < rangeCells.length; i++) {
        const val = String(evaluateCell(rangeCells[i], sheetData, currentSheetId, new Set(visited))).trim();
        if (matchesCriteria(val, criteriaRaw)) {
          const sumTarget = sumCells[i] || rangeCells[i];
          const n = parseFloat(evaluateCell(sumTarget, sheetData, currentSheetId, new Set(visited)));
          if (!isNaN(n)) sum += n;
        }
      }
      return sum;
    }

    case 'ROUND': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      const num = parseFloat(vals[0]);
      const digits = parseInt(vals[1] || '0', 10);
      if (isNaN(num)) return '#VALUE!';
      const factor = Math.pow(10, digits);
      return Math.round(num * factor) / factor;
    }

    case 'ROUNDUP': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      const num = parseFloat(vals[0]);
      const digits = parseInt(vals[1] || '0', 10);
      if (isNaN(num)) return '#VALUE!';
      const factor = Math.pow(10, digits);
      return (num >= 0 ? Math.ceil(num * factor) : Math.floor(num * factor)) / factor;
    }

    case 'ROUNDDOWN': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      const num = parseFloat(vals[0]);
      const digits = parseInt(vals[1] || '0', 10);
      if (isNaN(num)) return '#VALUE!';
      const factor = Math.pow(10, digits);
      return (num >= 0 ? Math.floor(num * factor) : Math.ceil(num * factor)) / factor;
    }

    case 'ABS': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      const num = parseFloat(vals[0]);
      return isNaN(num) ? '#VALUE!' : Math.abs(num);
    }

    case 'SQRT': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      const num = parseFloat(vals[0]);
      if (isNaN(num) || num < 0) return '#NUM!';
      return Math.sqrt(num);
    }

    case 'POWER': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      const base = parseFloat(vals[0]);
      const exp = parseFloat(vals[1]);
      if (isNaN(base) || isNaN(exp)) return '#VALUE!';
      return Math.pow(base, exp);
    }

    case 'MOD': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      const n = parseFloat(vals[0]);
      const d = parseFloat(vals[1]);
      if (isNaN(n) || isNaN(d)) return '#VALUE!';
      if (d === 0) return '#DIV/0!';
      return n % d;
    }

    case 'PRODUCT': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      let prod = 1, hasNum = false;
      for (const v of vals) {
        const n = parseFloat(v);
        if (!isNaN(n)) {
          prod *= n;
          hasNum = true;
        }
      }
      return hasNum ? prod : 0;
    }

    // ─── Logic ───────────────────────────────────────────────────────────────
    case 'IF': {
      if (rawArgs.length < 2) return '#VALUE!';
      const condVal = evaluateFormulaExpression(rawArgs[0], sheetData, currentSheetId, visited);
      const isTrue = isTruthyCondition(condVal);
      const targetExpr = isTrue ? rawArgs[1] : (rawArgs[2] || '""');
      return evaluateFormulaExpression(targetExpr, sheetData, currentSheetId, visited);
    }

    case 'AND': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      const allTrue = vals.every(v => isTruthyCondition(v));
      return allTrue ? 'TRUE' : 'FALSE';
    }

    case 'OR': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      const anyTrue = vals.some(v => isTruthyCondition(v));
      return anyTrue ? 'TRUE' : 'FALSE';
    }

    case 'NOT': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      return isTruthyCondition(vals[0]) ? 'FALSE' : 'TRUE';
    }

    case 'IFERROR': {
      if (rawArgs.length < 2) return '#VALUE!';
      try {
        const val = evaluateFormulaExpression(rawArgs[0], sheetData, currentSheetId, visited);
        if (typeof val === 'string' && val.startsWith('#')) {
          return evaluateFormulaExpression(rawArgs[1], sheetData, currentSheetId, visited);
        }
        return val;
      } catch {
        return evaluateFormulaExpression(rawArgs[1], sheetData, currentSheetId, visited);
      }
    }

    // ─── Text ────────────────────────────────────────────────────────────────
    case 'CONCAT':
    case 'CONCATENATE': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      return vals.map(v => (v !== null && v !== undefined ? String(v) : '')).join('');
    }

    case 'TEXTJOIN': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      const delimiter = String(vals[0] || '');
      const ignoreEmpty = isTruthyCondition(vals[1]);
      const textParts = vals.slice(2).filter(v => (!ignoreEmpty || (v !== '' && v !== null && v !== undefined)));
      return textParts.join(delimiter);
    }

    case 'LEFT': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      const str = String(vals[0] || '');
      const count = parseInt(vals[1] || '1', 10);
      return str.substring(0, Math.max(0, count));
    }

    case 'RIGHT': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      const str = String(vals[0] || '');
      const count = parseInt(vals[1] || '1', 10);
      return str.substring(Math.max(0, str.length - count));
    }

    case 'MID': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      const str = String(vals[0] || '');
      const start = Math.max(1, parseInt(vals[1] || '1', 10));
      const count = parseInt(vals[2] || '0', 10);
      return str.substring(start - 1, start - 1 + count);
    }

    case 'LEN': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      return String(vals[0] || '').length;
    }

    case 'UPPER': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      return String(vals[0] || '').toUpperCase();
    }

    case 'LOWER': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      return String(vals[0] || '').toLowerCase();
    }

    case 'TRIM': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      return String(vals[0] || '').trim().replace(/\s+/g, ' ');
    }

    case 'PROPER': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      return String(vals[0] || '').replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
    }

    // ─── Date & Time ─────────────────────────────────────────────────────────
    case 'TODAY': {
      const now = new Date();
      return now.toISOString().split('T')[0];
    }

    case 'NOW': {
      const now = new Date();
      return now.toLocaleDateString() + ' ' + now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    case 'DATE': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      const y = parseInt(vals[0], 10);
      const m = parseInt(vals[1], 10);
      const d = parseInt(vals[2], 10);
      if (isNaN(y) || isNaN(m) || isNaN(d)) return '#VALUE!';
      const dt = new Date(y, m - 1, d);
      return dt.toISOString().split('T')[0];
    }

    case 'YEAR': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      const dt = new Date(vals[0]);
      return isNaN(dt.getTime()) ? '#VALUE!' : dt.getFullYear();
    }

    case 'MONTH': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      const dt = new Date(vals[0]);
      return isNaN(dt.getTime()) ? '#VALUE!' : dt.getMonth() + 1;
    }

    case 'DAY': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      const dt = new Date(vals[0]);
      return isNaN(dt.getTime()) ? '#VALUE!' : dt.getDate();
    }

    // ─── Lookup & Reference ──────────────────────────────────────────────────
    case 'VLOOKUP': {
      if (rawArgs.length < 3) return '#VALUE!';
      const lookupVal = resolveArgumentsToValues([rawArgs[0]], sheetData, currentSheetId, visited)[0];
      const tableCells = expandRange(rawArgs[1]);
      if (tableCells.length === 0) return '#REF!';

      const colIndex = parseInt(resolveArgumentsToValues([rawArgs[2]], sheetData, currentSheetId, visited)[0], 10);
      if (isNaN(colIndex) || colIndex < 1) return '#VALUE!';

      const startAddr = parseCellAddress(tableCells[0]);
      const endAddr = parseCellAddress(tableCells[tableCells.length - 1]);
      if (!startAddr || !endAddr) return '#REF!';

      const totalCols = Math.abs(endAddr.col - startAddr.col) + 1;
      if (colIndex > totalCols) return '#REF!';

      const minRow = Math.min(startAddr.row, endAddr.row);
      const maxRow = Math.max(startAddr.row, endAddr.row);
      const sheetPrefix = startAddr.sheet ? `${startAddr.sheet}!` : '';

      for (let r = minRow; r <= maxRow; r++) {
        const keyCell = `${sheetPrefix}${colIndexToLetter(startAddr.col)}${r}`;
        const keyVal = evaluateCell(keyCell, sheetData, currentSheetId, new Set(visited));

        if (String(keyVal).trim().toLowerCase() === String(lookupVal).trim().toLowerCase()) {
          const targetCol = startAddr.col + colIndex - 1;
          const targetCell = `${sheetPrefix}${colIndexToLetter(targetCol)}${r}`;
          return evaluateCell(targetCell, sheetData, currentSheetId, new Set(visited));
        }
      }
      return '#N/A';
    }

    case 'CHOOSE': {
      const vals = resolveArgumentsToValues(rawArgs, sheetData, currentSheetId, visited);
      const idx = parseInt(vals[0], 10);
      if (isNaN(idx) || idx < 1 || idx >= vals.length) return '#VALUE!';
      return vals[idx];
    }

    default:
      return '#NAME?';
  }
}

/**
 * Checks if a string condition evaluates to truthy.
 */
function isTruthyCondition(val) {
  if (val === true || val === 'TRUE' || val === 'true') return true;
  if (val === false || val === 'FALSE' || val === 'false' || val === 0 || val === '0' || val === '' || val === null || val === undefined) return false;
  const n = parseFloat(val);
  return !isNaN(n) ? n !== 0 : true;
}

/**
 * Evaluates Excel criteria expressions like '>100', '<=50', '<>0', 'Passed'
 */
function matchesCriteria(cellValStr, criteria) {
  if (!criteria) return true;
  const crit = criteria.trim();

  if (crit.startsWith('>=')) {
    const num = parseFloat(crit.slice(2));
    return !isNaN(num) && parseFloat(cellValStr) >= num;
  }
  if (crit.startsWith('<=')) {
    const num = parseFloat(crit.slice(2));
    return !isNaN(num) && parseFloat(cellValStr) <= num;
  }
  if (crit.startsWith('>')) {
    const num = parseFloat(crit.slice(1));
    return !isNaN(num) && parseFloat(cellValStr) > num;
  }
  if (crit.startsWith('<')) {
    const num = parseFloat(crit.slice(1));
    return !isNaN(num) && parseFloat(cellValStr) < num;
  }
  if (crit.startsWith('<>')) {
    const target = crit.slice(2).trim();
    return cellValStr.toLowerCase() !== target.toLowerCase();
  }
  if (crit.startsWith('=')) {
    const target = crit.slice(1).trim();
    return cellValStr.toLowerCase() === target.toLowerCase();
  }
  return cellValStr.toLowerCase() === crit.toLowerCase();
}
