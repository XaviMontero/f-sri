import { describe, expect, it } from 'vitest';
import { EmissionDate } from '../../../../src/domain/invoice/EmissionDate';
import { ValidationError } from '../../../../src/domain/shared/errors';
import { CreditNote } from '../../../../src/modules/creditNote/domain/CreditNote';
import { creditNoteProps, ncLine, numberedCreditNote } from './support';

const build = (overrides: Parameters<typeof creditNoteProps>[0] = {}) => CreditNote.create(creditNoteProps(overrides));

describe('CreditNote (dominio)', () => {
  it('calcula totales del caso autorizado por el SRI: 10.00 + 15% = 11.50', () => {
    const nc = build();
    expect(nc.documentType).toBe('04');
    expect(nc.totals.subtotal).toBe(10);
    expect(nc.totals.totalTax).toBe(1.5);
    expect(nc.modificationValue).toBe(11.5);
  });

  it('agrupa impuestos por tarifa con líneas mixtas 15% y 0%', () => {
    const nc = build({
      lines: [
        ncLine({ code: 'A', quantity: 2, unitPrice: 10, ivaCode: '4' }),
        ncLine({ code: 'B', quantity: 1, unitPrice: 5.5, ivaCode: '0' }),
        ncLine({ code: 'C', quantity: 3, unitPrice: 1.333333, discount: 0.5, ivaCode: '4' }),
      ],
    });
    // A = 20.00, C = 3.999999 → 4.00 − 0.50 = 3.50; base 15% = 23.50 (IVA 3.00 + 0.53), base 0% = 5.50
    expect(nc.totals.taxes.map((t) => [t.iva.code, t.base, t.value])).toEqual([
      ['0', 5.5, 0],
      ['4', 23.5, 3.53],
    ]);
    expect(nc.totals.subtotal).toBe(29);
    expect(nc.modificationValue).toBe(32.53);
  });

  it('exige al menos un detalle', () => {
    expect(() => build({ lines: [] })).toThrow(ValidationError);
  });

  it.each([
    ['00', 'codDocModificado inválido'],
    ['04', 'codDocModificado inválido'],
    ['', 'codDocModificado inválido'],
  ])('rechaza codDocModificado %j', (type, message) => {
    expect(() =>
      build({ modifiedDocument: { type, number: '001-001-000000001', emissionDate: EmissionDate.of(1, 10, 2026) } }),
    ).toThrow(message);
  });

  it.each(['001001000000001', '1-1-1', '001-001-00000001', '001-001-0000000001', 'abc-def-ghijklmno'])(
    'rechaza numDocModificado con formato inválido %j',
    (number) => {
      expect(() =>
        build({ modifiedDocument: { type: '01', number, emissionDate: EmissionDate.of(1, 10, 2026) } }),
      ).toThrow(/numDocModificado inválido/);
    },
  );

  it('acepta liquidación de compra (03) y nota de débito (05)', () => {
    for (const type of ['01', '03', '05']) {
      const nc = build({
        modifiedDocument: { type, number: '001-001-000000001', emissionDate: EmissionDate.of(1, 10, 2026) },
      });
      expect(nc.modifiedDocument.type).toBe(type);
    }
  });

  it('la fecha del documento de sustento no puede ser posterior a la emisión', () => {
    expect(() =>
      build({
        emissionDate: EmissionDate.of(13, 10, 2026),
        modifiedDocument: { type: '01', number: '001-001-000000001', emissionDate: EmissionDate.of(14, 10, 2026) },
      }),
    ).toThrow(/no puede ser posterior/);
  });

  it('exige motivo (máx. 300)', () => {
    expect(() => build({ reason: '   ' })).toThrow(/motivo/);
    expect(() => build({ reason: 'x'.repeat(301) })).toThrow(/300/);
    expect(build({ reason: '  DEVOLUCION  ' }).reason).toBe('DEVOLUCION');
  });

  it('no admite consumidor final y valida cédula/RUC del comprador', () => {
    expect(() => build({ buyer: { idType: '07', id: '9999999999999', name: 'CONSUMIDOR FINAL' } })).toThrow(
      /consumidor final/,
    );
    expect(() => build({ buyer: { idType: '05', id: '123', name: 'X' } })).toThrow(/cédula/);
    expect(() => build({ buyer: { idType: '04', id: '123', name: 'X' } })).toThrow(/RUC/);
    expect(() => build({ buyer: { idType: '05', id: '0106079783', name: ' ' } })).toThrow(/razonSocialComprador/);
    expect(() => build({ buyer: { idType: '99', id: '0106079783', name: 'X' } })).toThrow(ValidationError);
  });

  it('valida el emisor', () => {
    const issuer = creditNoteProps().issuer;
    expect(() => build({ issuer: { ...issuer, ruc: '123' } })).toThrow(/RUC del emisor/);
    expect(() => build({ issuer: { ...issuer, emissionPoint: '11' } })).toThrow(/punto de emisión/);
  });

  it('limpia info adicional y limita a 15 campos', () => {
    expect(build({ additionalInfo: { Email: ' a@b.com ', Vacio: '  ' } }).additionalInfo).toEqual({ Email: 'a@b.com' });
    const many = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`k${i}`, 'v']));
    expect(() => build({ additionalInfo: many })).toThrow(/15/);
  });

  it('el borrador no tiene numeración; numbered() asigna secuencial y clave de acceso', () => {
    const draft = build();
    expect(draft.isNumbered).toBe(false);
    expect(() => draft.sequential).toThrow(/secuencial/);
    const nc = numberedCreditNote({}, '000000042');
    expect(nc.isNumbered).toBe(true);
    expect(nc.number).toBe('001-001-000000042');
    expect(nc.accessKey.value).toHaveLength(49);
    expect(nc.accessKey.value.slice(8, 10)).toBe('04');
  });
});
