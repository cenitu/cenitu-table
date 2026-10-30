import { toNumber, toScalar, toText } from './coerce';
import { currentSerial, dateToSerial, daysInMonth, parseDateString, serialToDate } from './dates';
import { registerFunction } from './functions';
import { CellError, err, isError, type Value } from './values';

/** A date argument: a serial number, or text in one of the formats parseDateString accepts. */
function serialArg(v: Value): number | CellError {
  const s = toScalar(v);
  if (typeof s === 'string') {
    const parsed = parseDateString(s);
    if (parsed !== undefined) return parsed;
  }
  const n = toNumber(s);
  if (isError(n)) return n;
  return n < 0 ? err('#NUM!', 'Negative date') : Math.floor(n);
}

function integerArg(v: Value): number | CellError {
  const n = toNumber(toScalar(v));
  return isError(n) ? n : Math.trunc(n);
}

/** Collects already-coerced arguments, returning the first error instead. */
function all(args: Value[], coerce: (v: Value) => number | CellError): number[] | CellError {
  const out: number[] = [];
  for (const a of args) {
    const n = coerce(a);
    if (isError(n)) return n;
    out.push(n);
  }
  return out;
}

const datePart = (pick: (p: ReturnType<typeof serialToDate>) => number) => (args: Value[]): Value => {
  const s = serialArg(args[0]);
  return isError(s) ? s : pick(serialToDate(s));
};

function addMonths(serial: number, months: number, endOfMonth: boolean): number | CellError {
  const { year, month, day } = serialToDate(serial);
  const total = year * 12 + (month - 1) + months;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  const last = daysInMonth(y, m);
  const result = dateToSerial(y, m, endOfMonth ? last : Math.min(day, last));
  return result < 1 ? err('#NUM!') : result;
}

registerFunction('DATE', { minArgs: 3, maxArgs: 3, impl: (args) => {
  const parts = all(args, integerArg);
  if (isError(parts)) return parts;
  let [year] = parts;
  if (year < 0 || year > 9999) return err('#NUM!');
  if (year < 1900) year += 1900;
  const serial = dateToSerial(year, parts[1], parts[2]);
  return serial < 0 ? err('#NUM!') : serial;
} });

registerFunction('YEAR', { minArgs: 1, maxArgs: 1, impl: datePart((p) => p.year) });
registerFunction('MONTH', { minArgs: 1, maxArgs: 1, impl: datePart((p) => p.month) });
registerFunction('DAY', { minArgs: 1, maxArgs: 1, impl: datePart((p) => p.day) });

// Volatile: the value is fixed when the formula is (re)calculated.
registerFunction('TODAY', { maxArgs: 0, impl: () => currentSerial(false) });
registerFunction('NOW', { maxArgs: 0, impl: () => currentSerial(true) });

registerFunction('WEEKDAY', { minArgs: 1, maxArgs: 2, impl: (args) => {
  const s = serialArg(args[0]);
  const type = args.length > 1 ? integerArg(args[1]) : 1;
  if (isError(s)) return s;
  if (isError(type)) return type;
  // Serial 1 (1900-01-01) is a Sunday in the 1900 date system.
  const sunday0 = (((s - 1) % 7) + 7) % 7;
  switch (type) {
    case 1: return sunday0 + 1;
    case 2: return ((sunday0 + 6) % 7) + 1;
    case 3: return (sunday0 + 6) % 7;
    default: return err('#NUM!');
  }
} });

registerFunction('EDATE', { minArgs: 2, maxArgs: 2, impl: (args) => {
  const s = serialArg(args[0]);
  const months = integerArg(args[1]);
  if (isError(s)) return s;
  return isError(months) ? months : addMonths(s, months, false);
} });

registerFunction('EOMONTH', { minArgs: 2, maxArgs: 2, impl: (args) => {
  const s = serialArg(args[0]);
  const months = integerArg(args[1]);
  if (isError(s)) return s;
  return isError(months) ? months : addMonths(s, months, true);
} });

registerFunction('DAYS', { minArgs: 2, maxArgs: 2, impl: (args) => {
  const [end, start] = args.map(serialArg);
  if (isError(end)) return end;
  return isError(start) ? start : end - start;
} });

registerFunction('DATEDIF', { minArgs: 3, maxArgs: 3, impl: (args) => {
  const start = serialArg(args[0]);
  const end = serialArg(args[1]);
  const unit = toText(toScalar(args[2]));
  if (isError(start)) return start;
  if (isError(end)) return end;
  if (isError(unit)) return unit;
  if (start > end) return err('#NUM!', 'Start date is after end date');
  const a = serialToDate(start);
  const b = serialToDate(end);
  const months = (b.year - a.year) * 12 + (b.month - a.month) - (b.day < a.day ? 1 : 0);
  switch (unit.toUpperCase()) {
    case 'D': return end - start;
    case 'M': return months;
    case 'Y': return Math.floor(months / 12);
    case 'YM': return months % 12;
    default: return err('#NUM!', `Unknown DATEDIF unit "${unit}"`);
  }
} });
