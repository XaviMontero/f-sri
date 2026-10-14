import { describe, expect, it } from 'vitest';
import { EmissionDate } from '../../../src/domain/invoice/EmissionDate';
import { ValidationError } from '../../../src/domain/shared/errors';

describe('EmissionDate', () => {
  describe('parse', () => {
    it('acepta dd/mm/aaaa (formato SRI)', () => {
      const d = EmissionDate.parse('13/10/2026');
      expect([d.day, d.month, d.year]).toEqual([13, 10, 2026]);
    });

    it('acepta día y mes de un dígito', () => {
      expect(EmissionDate.parse('1/2/2026').toSriFormat()).toBe('01/02/2026');
    });

    it('acepta ISO aaaa-mm-dd', () => {
      expect(EmissionDate.parse('2026-10-13').toSriFormat()).toBe('13/10/2026');
    });

    it('ignora espacios al inicio y al final', () => {
      expect(EmissionDate.parse('  13/10/2026 ').toSriFormat()).toBe('13/10/2026');
    });

    it.each(['31/02/2026', '29/02/2025', '00/01/2026', '32/01/2026', '15/13/2026', '2026-02-30'])(
      'rechaza la fecha imposible %s',
      (value) => {
        expect(() => EmissionDate.parse(value)).toThrow(ValidationError);
        expect(() => EmissionDate.parse(value)).toThrow(/Fecha de emisión inválida/);
      },
    );

    it('acepta el 29 de febrero de un año bisiesto', () => {
      expect(EmissionDate.parse('29/02/2028').toSriFormat()).toBe('29/02/2028');
    });

    it.each(['2026/10/13', '13-10-2026', '13/10/26', 'hoy', '', '2026-10-13T00:00:00Z'])(
      'rechaza el formato "%s"',
      (value) => {
        expect(() => EmissionDate.parse(value)).toThrow(/Formato de fecha inválido/);
      },
    );

    it('rechaza null/undefined con error de validación', () => {
      expect(() => EmissionDate.parse(undefined as unknown as string)).toThrow(ValidationError);
    });
  });

  describe('todayInEcuador', () => {
    it('antes de las 05:00 UTC sigue siendo el día anterior en Ecuador', () => {
      expect(EmissionDate.todayInEcuador(new Date('2026-10-14T04:59:59Z')).toSriFormat()).toBe('13/10/2026');
    });

    it('a partir de las 05:00 UTC ya es el día siguiente en Ecuador', () => {
      expect(EmissionDate.todayInEcuador(new Date('2026-10-14T05:00:00Z')).toSriFormat()).toBe('14/10/2026');
    });

    it('cruza correctamente el cambio de año', () => {
      expect(EmissionDate.todayInEcuador(new Date('2027-01-01T03:00:00Z')).toSriFormat()).toBe('31/12/2026');
    });

    it('usa la hora actual por defecto', () => {
      expect(EmissionDate.todayInEcuador().toSriFormat()).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
    });
  });

  it('toDate devuelve medianoche UTC del día civil', () => {
    expect(EmissionDate.of(5, 3, 2026).toDate().toISOString()).toBe('2026-03-05T00:00:00.000Z');
  });
});
