import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { clearMongo, startMongo, stopMongo } from '../../helpers/mongo';
import { testCertificate } from '../../helpers/certificate';
import { authFor, moduleApp } from '../../helpers/moduleApp';
import { authorized, ScriptedSri } from '../../helpers/fakes';
import { silentLogger } from '../../../src/application/ports/runtime';
import { MongoCertificateStore } from '../../../src/infrastructure/certificates/MongoCertificateStore';
import { MongoBuyerRepository } from '../../../src/infrastructure/persistence/MongoBuyerRepository';
import { MongoIssuerRepository } from '../../../src/infrastructure/persistence/MongoIssuerRepository';
import { MongoProductRepository } from '../../../src/infrastructure/persistence/MongoProductRepository';
import { MongoSequenceGenerator } from '../../../src/infrastructure/persistence/MongoSequenceGenerator';
import { FirmaEcXadesSigner } from '../../../src/infrastructure/signing/FirmaEcXadesSigner';
import { IPDFStorageProvider } from '../../../src/interfaces/pdf-storage.interface';
import IssuingCompany from '../../../src/models/IssuingCompany';
import InvoicePDF from '../../../src/models/InvoicePDF';
import { createDebitNoteModule } from '../../../src/modules/debitNote';
import { DebitNoteModel } from '../../../src/modules/debitNote/infrastructure/MongoDebitNoteRepository';
import { DocumentModuleDeps } from '../../../src/modules/types';
import { encrypt } from '../../../src/utils/encryption.utils';
import { ndPayload } from '../../unit/modules/debitNote/support';

const RUC_A = '0106079783001';
const RUC_B = '1790000000001';

class FakeStorage implements IPDFStorageProvider {
  uploads: string[] = [];
  async upload(buffer: Buffer, filename: string) {
    this.uploads.push(filename);
    return { url: `https://cdn.test/${filename}.pdf`, publicId: filename, provider: 'fake', size: buffer.length };
  }
  async delete() {
    return true;
  }
  getPublicUrl(id: string) {
    return id;
  }
  getProviderName() {
    return 'fake';
  }
}

function buildApp(sri: ScriptedSri, storage: FakeStorage | null = null) {
  const deps: DocumentModuleDeps = {
    issuers: new MongoIssuerRepository(),
    buyers: new MongoBuyerRepository(),
    products: new MongoProductRepository(),
    sequences: new MongoSequenceGenerator(),
    signer: new FirmaEcXadesSigner(),
    sri,
    certificates: new MongoCertificateStore(),
    logger: silentLogger,
    submitOptions: { authorizationDelayMs: 0, authorizationAttempts: 2 },
    ride: storage ? { storage: () => storage, htmlToPdf: async (html: string) => Buffer.from(html, 'utf8') } : null,
  };
  return moduleApp(createDebitNoteModule(deps));
}

async function createCompany(ruc: string, overrides: Record<string, unknown> = {}) {
  const cert = testCertificate();
  const company = await IssuingCompany.create({
    ruc,
    razon_social: 'MONTERO CAMPOVERDE OSCAR XAVIER',
    nombre_comercial: 'F-SRI PRUEBAS',
    direccion: 'CUENCA',
    codigo_establecimiento: '001',
    punto_emision: '012',
    tipo_ambiente: 1,
    obligado_contabilidad: false,
    certificate: cert.p12.toString('base64'),
    certificate_password: encrypt(cert.password),
    user_id: new Types.ObjectId(),
    ...overrides,
  });
  return String(company._id);
}

const complete = (app: ReturnType<typeof buildApp>, companyId: string, body: unknown = ndPayload(), wait = true) =>
  request(app)
    .post(`/api/v1/debit-note/complete${wait ? '?esperar=true' : ''}`)
    .set(authFor(companyId))
    .send(body as object);

beforeAll(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  testCertificate();
  await startMongo();
});
afterAll(async () => {
  vi.restoreAllMocks();
  await stopMongo();
});
beforeEach(clearMongo);

describe('POST /api/v1/debit-note/complete', () => {
  it('?esperar=true: firma, envía y queda AUTORIZADO; publica el RIDE', async () => {
    const companyId = await createCompany(RUC_A);
    const sri = new ScriptedSri(
      [{ status: 'RECIBIDA', messages: [] }],
      [authorized({ authorizedXml: '<notaDebito id="comprobante">autorizada</notaDebito>' })],
    );
    const storage = new FakeStorage();
    const app = buildApp(sri, storage);

    const res = await complete(app, companyId);

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      tipo_comprobante: '05',
      numero: '001-012-000000001',
      estado: 'AUTORIZADO',
      ambiente: 'PRUEBAS',
      num_doc_modificado: '001-009-000000001',
      valor_total: 2.3,
    });
    expect(res.body.xml).toContain('<notaDebito id="comprobante" version="1.0.0">');

    expect(sri.sent).toHaveLength(1);
    expect(sri.sent[0].environment).toBe('1');
    expect(sri.sent[0].xml).toContain('<ds:Signature');
    expect(sri.sent[0].xml).toContain('<codDoc>05</codDoc>');
    expect(sri.authorizations).toEqual([res.body.data.clave_acceso]);

    const stored = await DebitNoteModel.findById(res.body.data.id).lean();
    expect(stored).toMatchObject({
      estado: 'AUTORIZADO',
      cod_doc_modificado: '01',
      total_sin_impuestos: 2,
      total_impuestos: 0.3,
      valor_total: 2.3,
    });
    expect(stored!.xml_firmado).toContain('<ds:Signature');
    expect(JSON.parse((stored as unknown as { datos_originales: string }).datos_originales)).toEqual(
      ndPayload().nota_debito,
    );

    expect(storage.uploads).toEqual([`nota_debito_000000001_${res.body.data.clave_acceso}`]);
    const pdf = await InvoicePDF.findOne({ claveAcceso: res.body.data.clave_acceso }).lean();
    expect(pdf).toMatchObject({ tipo_documento: '05', estado: 'GENERADO' });

    const pdfRes = await request(app).get(`/api/v1/debit-note/${res.body.data.id}/pdf`).set(authFor(companyId));
    expect(pdfRes.status).toBe(200);
    const xmlRes = await request(app).get(`/api/v1/debit-note/${res.body.data.id}/xml`).set(authFor(companyId));
    expect(xmlRes.status).toBe(200);
    expect(xmlRes.text).toContain('autorizada</notaDebito>');
  });

  it('secuenciales consecutivos por serie y codDoc 05', async () => {
    const companyId = await createCompany(RUC_A);
    const app = buildApp(new ScriptedSri());
    const first = await complete(app, companyId);
    const second = await complete(app, companyId);
    expect([first.body.data.secuencial, second.body.data.secuencial]).toEqual(['000000001', '000000002']);
  });

  it('valida el payload: 400 sin crear nada ni consumir secuencial', async () => {
    const companyId = await createCompany(RUC_A);
    const sri = new ScriptedSri();
    const app = buildApp(sri);

    for (const body of [
      {},
      ndPayload({ info: { valorTotal: '9.99' } }),
      ndPayload({ info: { numDocModificado: '001-009' } }),
      ndPayload({ motivos: [{ motivo: { razon: 'X', valor: '-1' } }] }),
    ]) {
      const res = await complete(app, companyId, body, false);
      expect(res.status, JSON.stringify(res.body)).toBe(400);
      expect(res.body.success).toBe(false);
    }
    expect(await DebitNoteModel.countDocuments()).toBe(0);
    expect(sri.sent).toHaveLength(0);

    const ok = await complete(app, companyId);
    expect(ok.body.data.secuencial).toBe('000000001');
  });

  it('requiere autenticación', async () => {
    await createCompany(RUC_A);
    const res = await request(buildApp(new ScriptedSri())).post('/api/v1/debit-note/complete').send(ndPayload());
    expect(res.status).toBe(401);
  });
});

describe('aislamiento por empresa', () => {
  it('no emite a nombre de otra empresa ni ve/borra sus notas', async () => {
    const companyA = await createCompany(RUC_A);
    const companyB = await createCompany(RUC_B, { razon_social: 'EMPRESA B' });
    const app = buildApp(new ScriptedSri([{ status: 'DEVUELTA', messages: [] }]));

    const forbidden = await complete(app, companyB, ndPayload({ ruc: RUC_A }), false);
    expect(forbidden.status).toBe(403);
    expect(await DebitNoteModel.countDocuments()).toBe(0);

    const created = await complete(app, companyA);
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    for (const path of [`/${id}`, `/${id}/estado`, `/${id}/xml`, `/${id}/pdf`]) {
      expect((await request(app).get(`/api/v1/debit-note${path}`).set(authFor(companyB))).status).toBe(404);
    }
    expect((await request(app).post(`/api/v1/debit-note/${id}/enviar`).set(authFor(companyB))).status).toBe(404);
    expect((await request(app).delete(`/api/v1/debit-note/${id}`).set(authFor(companyB))).status).toBe(404);

    expect((await request(app).get('/api/v1/debit-note').set(authFor(companyB))).body).toEqual([]);
    const listA = await request(app).get('/api/v1/debit-note').set(authFor(companyA));
    expect(listA.body).toHaveLength(1);
    expect(listA.body[0].xml).toBeUndefined();
    const one = await request(app).get(`/api/v1/debit-note/${id}`).set(authFor(companyA));
    expect(one.body.num_doc_modificado).toBe('001-009-000000001');
  });
});

describe('DEVUELTA, reintento y borrado', () => {
  it('DEVUELTA → /enviar reintenta → AUTORIZADO → DELETE 409', async () => {
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

    const created = await complete(app, companyId);
    expect(created.status).toBe(201);
    expect(created.body.success).toBe(false);
    expect(created.body.data.estado).toBe('DEVUELTA');
    expect(created.body.data.mensajes[0].identifier).toBe('35');
    const id = created.body.data.id;

    const retried = await request(app).post(`/api/v1/debit-note/${id}/enviar`).set(authFor(companyId));
    expect(retried.status).toBe(200);
    expect(retried.body.data.estado).toBe('AUTORIZADO');
    expect(sri.sent).toHaveLength(2);

    const estado = await request(app).get(`/api/v1/debit-note/${id}/estado`).set(authFor(companyId));
    expect(estado.body.estado).toBe('AUTORIZADO');

    const del = await request(app).delete(`/api/v1/debit-note/${id}`).set(authFor(companyId));
    expect(del.status).toBe(409);
    expect(await DebitNoteModel.countDocuments()).toBe(1);
  });

  it('borra un borrador no autorizado', async () => {
    const companyId = await createCompany(RUC_A);
    const app = buildApp(new ScriptedSri([{ status: 'DEVUELTA', messages: [] }]));
    const created = await complete(app, companyId);
    const del = await request(app).delete(`/api/v1/debit-note/${created.body.data.id}`).set(authFor(companyId));
    expect(del.status).toBe(200);
    expect(await DebitNoteModel.countDocuments()).toBe(0);
  });
});
