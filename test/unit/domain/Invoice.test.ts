import { describe, expect, it } from 'vitest';
import { AccessKey } from '../../../src/domain/invoice/AccessKey';
import { FINAL_CONSUMER_MAX_TOTAL, Invoice } from '../../../src/domain/invoice/Invoice';
import { ValidationError } from '../../../src/domain/shared/errors';
import { ISSUER } from '../../helpers/fakes';
import { buildInvoice, invoiceProps, line } from '../support/builders';

const finalConsumer = { idType: '07', id: '9999999999999', name: 'CONSUMIDOR FINAL' };

describe('Invoice (agregado)', () => {
  it('construye una factura válida con totales, serie, número y clave', () => {
    const inv = buildInvoice();
    expect(inv.documentType).toBe('01');
    expect(inv.series).toBe('001001');
    expect(inv.number).toBe('001-001-000000123');
    expect(inv.totals.total).toBe(11.5);
    expect(AccessKey.from(inv.accessKey.value).value).toBe(inv.accessKey.value);
    expect(inv.accessKey.value.slice(0, 8)).toBe('13102026');
    expect(inv.accessKey.value.slice(30, 39)).toBe('000000123');
  });

  it('exige al menos un detalle', () => {
    expect(() => buildInvoice({ lines: [] })).toThrow(/al menos un detalle/);
    expect(() => Invoice.create({ ...invoiceProps(), lines: undefined as never })).toThrow(/al menos un detalle/);
  });

  describe('consumidor final', () => {
    it(`acepta hasta USD ${FINAL_CONSUMER_MAX_TOTAL}`, () => {
      // 43.4783 * 1.15 ≈ 50.00
      const inv = buildInvoice({ buyer: finalConsumer, lines: [line({ unitPrice: 50, ivaCode: '0' })] });
      expect(inv.totals.total).toBe(50);
    });

    it('rechaza totales mayores a USD 50', () => {
      expect(() => buildInvoice({ buyer: finalConsumer, lines: [line({ unitPrice: 50.01, ivaCode: '0' })] })).toThrow(
        /consumidor final no puede superar USD 50 \(total 50.01\)/,
      );
      // 45 + 15% = 51.75
      expect(() => buildInvoice({ buyer: finalConsumer, lines: [line({ unitPrice: 45 })] })).toThrow(/51.75/);
    });

    it('exige la identificación 9999999999999', () => {
      expect(() => buildInvoice({ buyer: { ...finalConsumer, id: '0102030405' } })).toThrow(/9999999999999/);
    });

    it('el límite no aplica a otros tipos de identificación', () => {
      expect(buildInvoice({ lines: [line({ unitPrice: 1000 })] }).totals.total).toBe(1150);
    });
  });

  describe('comprador', () => {
    it.each([
      [{ idType: '05', id: '010203040' }, /cédula .* 10 dígitos/],
      [{ idType: '05', id: '010203040A' }, /cédula .* 10 dígitos/],
      [{ idType: '04', id: '0102030405' }, /RUC del comprador .* 13 dígitos/],
      [{ idType: '01', id: '0102030405' }, /tipoIdentificacionComprador inválido/],
      [{ idType: '05', id: '   ' }, /identificacionComprador es requerida/],
      [{ idType: '05', id: '0102030405', name: '  ' }, /razonSocialComprador es requerida/],
    ])('rechaza %o', (buyer, message) => {
      expect(() => buildInvoice({ buyer: { name: 'X', ...buyer } })).toThrow(message);
    });

    it('acepta RUC de 13 dígitos, pasaporte libre y recorta espacios', () => {
      expect(buildInvoice({ buyer: { idType: '04', id: '0190000000001', name: 'ACME' } }).buyer.id).toBe(
        '0190000000001',
      );
      const inv = buildInvoice({ buyer: { idType: '06', id: ' AB12345 ', name: '  John Doe ' } });
      expect(inv.buyer).toMatchObject({ id: 'AB12345', name: 'John Doe' });
    });
  });

  describe('emisor', () => {
    it.each([
      [{ ruc: '123' }, /RUC del emisor/],
      [{ establishment: '1' }, /establecimiento/],
      [{ emissionPoint: '0011' }, /punto de emisión/],
      [{ businessName: ' ' }, /razón social/],
      [{ headOfficeAddress: '' }, /dirección matriz/],
      [{ environment: '3' as never }, /ambiente/],
    ])('rechaza %o', (override, message) => {
      expect(() => buildInvoice({ issuer: { ...ISSUER, ...override } })).toThrow(message);
    });
  });

  describe('pagos', () => {
    it('por defecto un único pago 01 por el total', () => {
      const inv = buildInvoice();
      expect(inv.payments).toEqual([{ method: '01', amount: 11.5 }]);
    });

    it('acepta pagos que suman el total y los redondea', () => {
      const inv = buildInvoice({
        payments: [
          { method: '19', amount: 5.004, term: 30, timeUnit: 'dias' },
          { method: '01', amount: 6.5 },
        ],
      });
      expect(inv.payments).toEqual([
        { method: '19', amount: 5, term: 30, timeUnit: 'dias' },
        { method: '01', amount: 6.5 },
      ]);
    });

    it('rechaza si la suma no coincide con el total', () => {
      expect(() => buildInvoice({ payments: [{ method: '01', amount: 11 }] })).toThrow(
        /suma de pagos \(11.00\) no coincide con el importe total \(11.50\)/,
      );
    });

    it('rechaza forma de pago inválida y montos negativos', () => {
      expect(() => buildInvoice({ payments: [{ method: '99', amount: 11.5 }] })).toThrow(/formaPago inválida/);
      expect(() =>
        buildInvoice({
          payments: [
            { method: '01', amount: -1 },
            { method: '01', amount: 12.5 },
          ],
        }),
      ).toThrow(/debe ser positivo/);
    });

    it('la propina entra en el total y en el pago por defecto', () => {
      const inv = buildInvoice({ tip: 1 });
      expect(inv.totals.total).toBe(12.5);
      expect(inv.payments[0].amount).toBe(12.5);
    });
  });

  describe('información adicional', () => {
    it('descarta claves/valores vacíos y recorta', () => {
      const inv = buildInvoice({
        additionalInfo: { ' Email ': ' a@b.com ', Vacio: '  ', '': 'x', Nulo: null as never, Num: 5 as never },
      });
      expect(inv.additionalInfo).toEqual({ Email: 'a@b.com', Num: '5' });
    });

    it('admite 15 campos y rechaza 16', () => {
      const info = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, `v${i}`]));
      expect(Object.keys(buildInvoice({ additionalInfo: info(15) }).additionalInfo)).toHaveLength(15);
      expect(() => buildInvoice({ additionalInfo: info(16) })).toThrow(/Máximo 15/);
    });

    it('los vacíos no cuentan para el máximo', () => {
      const info: Record<string, string> = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`k${i}`, 'v']));
      info.vacio = '';
      expect(Object.keys(buildInvoice({ additionalInfo: info }).additionalInfo)).toHaveLength(15);
    });
  });

  it('valida secuencial y código numérico a través de la clave de acceso', () => {
    expect(() => buildInvoice({ sequential: '12' })).toThrow(ValidationError);
    expect(() => buildInvoice({ numericCode: 'abc' })).toThrow(/numericCode/);
  });
});
