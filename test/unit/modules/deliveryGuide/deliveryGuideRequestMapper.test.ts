import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../../src/domain/shared/errors';
import { toIssueDeliveryGuideCommand } from '../../../../src/modules/deliveryGuide/http/deliveryGuideRequestMapper';

/** Payload que el SRI de pruebas autorizó (mismos nombres de campo que el aporte original). */
const AUTHORIZED_PAYLOAD = {
  guia_remision: {
    infoTributaria: { ruc: '0106079783001', claveAcceso: '', secuencial: '' },
    infoGuiaRemision: {
      fechaEmision: '13/10/2026',
      dirPartida: 'CUENCA',
      razonSocialTransportista: 'MONTERO CAMPOVERDE OSCAR XAVIER',
      tipoIdentificacionTransportista: '05',
      rucTransportista: '0106079783',
      fechaIniTransporte: '13/10/2026',
      fechaFinTransporte: '13/10/2026',
      placa: 'ABC1234',
    },
    destinatarios: [
      {
        destinatario: {
          identificacionDestinatario: '0106079783',
          razonSocialDestinatario: 'MONTERO CAMPOVERDE OSCAR XAVIER',
          dirDestinatario: 'CUENCA',
          motivoTraslado: 'VENTA',
          ruta: 'CUENCA - CUENCA',
          codDocSustento: '01',
          numDocSustento: '001-009-000000001',
          numAutDocSustento: '1310202601010607978300110010090000000019093224818',
          fechaEmisionDocSustento: '13/10/2026',
          detalles: [{ detalle: { codigoInterno: 'PRD001', descripcion: 'Servicio de prueba', cantidad: '1' } }],
        },
      },
    ],
  },
};

const clone = () => JSON.parse(JSON.stringify(AUTHORIZED_PAYLOAD.guia_remision));

describe('toIssueDeliveryGuideCommand', () => {
  it('mapea el payload autorizado por el SRI', () => {
    expect(toIssueDeliveryGuideCommand(AUTHORIZED_PAYLOAD.guia_remision)).toEqual({
      issuerRuc: '0106079783001',
      emissionDate: '13/10/2026',
      departureAddress: 'CUENCA',
      carrier: { idType: '05', id: '0106079783', name: 'MONTERO CAMPOVERDE OSCAR XAVIER' },
      transportStart: '13/10/2026',
      transportEnd: '13/10/2026',
      plate: 'ABC1234',
      recipients: [
        {
          id: '0106079783',
          name: 'MONTERO CAMPOVERDE OSCAR XAVIER',
          address: 'CUENCA',
          transferReason: 'VENTA',
          customsDocument: undefined,
          destinationEstablishment: undefined,
          route: 'CUENCA - CUENCA',
          supportingDocument: {
            type: '01',
            number: '001-009-000000001',
            authorizationNumber: '1310202601010607978300110010090000000019093224818',
            emissionDate: '13/10/2026',
          },
          items: [
            { internalCode: 'PRD001', additionalCode: undefined, description: 'Servicio de prueba', quantity: 1 },
          ],
        },
      ],
      additionalInfo: undefined,
    });
  });

  it('acepta destinatarios y detalles sin envoltorio y cantidades numéricas', () => {
    const g = clone();
    const dest = g.destinatarios[0].destinatario;
    dest.detalles = [{ descripcion: 'X', cantidad: 2.5 }];
    g.destinatarios = [dest];
    const cmd = toIssueDeliveryGuideCommand(g);
    expect(cmd.recipients[0].items[0]).toMatchObject({ description: 'X', quantity: 2.5 });
  });

  it('sin documento de sustento no envía supportingDocument; fechaEmision opcional', () => {
    const g = clone();
    const dest = g.destinatarios[0].destinatario;
    delete dest.codDocSustento;
    delete dest.numDocSustento;
    delete dest.numAutDocSustento;
    delete dest.fechaEmisionDocSustento;
    delete g.infoGuiaRemision.fechaEmision;
    const cmd = toIssueDeliveryGuideCommand(g);
    expect(cmd.recipients[0].supportingDocument).toBeUndefined();
    expect(cmd.emissionDate).toBeUndefined();
  });

  it('infoAdicional como objeto o como lista de campoAdicional', () => {
    const g = clone();
    g.infoAdicional = { Email: 'a@b.ec' };
    expect(toIssueDeliveryGuideCommand(g).additionalInfo).toEqual({ Email: 'a@b.ec' });
    g.infoAdicional = [{ nombre: 'Tel', valor: '099' }, { campoAdicional: { nombre: 'Obs', valor: 'x' } }];
    expect(toIssueDeliveryGuideCommand(g).additionalInfo).toEqual({ Tel: '099', Obs: 'x' });
    g.infoAdicional = 'texto';
    expect(() => toIssueDeliveryGuideCommand(g)).toThrow(ValidationError);
  });

  it.each([
    ['body vacío', () => undefined],
    ['sin ruc', () => ({ ...clone(), infoTributaria: {} })],
    ['sin infoGuiaRemision', () => ({ ...clone(), infoGuiaRemision: undefined })],
    ['sin destinatarios', () => ({ ...clone(), destinatarios: [] })],
    [
      'sin fechaIniTransporte',
      () => {
        const g = clone();
        delete g.infoGuiaRemision.fechaIniTransporte;
        return g;
      },
    ],
    [
      'destinatario sin detalles',
      () => {
        const g = clone();
        g.destinatarios[0].destinatario.detalles = [];
        return g;
      },
    ],
    [
      'cantidad no numérica',
      () => {
        const g = clone();
        g.destinatarios[0].destinatario.detalles[0].detalle.cantidad = 'uno';
        return g;
      },
    ],
    [
      'destinatario nulo',
      () => {
        const g = clone();
        g.destinatarios = [null];
        return g;
      },
    ],
  ])('rechaza %s con ValidationError', (_label, body) => {
    expect(() => toIssueDeliveryGuideCommand(body())).toThrow(ValidationError);
  });
});
