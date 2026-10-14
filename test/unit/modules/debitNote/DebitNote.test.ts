import { describe, expect, it } from 'vitest';
import { EmissionDate } from '../../../../src/domain/invoice/EmissionDate';
import { ValidationError } from '../../../../src/domain/shared/errors';
import { buildDebitNote } from './support';

describe('DebitNote', () => {
  it('calcula totales con la tarifa general por defecto (IVA 15%)', () => {
    const nd = buildDebitNote();
    expect(nd.documentType).toBe('05');
    expect(nd.subtotal).toBe(2);
    expect(nd.taxes).toHaveLength(1);
    expect(nd.taxes[0]).toMatchObject({ taxCode: '2', base: 2, value: 0.3 });
    expect(nd.taxes[0].iva.code).toBe('4');
    expect(nd.total).toBe(2.3);
    expect(nd.payments).toEqual([{ method: '01', amount: 2.3 }]);
  });

  it('agrupa motivos por codigoPorcentaje con tarifas mixtas y redondeo half-up por tarifa', () => {
    const nd = buildDebitNote({
      reasons: [
        { reason: 'Mora', value: 0.05, ivaCode: '4' },
        { reason: 'Gastos', value: 0.05, ivaCode: '4' },
        { reason: 'Exento', value: 3.33, ivaCode: '0' },
        { reason: 'Flete', value: 1.11, ivaCode: '5' },
      ],
    });
    expect(nd.subtotal).toBe(4.54);
    const byCode = Object.fromEntries(nd.taxes.map((t) => [t.iva.code, t]));
    expect(byCode['4']).toMatchObject({ base: 0.1, value: 0.02 }); // 0.015 → 0.02
    expect(byCode['0']).toMatchObject({ base: 3.33, value: 0 });
    expect(byCode['5']).toMatchObject({ base: 1.11, value: 0.06 }); // 0.0555 → 0.06
    expect(nd.totalTax).toBe(0.08);
    expect(nd.total).toBe(4.62);
  });

  it('usa la tarifa del único impuesto declarado y valida base/valor/tarifa', () => {
    const nd = buildDebitNote({
      reasons: [{ reason: 'A', value: 10 }],
      declaredTaxes: [{ taxCode: '2', ivaCode: '2', rate: 12, base: 10, value: 1.2 }],
    });
    expect(nd.taxes[0]).toMatchObject({ base: 10, value: 1.2 });
    expect(nd.total).toBe(11.2);
    expect(() =>
      buildDebitNote({ reasons: [{ reason: 'A', value: 10 }], declaredTaxes: [{ ivaCode: '4', value: 1.6 }] }),
    ).toThrow(/valor del IVA 4 no coincide/);
    expect(() =>
      buildDebitNote({ reasons: [{ reason: 'A', value: 10 }], declaredTaxes: [{ ivaCode: '4', base: 9 }] }),
    ).toThrow(/baseImponible/);
    expect(() =>
      buildDebitNote({ reasons: [{ reason: 'A', value: 10 }], declaredTaxes: [{ ivaCode: '4', rate: 12 }] }),
    ).toThrow(/tarifa 12/);
  });

  it('con varios impuestos declarados y motivos sin código usa las bases declaradas', () => {
    const nd = buildDebitNote({
      reasons: [
        { reason: 'A', value: 7 },
        { reason: 'B', value: 3 },
      ],
      declaredTaxes: [
        { ivaCode: '4', base: 7, value: 1.05 },
        { ivaCode: '0', base: 3, value: 0 },
      ],
    });
    expect(nd.totalTax).toBe(1.05);
    expect(nd.total).toBe(11.05);
    expect(() =>
      buildDebitNote({
        reasons: [{ reason: 'A', value: 10 }],
        declaredTaxes: [
          { ivaCode: '4', base: 7 },
          { ivaCode: '0', base: 2 },
        ],
      }),
    ).toThrow(/suma de bases/);
    expect(() =>
      buildDebitNote({ reasons: [{ reason: 'A', value: 10 }], declaredTaxes: [{ ivaCode: '4' }, { ivaCode: '0' }] }),
    ).toThrow(/baseImponible en cada uno/);
  });

  it('rechaza impuestos inconsistentes', () => {
    const reasons = [{ reason: 'A', value: 1 }];
    expect(() => buildDebitNote({ reasons, declaredTaxes: [{ taxCode: '3', ivaCode: '4' }] })).toThrow(
      /Solo se admite/,
    );
    expect(() => buildDebitNote({ reasons, declaredTaxes: [{ ivaCode: '99' }] })).toThrow(/codigoPorcentaje/);
    expect(() => buildDebitNote({ reasons, declaredTaxes: [{ ivaCode: '4' }, { ivaCode: '4' }] })).toThrow(/repetidos/);
    expect(() =>
      buildDebitNote({ reasons: [{ reason: 'A', value: 1, ivaCode: '4' }], declaredTaxes: [{ ivaCode: '0' }] }),
    ).toThrow(/no corresponde a ningún motivo/);
    expect(() =>
      buildDebitNote({
        reasons: [
          { reason: 'A', value: 1, ivaCode: '4' },
          { reason: 'B', value: 1 },
        ],
      }),
    ).toThrow(/todos los motivos o en ninguno/);
  });

  it('valida motivos', () => {
    expect(() => buildDebitNote({ reasons: [] })).toThrow(/al menos un motivo/);
    expect(() => buildDebitNote({ reasons: [{ reason: ' ', value: 1 }] })).toThrow(/requiere razon/);
    expect(() => buildDebitNote({ reasons: [{ reason: 'A', value: 0 }] })).toThrow(/mayor que cero/);
    expect(() => buildDebitNote({ reasons: [{ reason: 'A', value: -1 }] })).toThrow(ValidationError);
    expect(() => buildDebitNote({ reasons: [{ reason: 'x'.repeat(301), value: 1 }] })).toThrow(/300/);
    expect(buildDebitNote({ reasons: [{ reason: '  Mora  ', value: 1.005 }] }).reasons[0]).toMatchObject({
      reason: 'Mora',
      value: 1.01,
    });
  });

  it('valida el documento modificado', () => {
    const date = EmissionDate.of(1, 10, 2026);
    expect(() =>
      buildDebitNote({ modifiedDocument: { type: '99', number: '001-001-000000001', emissionDate: date } }),
    ).toThrow(/codDocModificado/);
    expect(() =>
      buildDebitNote({ modifiedDocument: { type: '01', number: '001001000000001', emissionDate: date } }),
    ).toThrow(/numDocModificado/);
    expect(() =>
      buildDebitNote({
        modifiedDocument: { type: '01', number: '001-001-000000001', emissionDate: EmissionDate.of(14, 10, 2026) },
      }),
    ).toThrow(/posterior/);
  });

  it('valida comprador y emisor', () => {
    expect(() => buildDebitNote({ buyer: { idType: '05', id: '123', name: 'X' } })).toThrow(/cédula/);
    expect(() => buildDebitNote({ buyer: { idType: '04', id: '123', name: 'X' } })).toThrow(/RUC del comprador/);
    expect(() => buildDebitNote({ buyer: { idType: '05', id: '0106079783', name: '' } })).toThrow(/razonSocial/);
    expect(() => buildDebitNote({ buyer: { idType: '99', id: '1', name: 'X' } })).toThrow(/tipoIdentificacion/);
    expect(() => buildDebitNote({ buyer: { idType: '07', id: '1', name: 'X' } })).toThrow(/Consumidor final/);
    const issuer = (patch: object) => ({ ...buildDebitNote().issuer, ...patch });
    expect(() => buildDebitNote({ issuer: issuer({ ruc: '1' }) })).toThrow(/RUC del emisor/);
    expect(() => buildDebitNote({ issuer: issuer({ emissionPoint: '12' }) })).toThrow(/punto de emisión/);
  });

  it('valida pagos contra el valor total', () => {
    expect(buildDebitNote({ payments: [{ method: '19', amount: 2.3, term: 30, timeUnit: 'dias' }] }).payments).toEqual([
      { method: '19', amount: 2.3, term: 30, timeUnit: 'dias' },
    ]);
    expect(() => buildDebitNote({ payments: [{ method: '01', amount: 2 }] })).toThrow(/suma de pagos/);
    expect(() => buildDebitNote({ payments: [{ method: 'XX', amount: 2.3 }] })).toThrow(/formaPago/);
    expect(() => buildDebitNote({ payments: [{ method: '01', amount: 2.3, term: -1 }] })).toThrow(/plazo/);
  });

  it('limpia la información adicional', () => {
    expect(buildDebitNote({ additionalInfo: { Email: ' a@b.ec ', Vacío: ' ' } }).additionalInfo).toEqual({
      Email: 'a@b.ec',
    });
    const many = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`k${i}`, 'v']));
    expect(() => buildDebitNote({ additionalInfo: many })).toThrow(/15/);
  });
});
