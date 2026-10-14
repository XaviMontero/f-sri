import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { clearMongo, startMongo, stopMongo } from '../../helpers/mongo';
import { testCertificate } from '../../helpers/certificate';
import { authFor, moduleApp } from '../../helpers/moduleApp';
import { authorized, ScriptedSri } from '../../helpers/fakes';
import { silentLogger } from '../../../src/application/ports/runtime';
import { MongoCertificateStore } from '../../../src/infrastructure/certificates/MongoCertificateStore';
import { MongoIssuerRepository } from '../../../src/infrastructure/persistence/MongoIssuerRepository';
import { MongoSequenceGenerator } from '../../../src/infrastructure/persistence/MongoSequenceGenerator';
import { MongoBuyerRepository } from '../../../src/infrastructure/persistence/MongoBuyerRepository';
import { MongoProductRepository } from '../../../src/infrastructure/persistence/MongoProductRepository';
import { FirmaEcXadesSigner } from '../../../src/infrastructure/signing/FirmaEcXadesSigner';
import { DocumentModuleDeps } from '../../../src/modules/types';
import { createWithholdingModule } from '../../../src/modules/withholding';
import { WithholdingModel } from '../../../src/modules/withholding/infrastructure/MongoWithholdingRepository';
import IssuingCompany from '../../../src/models/IssuingCompany';
import InvoicePDF from '../../../src/models/InvoicePDF';
import { encrypt } from '../../../src/utils/encryption.utils';
import { retencionPayload } from '../../unit/modules/withholding/fixtures';

const RUC_A = '0106079783001';
const RUC_B = '1790000000001';

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
    certificate: cert.p12.toString('base64'),
    certificate_password: encrypt(cert.password),
    user_id: new Types.ObjectId(),
  });
  return String(company._id);
}

function buildApp(sri: ScriptedSri, opts: { ride?: boolean } = {}) {
  const uploads: string[] = [];
  const deps: DocumentModuleDeps = {
    issuers: new MongoIssuerRepository(),
    buyers: new MongoBuyerRepository(),
    products: new MongoProductRepository(),
    sequences: new MongoSequenceGenerator(),
    certificates: new MongoCertificateStore(),
    signer: new FirmaEcXadesSigner(),
    sri,
    logger: silentLogger,
    submitOptions: { authorizationDelayMs: 0, authorizationAttempts: 2 },
    ride: opts.ride
      ? {
          storage: () => ({
            upload: async (pdf: Buffer, filename: string) => {
              uploads.push(filename);
              return {
                url: `https://files.test/${filename}.pdf`,
                publicId: filename,
                size: pdf.length,
                provider: 'fake',
              };
            },
            delete: async () => true,
            getPublicUrl: (id: string) => id,
            getProviderName: () => 'fake',
          }),
          htmlToPdf: async (html: string) => Buffer.from(html),
        }
      : null,
  };
  const module = createWithholdingModule(deps);
  return { app: moduleApp(module), module, uploads };
}

beforeAll(async () => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  testCertificate();
  await startMongo();
});
afterAll(async () => {
  vi.restoreAllMocks();
  await stopMongo();
});
beforeEach(clearMongo);

describe('módulo withholding (codDoc 07)', () => {
  it('expone el contrato del módulo', () => {
    const { module } = buildApp(new ScriptedSri());
    expect(module.documentType).toBe('07');
    expect(module.path).toBe('withholding');
    expect(Object.keys(module.swaggerPaths ?? {})).toContain('/api/v1/withholding/complete');
  });

  it('POST /complete?esperar=true → AUTORIZADO, XML firmado con ds:Signature y RIDE tras la autorización', async () => {
    const companyId = await createCompany(RUC_A);
    const sri = new ScriptedSri();
    const { app, uploads } = buildApp(sri, { ride: true });

    const res = await request(app)
      .post('/api/v1/withholding/complete?esperar=true')
      .set(authFor(companyId))
      .send(retencionPayload(RUC_A));

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      tipo_comprobante: '07',
      numero: '001-001-000000001',
      estado: 'AUTORIZADO',
      ambiente: 'PRUEBAS',
      periodo_fiscal: '10/2026',
      total_retenido: 1,
      sujeto_retenido: { identificacion: '0106079783', razon_social: 'MONTERO CAMPOVERDE OSCAR XAVIER' },
    });
    const accessKey: string = res.body.data.clave_acceso;
    expect(accessKey.slice(8, 10)).toBe('07');
    expect(res.body.xml).toContain('<parteRel>NO</parteRel>');

    expect(sri.sent).toHaveLength(1);
    const signed = sri.sent[0].xml;
    expect(signed).toContain('<ds:Signature');
    expect(signed).toContain('<comprobanteRetencion id="comprobante" version="2.0.0">');
    expect(signed).toContain('<formaPago>01</formaPago>');
    expect(sri.authorizations).toEqual([accessKey]);

    const stored = await WithholdingModel.findById(res.body.data.id).lean();
    expect(stored).toMatchObject({
      estado: 'AUTORIZADO',
      periodo_fiscal: '10/2026',
      total_retenido: 1,
      parte_rel: 'NO',
      identificacion_sujeto_retenido: '0106079783',
    });
    expect(stored!.docs_sustento[0].retenciones[0]).toMatchObject({ codigoRetencion: '303', valorRetenido: 1 });
    expect(stored!.xml_firmado).toContain('ds:Signature');

    expect(uploads).toEqual([`retencion_000000001_${accessKey}`]);
    const pdf = await InvoicePDF.findOne({ claveAcceso: accessKey }).lean();
    expect(pdf).toMatchObject({ tipo_documento: '07', estado: 'GENERADO', factura_id: res.body.data.id });

    const xml = await request(app).get(`/api/v1/withholding/${res.body.data.id}/xml`).set(authFor(companyId));
    expect(xml.status).toBe(200);
    expect(xml.headers['content-type']).toContain('application/xml');
  });

  it('DEVUELTA: no genera RIDE, guarda mensajes y /enviar reintenta hasta AUTORIZADO', async () => {
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
    const { app, uploads } = buildApp(sri, { ride: true });

    const res = await request(app)
      .post('/api/v1/withholding/complete?esperar=1')
      .set(authFor(companyId))
      .send(retencionPayload(RUC_A));
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(false);
    expect(res.body.data.estado).toBe('DEVUELTA');
    expect(res.body.data.mensajes[0]).toMatchObject({ identifier: '35' });
    expect(uploads).toEqual([]);

    const status = await request(app).get(`/api/v1/withholding/${res.body.data.id}/estado`).set(authFor(companyId));
    expect(status.body.estado).toBe('DEVUELTA');

    const retry = await request(app).post(`/api/v1/withholding/${res.body.data.id}/enviar`).set(authFor(companyId));
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ success: true, data: { estado: 'AUTORIZADO' } });
    expect(sri.sent).toHaveLength(2);
    expect(uploads).toHaveLength(1);
  });

  it('aislamiento por empresa: no se emite con otro RUC ni se ve, lista ni borra lo ajeno', async () => {
    const companyA = await createCompany(RUC_A);
    const companyB = await createCompany(RUC_B);
    const { app } = buildApp(new ScriptedSri());

    const forbidden = await request(app)
      .post('/api/v1/withholding/complete?esperar=true')
      .set(authFor(companyB))
      .send(retencionPayload(RUC_A));
    expect(forbidden.status).toBe(403);

    const created = await request(app)
      .post('/api/v1/withholding/complete?esperar=true')
      .set(authFor(companyA))
      .send(retencionPayload(RUC_A));
    const id = created.body.data.id;

    for (const path of [
      `/api/v1/withholding/${id}`,
      `/api/v1/withholding/${id}/estado`,
      `/api/v1/withholding/${id}/xml`,
    ]) {
      expect((await request(app).get(path).set(authFor(companyB))).status).toBe(404);
    }
    expect((await request(app).delete(`/api/v1/withholding/${id}`).set(authFor(companyB))).status).toBe(404);
    expect((await request(app).post(`/api/v1/withholding/${id}/enviar`).set(authFor(companyB))).status).toBe(404);

    const listB = await request(app).get('/api/v1/withholding').set(authFor(companyB));
    expect(listB.body).toEqual([]);
    const listA = await request(app).get('/api/v1/withholding').set(authFor(companyA));
    expect(listA.body).toHaveLength(1);
    expect(listA.body[0].xml).toBeUndefined();

    const own = await request(app).get(`/api/v1/withholding/${id}`).set(authFor(companyA));
    expect(own.status).toBe(200);
    expect(own.body.clave_acceso).toBe(created.body.data.clave_acceso);
  });

  it('400 en datos inválidos sin consumir secuencial', async () => {
    const companyId = await createCompany(RUC_A);
    const { app } = buildApp(new ScriptedSri());

    const noBody = await request(app).post('/api/v1/withholding/complete').set(authFor(companyId)).send({});
    expect(noBody.status).toBe(400);

    const bad = retencionPayload(RUC_A);
    bad.retencion.docsSustento[0].docSustento.retenciones[0].retencion.valorRetenido = '1.50';
    const res = await request(app).post('/api/v1/withholding/complete').set(authFor(companyId)).send(bad);
    expect(res.status).toBe(400);
    expect(res.body.message ?? JSON.stringify(res.body)).toMatch(/valorRetenido/);

    const period = retencionPayload(RUC_A);
    period.retencion.infoCompRetencion.periodoFiscal = '2026/10';
    expect((await request(app).post('/api/v1/withholding/complete').set(authFor(companyId)).send(period)).status).toBe(
      400,
    );

    const ok = await request(app)
      .post('/api/v1/withholding/complete?esperar=true')
      .set(authFor(companyId))
      .send(retencionPayload(RUC_A));
    expect(ok.body.data.secuencial).toBe('000000001');
  });

  it('DELETE: borrador sí, autorizada → 409', async () => {
    const companyId = await createCompany(RUC_A);
    const devuelta = new ScriptedSri([{ status: 'DEVUELTA', messages: [] }]);
    const draftApp = buildApp(devuelta).app;
    const draft = await request(draftApp)
      .post('/api/v1/withholding/complete?esperar=true')
      .set(authFor(companyId))
      .send(retencionPayload(RUC_A));
    expect(draft.body.data.estado).toBe('DEVUELTA');
    const del = await request(draftApp).delete(`/api/v1/withholding/${draft.body.data.id}`).set(authFor(companyId));
    expect(del.status).toBe(200);
    expect(await WithholdingModel.countDocuments()).toBe(0);

    const { app } = buildApp(new ScriptedSri());
    const created = await request(app)
      .post('/api/v1/withholding/complete?esperar=true')
      .set(authFor(companyId))
      .send(retencionPayload(RUC_A));
    expect(created.body.data.estado).toBe('AUTORIZADO');
    const res = await request(app).delete(`/api/v1/withholding/${created.body.data.id}`).set(authFor(companyId));
    expect(res.status).toBe(409);
    expect(await WithholdingModel.countDocuments()).toBe(1);
  });

  it('sin esperar: responde PENDIENTE y el envío continúa en segundo plano', async () => {
    const companyId = await createCompany(RUC_A);
    const { app } = buildApp(new ScriptedSri());
    const res = await request(app)
      .post('/api/v1/withholding/complete')
      .set(authFor(companyId))
      .send(retencionPayload(RUC_A));
    expect(res.status).toBe(201);
    expect(res.body.data.estado).toBe('PENDIENTE');

    const deadline = Date.now() + 10000;
    let estado = '';
    while (Date.now() < deadline && estado !== 'AUTORIZADO') {
      estado = (await WithholdingModel.findById(res.body.data.id).lean())!.estado;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(estado).toBe('AUTORIZADO');
  });
});
