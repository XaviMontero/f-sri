import { describe, expect, it } from 'vitest';
import {
  assertBuyerIdType,
  assertPaymentMethod,
  BUYER_ID_TYPES,
  DEFAULT_IVA_CODE,
  DEFAULT_PAYMENT_METHOD,
  FINAL_CONSUMER_ID,
  ivaRate,
  PAYMENT_METHODS,
} from '../../../src/domain/invoice/catalogs';
import { InvoiceStatus, isFinalStatus } from '../../../src/domain/invoice/InvoiceStatus';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../src/domain/shared/errors';

describe('catálogos SRI', () => {
  it.each([
    ['0', 0],
    ['2', 12],
    ['3', 14],
    ['4', 15],
    ['5', 5],
    ['6', 0],
    ['7', 0],
    ['10', 13],
  ])('codigoPorcentaje %s → tarifa %d%%', (code, rate) => {
    expect(ivaRate(code).rate).toBe(rate);
    expect(ivaRate(code).code).toBe(code);
  });

  it('la tarifa por defecto es 15% (código 4)', () => {
    expect(ivaRate(DEFAULT_IVA_CODE).rate).toBe(15);
  });

  it('rechaza codigoPorcentaje desconocido listando los válidos', () => {
    expect(() => ivaRate('1')).toThrow(ValidationError);
    expect(() => ivaRate('99')).toThrow(/válidos: 0, 2, 3, 4/);
  });

  it('tipos de identificación del comprador (tabla 6)', () => {
    expect(Object.keys(BUYER_ID_TYPES)).toEqual(['04', '05', '06', '07', '08']);
    expect(() => assertBuyerIdType('05')).not.toThrow();
    expect(() => assertBuyerIdType('01')).toThrow(/tipoIdentificacionComprador inválido/);
    expect(FINAL_CONSUMER_ID).toBe('9999999999999');
  });

  it('formas de pago (tabla 24)', () => {
    expect(PAYMENT_METHODS[DEFAULT_PAYMENT_METHOD]).toBe('SIN UTILIZACION DEL SISTEMA FINANCIERO');
    expect(() => assertPaymentMethod('19')).not.toThrow();
    expect(() => assertPaymentMethod('02')).toThrow(/formaPago inválida/);
  });

  it('solo AUTORIZADO es estado final', () => {
    expect(isFinalStatus(InvoiceStatus.AUTHORIZED)).toBe(true);
    for (const s of Object.values(InvoiceStatus).filter((s) => s !== InvoiceStatus.AUTHORIZED)) {
      expect(isFinalStatus(s)).toBe(false);
    }
  });

  it('errores de dominio exponen httpStatus y name', () => {
    expect(new ValidationError('x')).toMatchObject({ httpStatus: 400, name: 'ValidationError', message: 'x' });
    expect(new ForbiddenError('x')).toMatchObject({ httpStatus: 403, name: 'ForbiddenError' });
    expect(new NotFoundError('x')).toMatchObject({ httpStatus: 404, name: 'NotFoundError' });
    expect(new NotFoundError('x', 400).httpStatus).toBe(400);
  });
});
