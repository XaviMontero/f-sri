import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { clearMongo, startMongo, stopMongo } from '../../helpers/mongo';
import { testCertificate } from '../../helpers/certificate';
import { authorized, ScriptedSri } from '../../helpers/fakes';
import { authFor, moduleApp } from '../../helpers/moduleApp';
import { silentLogger } from '../../../src/application/ports/runtime';
import { MongoCertificateStore } from '../../../src/infrastructure/certificates/MongoCertificateStore';
import { MongoBuyerRepository } from '../../../src/infrastructure/persistence/MongoBuyerRepository';
import { MongoIssuerRepository } from '../../../src/infrastructure/persistence/MongoIssuerRepository';
import { MongoProductRepository } from '../../../src/infrastructure/persistence/MongoProductRepository';
import { MongoSequenceGenerator } from '../../../src/infrastructure/persistence/MongoSequenceGenerator';
import { FirmaEcXadesSigner } from '../../../src/infrastructure/signing/FirmaEcXadesSigner';
import IssuingCompany from '../../../src/models/IssuingCompany';
import { createDeliveryGuideModule } from '../../../src/modules/deliveryGuide';
import { DeliveryNoteModel } from '../../../src/modules/deliveryGuide/infrastructure/MongoDeliveryGuideRepository';
import { encrypt } from '../../../src/utils/encryption.utils';

const RUC_A = '0106079783001';
const RUC_B = '1790000000001';

function buildApp(sri: ScriptedSri) {
  const module = createDeliveryGuideModule({
    issuers: new MongoIssuerRepository(),
    buyers: new MongoBuyerRepository(),
    products: new MongoProductRepository(),
    sequences: new MongoSequenceGenerator(),
    certificates: new MongoCertificateStore(),
    signer: new FirmaEcXadesSigner(),
    sri,
    logger: silentLogger,
    submitOptions: { authorizationAttempts: 2, authorizationDelayMs: 0 },
    ride: null,
  });
  return moduleApp(module);
}

async function createCompany(ruc: string): Promise<string> {
  const cert = testCertificate();
  const company = await IssuingCompany.create({
    ruc,
    razon_social: `EMPRESA ${ruc}`,
    nombre_comercial: `EMPRESA ${ruc}`,
    direccion: 'CUENCA',
    codigo_establecimiento: '001',
    punto_emision: '001',
    tipo_ambiente: 1,
    tipo_emision: 1,
    obligado_contabilidad: false,
    certificate: cert.p12.toString('base64'),
    certificate_password: encrypt(cert.password),
    user_id: new Types.ObjectId(),
  });
  return String(company._id);
}

function payload(ruc = RUC_A, overrides: Record<string, unknown> = {}) {
  return {
    guia_remision: {
      infoTributaria: { ruc, claveAcceso: '', secuencial: '' },
      infoGuiaRemision: {
        fechaEmision: '13/10/2026',
        dirPartida: 'CUENCA',
        razonSocialTransportista: 'MONTERO CAMPOVERDE OSCAR XAVIER',
        tipoIdentificacionTransportista: '05',
        rucTransportista: '0106079783',
        fechaIniTransporte: '13/10/2026',
        fechaFinTransporte: '13/10/2026',
        placa: 'ABC1234',
        ...overrides,
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
}

describe('Módulo guía de remisión (HTTP + Mongo + firma real)', () => {
  let companyA: string;
  let companyB: string;

  beforeAll(startMongo);
  afterAll(stopMongo);
  beforeEach(async () => {
    await clearMongo();
    companyA = await createCompany(RUC_A);
    companyB = await createCompany(RUC_B);
  });

  it('emite, firma y queda AUTORIZADO con /complete?esperar=true', async () => {
    const sri = new ScriptedSri(undefined, [authorized({ authorizedXml: undefined })]);
    const app = buildApp(sri);
    const res = await request(app)
      .post('/api/v1/delivery-note/complete?esperar=true')
      .set(authFor(companyA))
      .send(payload());

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      tipo_comprobante: '06',
      numero: '001-001-000000001',
      estado: 'AUTORIZADO',
      placa: 'ABC1234',
      destinatarios: 1,
    });
    expect(res.body.data.clave_acceso).toMatch(/^131020260601060797830011001001000000001\d{10}$/);
    expect(res.body.xml).toContain('<guiaRemision id="comprobante" version="1.1.0">');

    expect(sri.sent).toHaveLength(1);
    expect(sri.sent[0].xml).toContain('<ds:Signature');
    expect(sri.sent[0].xml).toContain('<placa>ABC1234</placa>');

    const stored = await DeliveryNoteModel.findById(res.body.data.id).lean();
    expect(stored?.xml_firmado).toContain('ds:Signature');
    expect(stored?.placa).toBe('ABC1234');
    expect(stored?.destinatarios[0].detalles[0]).toMatchObject({ descripcion: 'Servicio de prueba', cantidad: 1 });

    const xml = await request(app).get(`/api/v1/delivery-note/${res.body.data.id}/xml`).set(authFor(companyA));
    expect(xml.status).toBe(200);
    expect(xml.text).toContain('<guiaRemision');
    expect(xml.text).toContain('ds:Signature');
  });

  it('secuenciales independientes del tipo de comprobante y consecutivos', async () => {
    const app = buildApp(new ScriptedSri());
    const first = await request(app)
      .post('/api/v1/delivery-note/complete?esperar=true')
      .set(authFor(companyA))
      .send(payload());
    const second = await request(app)
      .post('/api/v1/delivery-note/complete?esperar=true')
      .set(authFor(companyA))
      .send(payload());
    expect(first.body.data.secuencial).toBe('000000001');
    expect(second.body.data.secuencial).toBe('000000002');
  });

  it('aísla por empresa: no emite con RUC ajeno ni lee guías de otra empresa', async () => {
    const app = buildApp(new ScriptedSri());
    const forbidden = await request(app)
      .post('/api/v1/delivery-note/complete')
      .set(authFor(companyB))
      .send(payload(RUC_A));
    expect(forbidden.status).toBe(403);

    const created = await request(app)
      .post('/api/v1/delivery-note/complete?esperar=true')
      .set(authFor(companyA))
      .send(payload());
    const id = created.body.data.id;

    expect((await request(app).get(`/api/v1/delivery-note/${id}`).set(authFor(companyB))).status).toBe(404);
    expect((await request(app).get(`/api/v1/delivery-note/${id}/estado`).set(authFor(companyB))).status).toBe(404);
    expect((await request(app).delete(`/api/v1/delivery-note/${id}`).set(authFor(companyB))).status).toBe(404);

    const listB = await request(app).get('/api/v1/delivery-note').set(authFor(companyB));
    expect(listB.body).toEqual([]);
    const listA = await request(app).get('/api/v1/delivery-note').set(authFor(companyA));
    expect(listA.body).toHaveLength(1);
    expect(listA.body[0].xml).toBeUndefined();
  });

  it('DEVUELTA queda con mensajes y se reintenta hasta AUTORIZADO', async () => {
    const sri = new ScriptedSri(
      [
        {
          status: 'DEVUELTA',
          messages: [{ identifier: '35', message: 'ARCHIVO NO CUMPLE ESTRUCTURA XML', type: 'ERROR' }],
        },
        { status: 'RECIBIDA', messages: [] },
      ],
      [authorized()],
    );
    const app = buildApp(sri);
    const created = await request(app)
      .post('/api/v1/delivery-note/complete?esperar=true')
      .set(authFor(companyA))
      .send(payload());
    expect(created.status).toBe(201);
    expect(created.body.success).toBe(false);
    expect(created.body.data.estado).toBe('DEVUELTA');
    expect(created.body.data.mensajes[0].identifier).toBe('35');

    const retry = await request(app)
      .post(`/api/v1/delivery-note/${created.body.data.id}/enviar`)
      .set(authFor(companyA));
    expect(retry.status).toBe(200);
    expect(retry.body.data.estado).toBe('AUTORIZADO');
    expect(sri.sent).toHaveLength(2);
  });

  it('valida el payload con 400 y sin consumir secuencial', async () => {
    const app = buildApp(new ScriptedSri());
    const cases = [
      { guia_remision: undefined },
      payload(RUC_A, { fechaIniTransporte: '14/10/2026', fechaFinTransporte: '13/10/2026' }),
      payload(RUC_A, { placa: 'ABC 1234!' }),
      payload(RUC_A, { tipoIdentificacionTransportista: '99' }),
      payload(RUC_A, { rucTransportista: '123' }),
    ];
    for (const body of cases) {
      const res = await request(app).post('/api/v1/delivery-note/complete').set(authFor(companyA)).send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
    }
    const noItems = payload();
    noItems.guia_remision.destinatarios[0].destinatario.detalles = [];
    expect(
      (await request(app).post('/api/v1/delivery-note/complete').set(authFor(companyA)).send(noItems)).status,
    ).toBe(400);
    const zero = payload();
    zero.guia_remision.destinatarios[0].destinatario.detalles[0].detalle.cantidad = '0';
    expect((await request(app).post('/api/v1/delivery-note/complete').set(authFor(companyA)).send(zero)).status).toBe(
      400,
    );

    const ok = await request(app)
      .post('/api/v1/delivery-note/complete?esperar=true')
      .set(authFor(companyA))
      .send(payload());
    expect(ok.body.data.secuencial).toBe('000000001');
  });

  it('no elimina una guía autorizada (409) pero sí un borrador devuelto', async () => {
    const app = buildApp(new ScriptedSri());
    const created = await request(app)
      .post('/api/v1/delivery-note/complete?esperar=true')
      .set(authFor(companyA))
      .send(payload());
    const res = await request(app).delete(`/api/v1/delivery-note/${created.body.data.id}`).set(authFor(companyA));
    expect(res.status).toBe(409);
    expect(await DeliveryNoteModel.countDocuments()).toBe(1);

    const returned = buildApp(
      new ScriptedSri([{ status: 'DEVUELTA', messages: [{ identifier: '35', message: 'X', type: 'ERROR' }] }]),
    );
    const draft = await request(returned)
      .post('/api/v1/delivery-note/complete?esperar=true')
      .set(authFor(companyA))
      .send(payload());
    const del = await request(returned).delete(`/api/v1/delivery-note/${draft.body.data.id}`).set(authFor(companyA));
    expect(del.status).toBe(200);
    expect(await DeliveryNoteModel.countDocuments()).toBe(1);
  });
});
