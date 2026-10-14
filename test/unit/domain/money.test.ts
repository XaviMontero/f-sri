import { describe, expect, it } from 'vitest';
import { formatDecimal, formatMoney, parseAmount, round2, roundTo } from '../../../src/domain/shared/money';

describe('money', () => {
  describe('round2', () => {
    it.each([
      [1.005, 1.01],
      [1.015, 1.02],
      [2.675, 2.68],
      [0.1 + 0.2, 0.3],
      [1.234, 1.23],
      [1.235, 1.24],
      [10, 10],
      [0, 0],
      [8.345, 8.35],
    ])('round2(%d) = %d (half-up sin errores de coma flotante)', (input, expected) => {
      expect(round2(input)).toBe(expected);
    });
  });

  it('roundTo redondea half-up a n decimales', () => {
    expect(roundTo(1.0000005, 6)).toBe(1.000001);
    expect(roundTo(3.14159265, 4)).toBe(3.1416);
    expect(roundTo(2.5, 0)).toBe(3);
  });

  it('formatMoney siempre deja 2 decimales', () => {
    expect(formatMoney(12.5)).toBe('12.50');
    expect(formatMoney(0)).toBe('0.00');
    expect(formatMoney(1.005)).toBe('1.01');
    expect(formatMoney(1234.567)).toBe('1234.57');
  });

  describe('formatDecimal', () => {
    it.each([
      [1, '1.00'],
      [1.5, '1.50'],
      [1.25, '1.25'],
      [1.125, '1.125'],
      [0.123456, '0.123456'],
      [0.1234567, '0.123457'],
      [10.1000001, '10.10'],
      [0, '0.00'],
    ])('formatDecimal(%d) = %s', (input, expected) => {
      expect(formatDecimal(input)).toBe(expected);
    });

    it('respeta maxDecimals', () => {
      expect(formatDecimal(15, 2)).toBe('15.00');
      expect(formatDecimal(1.236, 2)).toBe('1.24');
    });
  });

  describe('parseAmount', () => {
    it('acepta números y strings numéricos', () => {
      expect(parseAmount(12.5, 'x')).toBe(12.5);
      expect(parseAmount('12.5', 'x')).toBe(12.5);
      expect(parseAmount(' 3 ', 'x')).toBe(3);
      expect(parseAmount('0', 'x')).toBe(0);
    });

    it.each([undefined, null, '', '   ', 'abc', '12,5', NaN, Infinity, {}, []])(
      'rechaza %s indicando el campo',
      (value) => {
        expect(() => parseAmount(value, 'cantidad')).toThrow(/cantidad no es un número válido/);
      },
    );
  });
});
