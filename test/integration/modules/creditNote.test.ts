import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { clearMongo, startMongo, stopMongo } from '../../helpers/mongo';
import { testCertificate } from '../../helpers/certificate';
import { authFor, moduleApp } from '../../helpers/moduleApp';
import { authorized, fixedClock, ScriptedSri } from '../../helpers/fakes';
import { silentLogger } from '../../../src/application/ports/runtime';
import { MongoCertificateStore } from '../../../src/infrastructure/certificates/MongoCertificateStore';
import { MongoBuyerRepository } from '../../../src/infrastructure/persistence/MongoBuyerRepository';
import { MongoIssuerRepository } from '../../../src/infrastructure/persistence/MongoIssuerRepository';
import { MongoProductRepository } from '../../../src/infrastructure/persistence/MongoProductRepository';
import { MongoSequenceGenerator } from '../../../src/infrastructure/persistence/MongoSequenceGenerator';
import { FirmaEcXadesSigner } from '../../../src/infrastructure/signing/FirmaEcXadesSigner';
import IssuingCompany from '../../../src/models/IssuingCompany';
import { encrypt } from '../../../src/utils/encryption.utils';
import { createCreditNoteModule } from '../../../src/modules/creditNote';
import { CreditNoteModel } from '../../../src/modules/creditNote/infrastructure/CreditNoteModel';
import { DocumentModuleDeps } from '../../../src/modules/types';

const RUC_A = '0106079783001';
const RUC_B = '1790000000001';

function buildApp(sri: ScriptedSri) {
  const deps: DocumentModuleDeps = {
    issuers: new MongoIssuerRepository(),
    buyers: new MongoBuyerRepository(),
    products: new MongoProductRepository(),
    sequences: new MongoSequenceGenerator(),
    certificates: new MongoCertificateStore(),
    signer: new FirmaEcXadesSigner(),
    sri,
    logger: silentLogger,
    clock: fixedClock(),
    submitOptions: { authorizationAttempts: 2, authorizationDelayMs: 0 },
    ride: null,
  };
  return moduleApp(createCreditNoteModule(deps));
}

async function createCompany(ruc: string, extra: Record<string, unknown> = {}): Promise<string> {
  const cert = testCertificate();
  const company = await IssuingCompany.create({
    ruc,
    razon_social: `EMPRESA ${ruc}`,
    nombre_comercial: `EMPRESA ${ruc}`,
    direccion: 'AV. SIEMPRE VIVA 123, CUENCA',
    codigo_establecimiento: '001',
    punto_emision: '011',
    tipo_ambiente: 1,
    tipo_emision: 1,
    obligado_contabilidad: false,
    certificate: cert.p12.toString('base64'),
    certificate_password: encrypt(cert.password),
    user_id: new Types.ObjectId(),
    ...extra,
  });
  return String(company._id);
}

function payload(ruc = RUC_A, overrides: Record<string, unknown> = {}) {
  return {
    nota_credito: {
      infoTributaria: { ruc, claveAcceso: '', secuencial: '' },
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
        ...overrides,
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
    },
  };
}

describe('Módulo nota de crédito (HTTP + Mongo + firma real)', () => {
  beforeAll(startMongo);
  afterAll(stopMongo);
  beforeEach(clearMongo);

  it('POST /complete?esperar=true → AUTORIZADO, XML firmado con ds:Signature enviado al SRI', async () => {
    const companyId = await createCompany(RUC_A);
    const sri = new ScriptedSri();
    const app = buildApp(sri);

    const res = await request(app)
      .post('/api/v1/credit-note/complete?esperar=true')
      .set(authFor(companyId))
      .send(payload());

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      tipo_comprobante: '04',
      estado: 'AUTORIZADO',
      numero: '001-011-000000001',
      num_doc_modificado: '001-009-000000001',
      valor_modificacion: 11.5,
    });
    expect(res.body.xml).toContain('<notaCredito id="comprobante" version="1.1.0">');

    expect(sri.sent).toHaveLength(1);
    const signed = sri.sent[0].xml;
    expect(signed).toContain('<ds:Signature');
    expect(signed).toContain('<codDoc>04</codDoc>');
    expect(signed).toContain('<ptoEmi>011</ptoEmi>');
    expect(signed).toContain(`<claveAcceso>${res.body.data.clave_acceso}</claveAcceso>`);
    expect(sri.authorizations).toEqual([res.body.data.clave_acceso]);

    const stored = await CreditNoteModel.findById(res.body.data.id).lean();
    expect(stored).toMatchObject({
      estado: 'AUTORIZADO',
      tipo_documento: '04',
      cod_doc_modificado: '01',
      valor_modificacion: 11.5,
      total_iva: 1.5,
    });
    expect(stored!.detalles).toHaveLength(1);
    expect(stored!.xml_firmado).toContain('ds:Signature');

    const estado = await request(app).get(`/api/v1/credit-note/${res.body.data.id}/estado`).set(authFor(companyId));
    expect(estado.body.estado).toBe('AUTORIZADO');

    const xml = await request(app).get(`/api/v1/credit-note/${res.body.data.id}/xml`).set(authFor(companyId));
    expect(xml.status).toBe(200);
    expect(xml.headers['content-type']).toContain('application/xml');

    const list = await request(app).get('/api/v1/credit-note').set(authFor(companyId));
    expect(list.body).toHaveLength(1);
    expect(list.body[0].xml).toBeUndefined();
  });

  it('asíncrono por defecto: responde PENDIENTE', async () => {
    const companyId = await createCompany(RUC_A);
    const app = buildApp(new ScriptedSri());
    const res = await request(app).post('/api/v1/credit-note/complete').set(authFor(companyId)).send(payload());
    expect(res.status).toBe(201);
    expect(res.body.data.estado).toBe('PENDIENTE');
  });

  it('aislamiento por empresa: RUC ajeno → 403; leer/borrar la nota de otra empresa → 404', async () => {
    const companyA = await createCompany(RUC_A);
    const companyB = await createCompany(RUC_B);
    const app = buildApp(new ScriptedSri());

    const forbidden = await request(app)
      .post('/api/v1/credit-note/complete')
      .set(authFor(companyB))
      .send(payload(RUC_A));
    expect(forbidden.status).toBe(403);
    expect(await CreditNoteModel.countDocuments()).toBe(0);

    const created = await request(app)
      .post('/api/v1/credit-note/complete?esperar=true')
      .set(authFor(companyA))
      .send(payload(RUC_A));
    const id = created.body.data.id;

    for (const req of [
      request(app).get(`/api/v1/credit-note/${id}`),
      request(app).get(`/api/v1/credit-note/${id}/estado`),
      request(app).get(`/api/v1/credit-note/${id}/xml`),
      request(app).post(`/api/v1/credit-note/${id}/enviar`),
      request(app).delete(`/api/v1/credit-note/${id}`),
    ]) {
      expect((await req.set(authFor(companyB))).status).toBe(404);
    }
    const listB = await request(app).get('/api/v1/credit-note').set(authFor(companyB));
    expect(listB.body).toEqual([]);
  });

  it('DEVUELTA y reintento con /:id/enviar → AUTORIZADO', async () => {
    const companyId = await createCompany(RUC_A);
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

    const first = await request(app)
      .post('/api/v1/credit-note/complete?esperar=true')
      .set(authFor(companyId))
      .send(payload());
    expect(first.status).toBe(201);
    expect(first.body.success).toBe(false);
    expect(first.body.data.estado).toBe('DEVUELTA');
    expect(first.body.data.mensajes[0].identifier).toBe('35');

    const retry = await request(app).post(`/api/v1/credit-note/${first.body.data.id}/enviar`).set(authFor(companyId));
    expect(retry.status).toBe(200);
    expect(retry.body.success).toBe(true);
    expect(retry.body.data.estado).toBe('AUTORIZADO');
    expect(sri.sent).toHaveLength(2);
  });

  it('validación → 400 y no consume secuencial', async () => {
    const companyId = await createCompany(RUC_A);
    const app = buildApp(new ScriptedSri());

    const bad = [
      { body: {}, message: 'Credit note data is required' },
      { body: payload(RUC_A, { numDocModificado: '001-009-1' }), message: 'numDocModificado' },
      { body: payload(RUC_A, { valorModificacion: '12.00' }), message: 'no coinciden' },
      { body: payload(RUC_A, { fechaEmisionDocSustento: '14/10/2026' }), message: 'posterior' },
      { body: payload(RUC_A, { motivo: '' }), message: 'motivo' },
    ];
    for (const { body, message } of bad) {
      const res = await request(app).post('/api/v1/credit-note/complete').set(authFor(companyId)).send(body);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.message).toContain(message);
    }
    expect(await CreditNoteModel.countDocuments()).toBe(0);

    const ok = await request(app).post('/api/v1/credit-note/complete').set(authFor(companyId)).send(payload());
    expect(ok.body.data.secuencial).toBe('000000001');
  });

  it('respeta ultimos_secuenciales["04"] declarado por la empresa', async () => {
    const companyId = await createCompany(RUC_A, { ultimos_secuenciales: { '04': 41 } });
    const app = buildApp(new ScriptedSri());
    const res = await request(app).post('/api/v1/credit-note/complete').set(authFor(companyId)).send(payload());
    expect(res.body.data.secuencial).toBe('000000042');
  });

  it('DELETE: borrador → 200; autorizada → 409', async () => {
    const companyId = await createCompany(RUC_A);
    const sri = new ScriptedSri([{ status: 'DEVUELTA', messages: [] }]);
    const app = buildApp(sri);

    const draft = await request(app)
      .post('/api/v1/credit-note/complete?esperar=true')
      .set(authFor(companyId))
      .send(payload());
    expect(draft.body.data.estado).toBe('DEVUELTA');
    const deleted = await request(app).delete(`/api/v1/credit-note/${draft.body.data.id}`).set(authFor(companyId));
    expect(deleted.status).toBe(200);
    expect(await CreditNoteModel.countDocuments()).toBe(0);

    sri.receptions = [{ status: 'RECIBIDA', messages: [] }];
    const authorizedNote = await request(app)
      .post('/api/v1/credit-note/complete?esperar=true')
      .set(authFor(companyId))
      .send(payload());
    expect(authorizedNote.body.data.estado).toBe('AUTORIZADO');
    const conflict = await request(app)
      .delete(`/api/v1/credit-note/${authorizedNote.body.data.id}`)
      .set(authFor(companyId));
    expect(conflict.status).toBe(409);
    expect(await CreditNoteModel.countDocuments()).toBe(1);
  });

  it('POST /:id/pdf con RIDE deshabilitado → 503 si autorizada, 409 si no', async () => {
    const companyId = await createCompany(RUC_A);
    const sri = new ScriptedSri([{ status: 'DEVUELTA', messages: [] }]);
    const app = buildApp(sri);
    const draft = await request(app)
      .post('/api/v1/credit-note/complete?esperar=true')
      .set(authFor(companyId))
      .send(payload());
    expect(
      (await request(app).post(`/api/v1/credit-note/${draft.body.data.id}/pdf`).set(authFor(companyId))).status,
    ).toBe(409);
    sri.receptions = [{ status: 'RECIBIDA', messages: [] }];
    await request(app).post(`/api/v1/credit-note/${draft.body.data.id}/enviar`).set(authFor(companyId));
    expect(
      (await request(app).post(`/api/v1/credit-note/${draft.body.data.id}/pdf`).set(authFor(companyId))).status,
    ).toBe(503);
  });
});
