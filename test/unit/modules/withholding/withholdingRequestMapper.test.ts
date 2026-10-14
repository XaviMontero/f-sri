import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../../src/domain/shared/errors';
import { toIssueWithholdingCommand } from '../../../../src/modules/withholding/http/withholdingRequestMapper';
import { retencionPayload } from './fixtures';

describe('toIssueWithholdingCommand', () => {
  it('mapea el payload autorizado por el SRI (nombres de la ficha técnica) al comando', () => {
    const body = retencionPayload();
    const command = toIssueWithholdingCommand(body);
    expect(command).toEqual({
      issuerRuc: '0106079783001',
      emissionDate: '13/10/2026',
      fiscalPeriod: '10/2026',
      subject: {
        idType: '05',
        id: '0106079783',
        name: 'MONTERO CAMPOVERDE OSCAR XAVIER',
        subjectType: undefined,
        relatedParty: 'NO',
      },
      supportDocuments: [
        {
          supportCode: '01',
          documentType: '01',
          number: '001009000000001',
          emissionDate: '13/10/2026',
          accountingDate: undefined,
          authorizationNumber: '1310202601010607978300110010090000000019093224818',
          paymentLocation: '01',
          subtotal: 10,
          total: 11.5,
          taxes: [{ taxCode: '2', rateCode: '4', base: 10, rate: 15, value: 1.5 }],
          retentions: [{ taxCode: '1', retentionCode: '303', base: 10, percentage: 10, value: 1 }],
          payments: [{ method: '01', amount: 11.5 }],
        },
      ],
      additionalInfo: undefined,
      rawRequest: body.retencion,
    });
  });

  it('acepta ítems sin envolver y valores numéricos; valorRetenido/valorImpuesto opcionales', () => {
    const body = retencionPayload();
    const ds = body.retencion.docsSustento[0].docSustento as Record<string, unknown>;
    ds.impuestosDocSustento = [{ codImpuestoDocSustento: 2, codigoPorcentaje: 4, baseImponible: 10 }];
    ds.retenciones = [{ codigo: 1, codigoRetencion: '332b', baseImponible: 10, porcentajeRetener: 0 }];
    ds.pagos = [{ formaPago: '01', total: 11.5 }];
    const command = toIssueWithholdingCommand({ retencion: { ...body.retencion, docsSustento: [ds] } });
    const [doc] = command.supportDocuments;
    expect(doc.taxes).toEqual([{ taxCode: '2', rateCode: '4', base: 10, rate: undefined, value: undefined }]);
    expect(doc.retentions).toEqual([
      { taxCode: '1', retentionCode: '332B', base: 10, percentage: 0, value: undefined },
    ]);
  });

  it('fechaEmision/periodoFiscal/parteRel vacíos quedan para los valores por defecto del dominio', () => {
    const body = retencionPayload();
    Object.assign(body.retencion.infoCompRetencion, { fechaEmision: '', parteRel: '' });
    delete (body.retencion.infoCompRetencion as Partial<typeof body.retencion.infoCompRetencion>).periodoFiscal;
    const command = toIssueWithholdingCommand(body);
    expect(command.emissionDate).toBeUndefined();
    expect(command.fiscalPeriod).toBeUndefined();
    expect(command.subject.relatedParty).toBeUndefined();
  });

  it.each([
    [undefined, /Withholding data is required/],
    [{}, /Withholding data is required/],
    [{ retencion: { infoTributaria: {}, infoCompRetencion: {}, docsSustento: [{}] } }, /inválidos o incompletos/],
    [{ retencion: { ...retencionPayload().retencion, docsSustento: [] } }, /inválidos o incompletos/],
    [{ retencion: { ...retencionPayload().retencion, docsSustento: [null] } }, /docSustento 1: datos requeridos/],
  ])('rechaza payloads incompletos (%#)', (body, message) => {
    expect(() => toIssueWithholdingCommand(body)).toThrow(ValidationError);
    expect(() => toIssueWithholdingCommand(body)).toThrow(message);
  });

  it('importes no numéricos y listas mal formadas son errores de validación', () => {
    const bad = retencionPayload();
    bad.retencion.docsSustento[0].docSustento.retenciones[0].retencion.porcentajeRetener = 'diez';
    expect(() => toIssueWithholdingCommand(bad)).toThrow(ValidationError);
    expect(() => toIssueWithholdingCommand(bad)).toThrow(/porcentajeRetener no es un número válido/);

    const notArray = retencionPayload();
    (notArray.retencion.docsSustento[0].docSustento as Record<string, unknown>).pagos = { pago: {} };
    expect(() => toIssueWithholdingCommand(notArray)).toThrow(/pago: se esperaba un arreglo/);

    const nullItem = retencionPayload();
    (nullItem.retencion.docsSustento[0].docSustento as Record<string, unknown>).pagos = [null];
    expect(() => toIssueWithholdingCommand(nullItem)).toThrow(/pago: ítem inválido/);

    const missing = retencionPayload();
    delete (missing.retencion.docsSustento[0].docSustento as Record<string, unknown>).retenciones;
    expect(toIssueWithholdingCommand(missing).supportDocuments[0].retentions).toEqual([]);
  });
});
