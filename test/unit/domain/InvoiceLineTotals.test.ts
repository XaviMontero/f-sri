import { describe, expect, it } from 'vitest';
import { InvoiceLine } from '../../../src/domain/invoice/InvoiceLine';
import { InvoiceTotals } from '../../../src/domain/invoice/InvoiceTotals';
import { ValidationError } from '../../../src/domain/shared/errors';
import { line } from '../support/builders';

describe('InvoiceLine', () => {
  it('calcula subtotal, base e IVA 15%', () => {
    const l = new InvoiceLine(line({ quantity: 3, unitPrice: 2.5 }));
    expect(l.subtotal).toBe(7.5);
    expect(l.taxBase).toBe(7.5);
    expect(l.taxValue).toBe(1.13); // 1.125 → 1.13 half-up
    expect(l.taxCode).toBe('2');
    expect(l.iva.rate).toBe(15);
  });

  it('aplica el descuento antes del impuesto', () => {
    const l = new InvoiceLine(line({ quantity: 2, unitPrice: 10, discount: 5 }));
    expect(l.subtotal).toBe(15);
    expect(l.taxValue).toBe(2.25);
  });

  it('redondea cantidades/precios a 6 decimales y descuentos a 2', () => {
    const l = new InvoiceLine(line({ quantity: 1.1234567, unitPrice: 0.3333333, discount: 0.005 }));
    expect(l.quantity).toBe(1.123457);
    expect(l.unitPrice).toBe(0.333333);
    expect(l.discount).toBe(0.01);
    expect(l.subtotal).toBe(0.36);
  });

  it('IVA 0% no genera impuesto', () => {
    const l = new InvoiceLine(line({ ivaCode: '0', unitPrice: 99.99 }));
    expect(l.taxValue).toBe(0);
  });

  it('recorta código, descripción y código auxiliar', () => {
    const l = new InvoiceLine(line({ code: '  P1 ', description: ' Pan ', auxiliaryCode: '   ' }));
    expect(l.code).toBe('P1');
    expect(l.description).toBe('Pan');
    expect(l.auxiliaryCode).toBeUndefined();
    expect(new InvoiceLine(line({ auxiliaryCode: ' AUX ' })).auxiliaryCode).toBe('AUX');
  });

  it('permite precio 0 y descuento igual al valor de la línea', () => {
    expect(new InvoiceLine(line({ unitPrice: 0 })).subtotal).toBe(0);
    expect(new InvoiceLine(line({ unitPrice: 10, discount: 10 })).subtotal).toBe(0);
  });

  it.each([
    [{ code: '' }, /codigoPrincipal/],
    [{ code: '   ' }, /codigoPrincipal/],
    [{ description: '' }, /requiere descripción/],
    [{ code: 'X'.repeat(26) }, /excede 25 caracteres/],
    [{ description: 'd'.repeat(301) }, /excede 300 caracteres/],
    [{ quantity: 0 }, /cantidad .* mayor a 0/],
    [{ quantity: -1 }, /cantidad .* mayor a 0/],
    [{ quantity: NaN }, /cantidad .* mayor a 0/],
    [{ unitPrice: -0.01 }, /no puede ser negativo/],
    [{ unitPrice: NaN }, /no puede ser negativo/],
    [{ discount: -1 }, /descuento .* negativo/],
    [{ discount: 10.01 }, /supera el valor de la línea/],
    [{ ivaCode: '1' }, /codigoPorcentaje/],
  ])('rechaza %o', (override, message) => {
    expect(() => new InvoiceLine(line(override))).toThrow(ValidationError);
    expect(() => new InvoiceLine(line(override))).toThrow(message);
  });
});

describe('InvoiceTotals', () => {
  it('agrupa por tarifa (15% y 0%) ordenado por código', () => {
    const totals = new InvoiceTotals([
      new InvoiceLine(line({ code: 'A', unitPrice: 10, ivaCode: '4' })),
      new InvoiceLine(line({ code: 'B', unitPrice: 5, ivaCode: '0' })),
      new InvoiceLine(line({ code: 'C', quantity: 2, unitPrice: 3.33, ivaCode: '4' })),
    ]);
    expect(totals.taxes.map((t) => [t.iva.code, t.base, t.value])).toEqual([
      ['0', 5, 0],
      ['4', 16.66, 2.5], // 1.5 + 0.999 → 1.00
    ]);
    expect(totals.subtotal).toBe(21.66);
    expect(totals.totalTax).toBe(2.5);
    expect(totals.total).toBe(24.16);
    expect(totals.baseFor('4')).toBe(16.66);
    expect(totals.baseFor('0')).toBe(5);
    expect(totals.baseFor('2')).toBe(0);
  });

  it('suma IVA redondeado por línea (como el detalle del XML)', () => {
    const lines = [1, 2, 3].map((i) => new InvoiceLine(line({ code: `L${i}`, unitPrice: 0.1 })));
    const totals = new InvoiceTotals(lines);
    // 0.1 * 15% = 0.015 → 0.02 por línea
    expect(totals.totalTax).toBe(0.06);
    expect(totals.subtotal).toBe(0.3);
    expect(totals.total).toBe(0.36);
  });

  it('acumula descuentos y propina', () => {
    const totals = new InvoiceTotals(
      [
        new InvoiceLine(line({ code: 'A', unitPrice: 20, discount: 2.5 })),
        new InvoiceLine(line({ code: 'B', unitPrice: 10, discount: 1.25, ivaCode: '0' })),
      ],
      1.005,
    );
    expect(totals.totalDiscount).toBe(3.75);
    expect(totals.subtotal).toBe(26.25);
    expect(totals.totalTax).toBe(2.63); // 17.5 * 15% = 2.625 → 2.63
    expect(totals.tip).toBe(1.01);
    expect(totals.total).toBe(29.89);
  });

  it('propina por defecto es 0', () => {
    expect(new InvoiceTotals([new InvoiceLine(line())]).tip).toBe(0);
  });
});
