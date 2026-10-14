import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../../src/domain/shared/errors';
import { toIssueDebitNoteCommand } from '../../../../src/modules/debitNote/http/debitNoteRequestMapper';
import { ndPayload } from './support';

describe('toIssueDebitNoteCommand', () => {
  it('mapea el payload autorizado por el SRI', () => {
    const cmd = toIssueDebitNoteCommand(ndPayload());
    expect(cmd).toMatchObject({
      issuerRuc: '0106079783001',
      emissionDate: '13/10/2026',
      buyer: { idType: '05', id: '0106079783', name: 'MONTERO CAMPOVERDE OSCAR XAVIER' },
      modifiedDocument: { type: '01', number: '001-009-000000001', emissionDate: '13/10/2026' },
      reasons: [{ reason: 'INTERES POR MORA DE PRUEBA', value: 2, ivaCode: undefined }],
      declaredTaxes: [{ taxCode: '2', ivaCode: '4', rate: 15, base: 2, value: 0.3 }],
      payments: [{ method: '01', amount: 2.3, term: 0, timeUnit: 'dias' }],
      expectedTotals: { subtotal: 2, total: 2.3 },
    });
    expect(cmd.rawRequest).toEqual(ndPayload().nota_debito);
  });

  it('acepta elementos sin envoltura, códigos por motivo y omite opcionales', () => {
    const cmd = toIssueDebitNoteCommand(
      ndPayload({
        info: {
          fechaEmision: '',
          impuestos: undefined,
          pagos: undefined,
          totalSinImpuestos: undefined,
          valorTotal: '',
        },
        motivos: [{ razon: 'A', valor: 1, codigoPorcentaje: 0 }],
      }),
    );
    expect(cmd.emissionDate).toBeUndefined();
    expect(cmd.reasons).toEqual([{ reason: 'A', value: 1, ivaCode: '0' }]);
    expect(cmd.declaredTaxes).toBeUndefined();
    expect(cmd.payments).toBeUndefined();
    expect(cmd.expectedTotals).toEqual({ subtotal: undefined, total: undefined });
  });

  it.each([
    [undefined, /nota_debito/],
    [{ nota_debito: { infoNotaDebito: {}, motivos: [] } }, /inválidos o incompletos/],
    [ndPayload({ motivos: [] }), /al menos un motivo/],
    [ndPayload({ info: { identificacionComprador: '' } }), /identificacionComprador/],
    [ndPayload({ info: { numDocModificado: undefined } }), /numDocModificado/],
    [ndPayload({ info: { impuestos: 'x' } }), /impuestos debe ser una lista/],
    [ndPayload({ info: { pagos: {} } }), /pagos debe ser una lista/],
    [ndPayload({ motivos: [{ motivo: { razon: 'A', valor: 'abc' } }] }), /valor del motivo 1/],
    [ndPayload({ motivos: [null] }), /motivo 1 es inválido/],
    [ndPayload({ info: { impuestos: [{ impuesto: { codigo: '2' } }] } }), /requiere codigoPorcentaje/],
    [ndPayload({ info: { pagos: [{ pago: { total: '1' } }] } }), /requiere formaPago/],
    [ndPayload({ info: { valorTotal: 'x' } }), /valorTotal/],
  ])('rechaza payload inválido %#', (body, message) => {
    expect(() => toIssueDebitNoteCommand(body)).toThrow(ValidationError);
    expect(() => toIssueDebitNoteCommand(body)).toThrow(message);
  });

  it('infoAdicional debe ser un objeto', () => {
    const body = ndPayload();
    (body.nota_debito as Record<string, unknown>).infoAdicional = ['x'];
    expect(() => toIssueDebitNoteCommand(body)).toThrow(/infoAdicional/);
    (body.nota_debito as Record<string, unknown>).infoAdicional = { Email: 'a@b.ec' };
    expect(toIssueDebitNoteCommand(body).additionalInfo).toEqual({ Email: 'a@b.ec' });
  });
});
