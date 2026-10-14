import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../../src/domain/shared/errors';
import { toIssueCreditNoteCommand } from '../../../../src/modules/creditNote/http/creditNoteRequestMapper';

/** Payload que el SRI autorizó con la versión anterior (mismos nombres de campo). */
function authorizedPayload() {
  return {
    infoTributaria: { ruc: '0106079783001', claveAcceso: '', secuencial: '' },
    infoNotaCredito: {
      fechaEmision: '13/10/2026',
      tipoIdentificacionComprador: '05',
      identificacionComprador: '0106079783',
      razonSocialComprador: 'MONTERO CAMPOVERDE OSCAR XAVIER',
      codDocModificado: '01',
      numDocModificado: '001-009-000000001',
      fechaEmisionDocSustento: '13/10/2026',
      totalSinImpuestos: '10.00',
      valorModificacion: '11.50',
      moneda: 'DOLAR',
      motivo: 'DEVOLUCION DE PRUEBA',
    },
    detalles: [
      {
        detalle: {
          codigoInterno: 'PRD001',
          descripcion: 'Servicio de prueba',
          cantidad: '1',
          precioUnitario: '10.00',
          descuento: '0.00',
          precioTotalSinImpuesto: '10.00',
          impuestos: [
            {
              impuesto: { codigo: '2', codigoPorcentaje: '4', tarifa: '15', baseImponible: '10.00', valor: '1.50' },
            },
          ],
        },
      },
    ],
  } as any;
}

describe('toIssueCreditNoteCommand', () => {
  it('mapea el payload autorizado por el SRI (formato de la versión anterior)', () => {
    const cmd = toIssueCreditNoteCommand(authorizedPayload());
    expect(cmd).toMatchObject({
      issuerRuc: '0106079783001',
      emissionDate: '13/10/2026',
      buyer: { idType: '05', id: '0106079783', name: 'MONTERO CAMPOVERDE OSCAR XAVIER' },
      modifiedDocument: { type: '01', number: '001-009-000000001', emissionDate: '13/10/2026' },
      reason: 'DEVOLUCION DE PRUEBA',
      lines: [
        {
          code: 'PRD001',
          description: 'Servicio de prueba',
          quantity: 1,
          unitPrice: 10,
          discount: 0,
          ivaCode: '4',
          expectedSubtotal: 10,
        },
      ],
      expectedTotals: { subtotal: 10, total: 11.5 },
    });
  });

  it('acepta codigoPrincipal como alias, codigoAdicional y detalles sin envoltorio', () => {
    const p = authorizedPayload();
    p.detalles = [{ codigoPrincipal: 'X1', codigoAdicional: 'AUX', cantidad: 2, impuestos: [{ codigoPorcentaje: 0 }] }];
    const [line] = toIssueCreditNoteCommand(p).lines;
    expect(line).toMatchObject({ code: 'X1', auxiliaryCode: 'AUX', quantity: 2, ivaCode: '0' });
    expect(line.unitPrice).toBeUndefined();
    expect(line.expectedSubtotal).toBeUndefined();
  });

  it('fechaEmision vacía → por defecto (hoy)', () => {
    const p = authorizedPayload();
    p.infoNotaCredito.fechaEmision = '';
    expect(toIssueCreditNoteCommand(p).emissionDate).toBeUndefined();
  });

  it('infoAdicional como objeto o lista de { nombre, valor }', () => {
    const p = authorizedPayload();
    p.infoAdicional = { Email: 'a@b.com' };
    expect(toIssueCreditNoteCommand(p).additionalInfo).toEqual({ Email: 'a@b.com' });
    p.infoAdicional = [{ nombre: 'Email', valor: 'a@b.com' }, { campoAdicional: { nombre: 'Tel', valor: '099' } }];
    expect(toIssueCreditNoteCommand(p).additionalInfo).toEqual({ Email: 'a@b.com', Tel: '099' });
    p.infoAdicional = 'x';
    expect(() => toIssueCreditNoteCommand(p)).toThrow(ValidationError);
  });

  it.each([
    [undefined, 'Credit note data is required'],
    [{}, 'inválidos o incompletos'],
  ])('rechaza cuerpo inválido %#', (body, message) => {
    expect(() => toIssueCreditNoteCommand(body)).toThrow(message);
  });

  it.each(['codDocModificado', 'numDocModificado', 'fechaEmisionDocSustento', 'motivo'])('exige %s', (field) => {
    const p = authorizedPayload();
    delete p.infoNotaCredito[field];
    expect(() => toIssueCreditNoteCommand(p)).toThrow(`${field} es requerido`);
  });

  it('exige identificación del comprador y detalles', () => {
    const p = authorizedPayload();
    delete p.infoNotaCredito.identificacionComprador;
    expect(() => toIssueCreditNoteCommand(p)).toThrow(/identificacionComprador/);
    const q = authorizedPayload();
    q.detalles = [];
    expect(() => toIssueCreditNoteCommand(q)).toThrow(ValidationError);
  });

  it('rechaza importes no numéricos, impuestos distintos de IVA y otra moneda como 400', () => {
    const p = authorizedPayload();
    p.detalles[0].detalle.cantidad = 'uno';
    expect(() => toIssueCreditNoteCommand(p)).toThrow(ValidationError);
    const q = authorizedPayload();
    q.detalles[0].detalle.impuestos[0].impuesto.codigo = '3';
    expect(() => toIssueCreditNoteCommand(q)).toThrow(/solo se admite el impuesto IVA/);
    const r = authorizedPayload();
    r.infoNotaCredito.moneda = 'EURO';
    expect(() => toIssueCreditNoteCommand(r)).toThrow(/DOLAR/);
    const s = authorizedPayload();
    s.detalles[0].detalle = { cantidad: '1' };
    expect(() => toIssueCreditNoteCommand(s)).toThrow(/codigoInterno/);
  });
});
