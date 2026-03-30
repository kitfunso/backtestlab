/**
 * India Equities - Formatting Utilities
 *
 * Indian number formatting (lakhs/crores) and INR currency.
 */

/** Format INR with Indian grouping: 1,23,456 */
export function formatINR(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';

  if (abs >= 1e7) {
    // Crores
    const cr = abs / 1e7;
    return `${sign}\u20B9${formatIndianGrouping(cr, 2)}Cr`;
  }
  if (abs >= 1e5) {
    // Lakhs
    const lk = abs / 1e5;
    return `${sign}\u20B9${formatIndianGrouping(lk, 2)}L`;
  }

  return `${sign}\u20B9${formatIndianGrouping(abs, 0)}`;
}

/** Full INR with Indian number grouping (no abbreviation). */
export function formatINRFull(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}\u20B9${formatIndianGrouping(abs, 0)}`;
}

/**
 * Indian number grouping: XX,XX,XX,XXX
 * First group of 3 from right, then groups of 2.
 */
function formatIndianGrouping(num: number, decimals: number): string {
  const parts = num.toFixed(decimals).split('.');
  const intPart = parts[0];
  const decPart = parts[1];

  if (intPart.length <= 3) {
    return decPart ? `${intPart}.${decPart}` : intPart;
  }

  const last3 = intPart.slice(-3);
  let rest = intPart.slice(0, -3);
  const groups: string[] = [];

  while (rest.length > 2) {
    groups.unshift(rest.slice(-2));
    rest = rest.slice(0, -2);
  }
  if (rest.length > 0) {
    groups.unshift(rest);
  }

  const formatted = `${groups.join(',')},${last3}`;
  return decPart ? `${formatted}.${decPart}` : formatted;
}

/** Format price with 2 decimal places. */
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return '\u2014';
  return `\u20B9${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Format percentage with sign. */
export function formatPct(value: number | null | undefined, decimals: number = 1): string {
  if (value === null || value === undefined) return '\u2014';
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(decimals)}%`;
}

/** Format Sharpe ratio. */
export function formatSharpe(value: number | null | undefined): string {
  if (value === null || value === undefined) return '\u2014';
  return value.toFixed(2);
}
