import { describe, expect, it } from 'vitest';
import { AccessKey, AccessKeyParts } from '../../../src/domain/invoice/AccessKey';
import { ValidationError } from '../../../src/domain/shared/errors';

const parts = (overrides: Partial<AccessKeyParts> = {}): AccessKeyParts => ({
  emissionDate: { day: 13, month: 10, year: 2026 },
  documentType: '01',
  ruc: '0106079783001',
  environment: '1',
  series: '001001',
  sequential: '000000123',
  numericCode: '12345678',
  emissionType: '1',
  ...overrides,
});

/** Implementación de referencia independiente del módulo 11 (ficha técnica SRI). */
function referenceCheckDigit(base: string): string {
  const digits = base.split('').reverse().map(Number);
  const sum = digits.reduce((acc, d, i) => acc + d * (2 + (i % 6)), 0);
  const r = 11 - (sum % 11);
  return r === 11 ? '0' : r === 10 ? '1' : String(r);
}

describe('AccessKey', () => {
  describe('generate', () => {
    it('genera 49 dígitos con la estructura fecha+codDoc+ruc+ambiente+serie+secuencial+código+tipoEmisión+DV', () => {
      const key = AccessKey.generate(parts());
      expect(key.value).toMatch(/^\d{49}$/);
      expect(key.value.slice(0, 8)).toBe('13102026');
      expect(key.value.slice(8, 10)).toBe('01');
      expect(key.value.slice(10, 23)).toBe('0106079783001');
      expect(key.value.slice(23, 24)).toBe('1');
      expect(key.value.slice(24, 30)).toBe('001001');
      expect(key.value.slice(30, 39)).toBe('000000123');
      expect(key.value.slice(39, 47)).toBe('12345678');
      expect(key.value.slice(47, 48)).toBe('1');
      expect(key.value[48]).toBe(referenceCheckDigit(key.value.slice(0, 48)));
      expect(key.toString()).toBe(key.value);
    });

    it('rellena con ceros día y mes de un dígito', () => {
      const key = AccessKey.generate(parts({ emissionDate: { day: 1, month: 2, year: 2026 } }));
      expect(key.value.slice(0, 8)).toBe('01022026');
    });

    it.each([
      ['documentType', { documentType: '1' }],
      ['ruc', { ruc: '010607978300' }],
      ['ruc', { ruc: '01060797830A1' }],
      ['environment', { environment: '12' }],
      ['series', { series: '0010' }],
      ['sequential', { sequential: '123' }],
      ['numericCode', { numericCode: '1234567' }],
      ['emissionType', { emissionType: '' }],
    ])('rechaza %s inválido', (name, override) => {
      expect(() => AccessKey.generate(parts(override as Partial<AccessKeyParts>))).toThrow(ValidationError);
      expect(() => AccessKey.generate(parts(override as Partial<AccessKeyParts>))).toThrow(name);
    });

    it('la clave generada se puede reconstruir con from()', () => {
      const key = AccessKey.generate(parts());
      expect(AccessKey.from(key.value).value).toBe(key.value);
    });
  });

  describe('checkDigit (módulo 11)', () => {
    it('caso normal: 11 - (suma % 11)', () => {
      // suma = 1*2 = 2 → 11 - 2 = 9
      expect(AccessKey.checkDigit('0'.repeat(47) + '1')).toBe('9');
    });

    it('cuando el resultado es 11 devuelve 0', () => {
      // suma = 0 → 11
      expect(AccessKey.checkDigit('0'.repeat(48))).toBe('0');
    });

    it('cuando el resultado es 10 devuelve 1', () => {
      // suma = 6*2 = 12 → 12 % 11 = 1 → 10
      expect(AccessKey.checkDigit('0'.repeat(47) + '6')).toBe('1');
    });

    it('los pesos 2..7 se repiten cíclicamente de derecha a izquierda', () => {
      // posición 7 desde la derecha vuelve a pesar 2: 1*2 = 2 → 9
      expect(AccessKey.checkDigit('0'.repeat(41) + '1' + '000000')).toBe('9');
      // posición 6 pesa 7: 1*7 = 7 → 4
      expect(AccessKey.checkDigit('0'.repeat(42) + '1' + '00000')).toBe('4');
    });

    it('coincide con la implementación de referencia para claves aleatorias', () => {
      let seed = 42;
      const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let n = 0; n < 200; n++) {
        const base = Array.from({ length: 48 }, () => Math.floor(rnd() * 10)).join('');
        expect(AccessKey.checkDigit(base)).toBe(referenceCheckDigit(base));
      }
    });
  });

  describe('from', () => {
    it('acepta una clave válida', () => {
      const valid = '0'.repeat(48) + '0';
      expect(AccessKey.from(valid).value).toBe(valid);
    });

    it.each(['', '123', '0'.repeat(50), 'a'.repeat(49)])('rechaza longitud/formato inválido "%s"', (value) => {
      expect(() => AccessKey.from(value)).toThrow('49 dígitos');
    });

    it('rechaza dígito verificador incorrecto', () => {
      expect(() => AccessKey.from('0'.repeat(48) + '5')).toThrow(/Dígito verificador/);
    });
  });

  describe('randomNumericCode', () => {
    it('rellena con ceros a la izquierda', () => {
      expect(AccessKey.randomNumericCode(() => 0)).toBe('00000000');
      expect(AccessKey.randomNumericCode(() => 0.00000123)).toBe('00000123');
    });

    it('nunca excede 8 dígitos', () => {
      expect(AccessKey.randomNumericCode(() => 0.999999999)).toBe('99999999');
    });

    it('usa Math.random por defecto', () => {
      expect(AccessKey.randomNumericCode()).toMatch(/^\d{8}$/);
    });
  });
});
