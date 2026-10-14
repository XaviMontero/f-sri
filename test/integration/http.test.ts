import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Types } from 'mongoose';
import { clearMongo, startMongo, stopMongo } from '../helpers/mongo';
import { testCertificate } from '../helpers/certificate';
import { authorized, RecordingRide, ScriptedSri } from '../helpers/fakes';
import { createApp } from '../../src/app';
import { createContainer } from '../../src/container';
import { silentLogger } from '../../src/application/ports/runtime';
import { MongoInvoiceRepository } from '../../src/infrastructure/persistence/MongoInvoiceRepository';
import Invoice from '../../src/models/Invoice';
import InvoiceDetail from '../../src/models/InvoiceDetail';
import IssuingCompany from '../../src/models/IssuingCompany';

const RUC_A = '0106079783001';
const RUC_B = '1790000000001';
const MASTER_KEY = 'master-key-test';
const INVITATION = 'invite-test';

type App = ReturnType<typeof createApp>;

function buildApp(sri: ScriptedSri, ride: RecordingRide | null = new RecordingRide()): App {
  return createApp(
    createContainer({
      sri,
      ride,
      logger: silentLogger,
      submitOptions: { authorizationDelayMs: 0, authorizationAttempts: 2 },
    }),
  );
}

async function register(app: App, ruc = RUC_A, opts: { email?: string; certificatePassword?: string } = {}) {
  const cert = testCertificate();
  const res = await request(app)
    .post('/register')
    .send({
      email: opts.email ?? `${ruc}@test.ec`,
      password: 'user-pass',
      ruc,
      razon_social: `EMPRESA ${ruc}`,
      direccion: 'AV. SIEMPRE VIVA 123, CUENCA',
      certificate: cert.p12.toString('base64'),
      certificate_password: opts.certificatePassword ?? cert.password,
      masterKey: MASTER_KEY,
      invitationCode: INVITATION,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { token: res.body.token as string, companyId: String(res.body.company.id), userId: String(res.body.user.id) };
}

async function createProduct(app: App, token: string, overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/v1/product')
    .set('Authorization', `Bearer ${token}`)
    .send({ codigo: 'SERV001', descripcion: 'Servicio de prueba', precio_unitario: 10, tiene_iva: true, ...overrides });
  expect(res.status).toBe(201);
  return res.body;
}

function payload(ruc = RUC_A, overrides: { infoFactura?: Record<string, unknown>; detalles?: unknown[] } = {}) {
  return {
    factura: {
      infoTributaria: { ruc },
      infoFactura: {
        fechaEmision: '13/10/2026',
        tipoIdentificacionComprador: '07',
        identificacionComprador: '9999999999999',
        totalSinImpuestos: '10.00',
        importeTotal: '11.50',
        ...overrides.infoFactura,
      },
      detalles: overrides.detalles ?? [
        {
          detalle: {
            codigoPrincipal: 'SERV001',
            cantidad: '1',
            precioUnitario: '10.00',
            impuestos: [{ impuesto: { codigoPorcentaje: '4' } }],
          },
        },
      ],
    },
  };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function waitForStatus(id: string, status: string, timeoutMs = 10000) {
  const repo = new MongoInvoiceRepository();
  const deadline = Date.now() + timeoutMs;
  let current: string | undefined;
  while (Date.now() < deadline) {
    current = (await repo.findById(id))?.status;
    if (current === status) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`invoice ${id} stayed in ${current}, expected ${status}`);
}

beforeAll(async () => {
  process.env.MASTER_REGISTRATION_KEY = MASTER_KEY;
  process.env.INVITATION_CODES = INVITATION;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  testCertificate(); // RSA keygen, una vez
  await startMongo();
});
afterAll(async () => {
  vi.restoreAllMocks();
  await stopMongo();
});
beforeEach(clearMongo);

describe('auth', () => {
  it('reports first registration status and requires the master key', async () => {
    const app = buildApp(new ScriptedSri());
    expect((await request(app).get('/status')).body).toMatchObject({
      firstRegistration: true,
      masterKeyRequired: true,
    });

    const cert = testCertificate();
    const denied = await request(app)
      .post('/register')
      .send({
        email: 'a@b.ec',
        password: 'x',
        ruc: RUC_A,
        razon_social: 'X',
        certificate: cert.p12.toString('base64'),
        certificate_password: 'x',
        masterKey: 'wrong',
      });
    expect(denied.status).toBe(403);
  });

  it('register creates user + company with encrypted password, and /auth returns a working token', async () => {
    const app = buildApp(new ScriptedSri());
    const { token, companyId } = await register(app);
    expect(token).toBeTruthy();

    const company = await IssuingCompany.findById(companyId).lean();
    expect(company!.certificate).toBe(testCertificate().p12.toString('base64'));
    expect(company!.certificate_password).toMatch(/^[0-9a-f]{32}:[0-9a-f]+$/);
    expect(company!.certificate_password).not.toContain(testCertificate().password);

    const login = await request(app)
      .post('/auth')
      .send({ email: `${RUC_A}@test.ec`, password: 'user-pass' });
    expect(login.status).toBe(200);
    expect(login.body.company.ruc).toBe(RUC_A);
    expect((await request(app).get('/api/v1/invoice').set(auth(login.body.token))).status).toBe(200);

    expect(
      (
        await request(app)
          .post('/auth')
          .send({ email: `${RUC_A}@test.ec`, password: 'bad' })
      ).status,
    ).toBe(401);
  });

  it('protected routes require a valid token', async () => {
    const app = buildApp(new ScriptedSri());
    expect((await request(app).post('/api/v1/invoice/complete').send(payload())).status).toBe(401);
    expect((await request(app).get('/api/v1/invoice').set('Authorization', 'Bearer garbage')).status).toBe(401);
  });
});

describe('POST /api/v1/invoice/complete — end to end with real XML + XAdES signer', () => {
  it('?esperar=true signs, sends, authorizes and exposes estado/xml; sequentials are consecutive', async () => {
    const sri = new ScriptedSri();
    const ride = new RecordingRide();
    const app = buildApp(sri, ride);
    const { token, companyId } = await register(app);
    await createProduct(app, token);

    const res = await request(app).post('/api/v1/invoice/complete?esperar=true').set(auth(token)).send(payload());
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({
      estado: 'AUTORIZADO',
      secuencial: '000000001',
      numero: '001-001-000000001',
      ambiente: 'PRUEBAS',
      total_sin_impuestos: 10,
      total_iva: 1.5,
      importe_total: 11.5,
      numero_autorizacion: '1'.repeat(49),
    });
    expect(res.body.data.clave_acceso).toMatch(/^\d{49}$/);
    expect(res.body.xml).toContain('<factura id="comprobante"');
    expect(res.body.xml).not.toContain('ds:Signature');

    // El SRI recibió un XML firmado XAdES-BES
    expect(sri.sent).toHaveLength(1);
    expect(sri.sent[0].environment).toBe('1');
    expect(sri.sent[0].xml).toContain('ds:Signature');
    expect(sri.sent[0].xml).toContain('xades:SignedProperties');
    expect(sri.sent[0].xml).toContain(res.body.data.clave_acceso);
    expect(sri.sent[0].xml).toContain(testCertificate().certificateBase64);
    expect(sri.authorizations).toEqual([res.body.data.clave_acceso]);
    expect(ride.published.map((i) => i.id)).toEqual([res.body.data.id]);

    const id = res.body.data.id;
    const estado = await request(app).get(`/api/v1/invoice/${id}/estado`).set(auth(token));
    expect(estado.status).toBe(200);
    expect(estado.body).toMatchObject({ id, estado: 'AUTORIZADO', secuencial: '000000001' });

    const xml = await request(app).get(`/api/v1/invoice/${id}/xml`).set(auth(token));
    expect(xml.status).toBe(200);
    expect(xml.headers['content-type']).toContain('application/xml');
    expect(xml.headers['content-disposition']).toContain(`${res.body.data.clave_acceso}.xml`);
    expect(xml.text).toBe(authorized().authorizedXml);

    const stored = await Invoice.findById(id).lean();
    expect(String(stored!.empresa_emisora_id)).toBe(companyId);
    expect(stored!.xml_firmado).toContain('xades:SignedProperties');
    expect(stored!.sri_estado).toBe('AUTORIZADO');

    const details = await InvoiceDetail.find({ factura_id: id }).lean();
    expect(details).toHaveLength(1);
    expect(details[0]).toMatchObject({
      codigo: 'SERV001',
      cantidad: 1,
      precio_unitario: 10,
      subtotal: 10,
      codigo_porcentaje_iva: '4',
      valor_iva: 1.5,
    });
    expect(details[0].producto_id).toBeDefined();

    const second = await request(app).post('/api/v1/invoice/complete?esperar=true').set(auth(token)).send(payload());
    expect(second.status).toBe(201);
    expect(second.body.data.secuencial).toBe('000000002');
    expect(second.body.data.clave_acceso).not.toBe(res.body.data.clave_acceso);

    const full = await request(app).get(`/api/v1/invoice/${id}`).set(auth(token));
    expect(full.status).toBe(200);
    expect(full.body.xml_firmado).toContain('ds:Signature');
  });

  it('GET /:xml falls back to the signed XML when there is no authorized XML', async () => {
    const sri = new ScriptedSri(undefined, [authorized({ authorizedXml: undefined })]);
    const app = buildApp(sri, null);
    const { token } = await register(app);
    await createProduct(app, token);
    const res = await request(app).post('/api/v1/invoice/complete?esperar=1').set(auth(token)).send(payload());
    expect(res.body.data.estado).toBe('AUTORIZADO');
    const xml = await request(app).get(`/api/v1/invoice/${res.body.data.id}/xml`).set(auth(token));
    expect(xml.text).toContain('xades:SignedProperties');
  });

  it('without ?esperar responds PENDIENTE immediately and authorizes in the background', async () => {
    const sri = new ScriptedSri();
    const app = buildApp(sri);
    const { token } = await register(app);
    await createProduct(app, token);

    const res = await request(app).post('/api/v1/invoice/complete').set(auth(token)).send(payload());
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.estado).toBe('PENDIENTE');

    await waitForStatus(res.body.data.id, 'AUTORIZADO');
    expect(sri.sent).toHaveLength(1);
  });

  it('DEVUELTA → success:false with SRI messages; POST /:id/enviar retries and authorizes', async () => {
    const devuelta = { identifier: '35', message: 'ARCHIVO NO CUMPLE ESTRUCTURA XML', type: 'ERROR' };
    const sri = new ScriptedSri([
      { status: 'DEVUELTA', messages: [devuelta] },
      { status: 'RECIBIDA', messages: [] },
    ]);
    const app = buildApp(sri);
    const { token } = await register(app);
    await createProduct(app, token);

    const res = await request(app).post('/api/v1/invoice/complete?esperar=true').set(auth(token)).send(payload());
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(false);
    expect(res.body.data.estado).toBe('DEVUELTA');
    expect(res.body.data.mensajes).toEqual([devuelta]);
    expect(sri.authorizations).toHaveLength(0);

    const retry = await request(app).post(`/api/v1/invoice/${res.body.data.id}/enviar`).set(auth(token));
    expect(retry.status).toBe(200);
    expect(retry.body.success).toBe(true);
    expect(retry.body.data.estado).toBe('AUTORIZADO');
    expect(sri.sent).toHaveLength(2);
    // reintento reutiliza la misma firma
    expect(sri.sent[1].xml).toBe(sri.sent[0].xml);

    // ya autorizada: enviar de nuevo es idempotente
    const again = await request(app).post(`/api/v1/invoice/${res.body.data.id}/enviar`).set(auth(token));
    expect(again.body.data.estado).toBe('AUTORIZADO');
    expect(sri.sent).toHaveLength(2);
  });

  it('wrong stored certificate password → ERROR_FIRMA mentioning the contraseña, nothing sent to SRI', async () => {
    const sri = new ScriptedSri();
    const app = buildApp(sri);
    const { token } = await register(app, RUC_A, { certificatePassword: 'clave-incorrecta' });
    await createProduct(app, token);

    const res = await request(app).post('/api/v1/invoice/complete?esperar=true').set(auth(token)).send(payload());
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(false);
    expect(res.body.data.estado).toBe('ERROR_FIRMA');
    expect(res.body.data.mensajes[0]).toMatchObject({ identifier: 'LOCAL', type: 'ERROR' });
    expect(res.body.data.mensajes[0].message).toMatch(/^Error al firmar XML: .*(clave|contraseña)/i);
    expect(sri.sent).toHaveLength(0);
  });

  // Regresión: firmaec.js 5.2.0 reporta
  // "Clave de firma incorrecta o archivo PKCS#12 dañado": el adaptador debe traducirlo a un mensaje claro.
  it('wrong certificate password message mentions "contraseña del certificado incorrecta"', async () => {
    const app = buildApp(new ScriptedSri());
    const { token } = await register(app, RUC_A, { certificatePassword: 'clave-incorrecta' });
    await createProduct(app, token);
    const res = await request(app).post('/api/v1/invoice/complete?esperar=true').set(auth(token)).send(payload());
    expect(res.body.data.mensajes[0].message).toMatch(/contraseña/i);
  });

  it('SRI communication failure → ERROR_COMUNICACION, then enviar succeeds', async () => {
    const sri = new ScriptedSri([
      new (await import('../../src/application/ports/sri')).SriCommunicationError('timeout'),
      { status: 'RECIBIDA', messages: [] },
    ]);
    const app = buildApp(sri);
    const { token } = await register(app);
    await createProduct(app, token);
    const res = await request(app).post('/api/v1/invoice/complete?esperar=true').set(auth(token)).send(payload());
    expect(res.body.data.estado).toBe('ERROR_COMUNICACION');
    const retry = await request(app).post(`/api/v1/invoice/${res.body.data.id}/enviar`).set(auth(token));
    expect(retry.body.data.estado).toBe('AUTORIZADO');
  });
});

describe('validation errors', () => {
  let app: App;
  let token: string;

  beforeEach(async () => {
    app = buildApp(new ScriptedSri());
    ({ token } = await register(app));
    await createProduct(app, token);
  });

  const post = (body: unknown) =>
    request(app)
      .post('/api/v1/invoice/complete?esperar=true')
      .set(auth(token))
      .send(body as object);

  it('missing factura → 400', async () => {
    const res = await post({});
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, message: 'Invoice data is required' });
  });

  it('totals mismatch → 400 and no sequential consumed', async () => {
    const res = await post(payload(RUC_A, { infoFactura: { importeTotal: '12.00' } }));
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/totales/i);
    expect(await Invoice.countDocuments()).toBe(0);

    const ok = await post(payload());
    expect(ok.body.data.secuencial).toBe('000000001');
  });

  it('unknown product → 400', async () => {
    const res = await post(payload(RUC_A, { detalles: [{ detalle: { codigoPrincipal: 'NOPE', cantidad: '1' } }] }));
    expect(res.status).toBe(400);
    expect(res.body.message).toContain('NOPE');
  });

  it('consumidor final over USD 50 → 400', async () => {
    const res = await post(
      payload(RUC_A, {
        infoFactura: { totalSinImpuestos: undefined, importeTotal: undefined },
        detalles: [{ detalle: { codigoPrincipal: 'SERV001', cantidad: '6', precioUnitario: '10.00' } }],
      }),
    );
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/consumidor final/i);
  });

  it('invalid JSON body → 400', async () => {
    const res = await request(app)
      .post('/api/v1/invoice/complete')
      .set(auth(token))
      .set('Content-Type', 'application/json')
      .send('{"factura": ');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ success: false, message: 'JSON inválido' });
  });

  it('unknown issuer RUC → 400', async () => {
    const res = await post(payload('0999999999001'));
    expect(res.status).toBe(400);
  });

  it('non-numeric cantidad → 400', async () => {
    const res = await post(
      payload(RUC_A, { detalles: [{ detalle: { codigoPrincipal: 'SERV001', cantidad: 'abc' } }] }),
    );
    expect(res.status).toBe(400);
  });
});

describe('tenant isolation', () => {
  let app: App;
  let a: Awaited<ReturnType<typeof register>>;
  let b: Awaited<ReturnType<typeof register>>;
  let invoiceA: string;

  beforeEach(async () => {
    app = buildApp(new ScriptedSri([{ status: 'DEVUELTA', messages: [] }]));
    a = await register(app, RUC_A);
    b = await register(app, RUC_B);
    await createProduct(app, a.token);
    const res = await request(app).post('/api/v1/invoice/complete?esperar=true').set(auth(a.token)).send(payload());
    expect(res.body.data.estado).toBe('DEVUELTA');
    invoiceA = res.body.data.id;
  });

  it("another company's token gets 404 on GET / estado / xml / enviar / DELETE", async () => {
    const h = auth(b.token);
    expect((await request(app).get(`/api/v1/invoice/${invoiceA}`).set(h)).status).toBe(404);
    expect((await request(app).get(`/api/v1/invoice/${invoiceA}/estado`).set(h)).status).toBe(404);
    expect((await request(app).get(`/api/v1/invoice/${invoiceA}/xml`).set(h)).status).toBe(404);
    expect((await request(app).post(`/api/v1/invoice/${invoiceA}/enviar`).set(h)).status).toBe(404);
    expect((await request(app).delete(`/api/v1/invoice/${invoiceA}`).set(h)).status).toBe(404);
    expect(await Invoice.exists({ _id: invoiceA })).toBeTruthy();
  });

  it("cannot issue with another company's RUC (403)", async () => {
    const res = await request(app)
      .post('/api/v1/invoice/complete?esperar=true')
      .set(auth(b.token))
      .send(payload(RUC_A));
    expect(res.status).toBe(403);
    expect(await Invoice.countDocuments()).toBe(1);
  });

  it('GET /api/v1/invoice lists only own invoices and omits xml fields', async () => {
    const listA = await request(app).get('/api/v1/invoice').set(auth(a.token));
    expect(listA.status).toBe(200);
    expect(listA.body).toHaveLength(1);
    expect(listA.body[0]._id).toBe(invoiceA);
    for (const field of ['xml', 'xml_firmado', 'xml_autorizado', 'ride_pdf', 'datos_originales']) {
      expect(listA.body[0]).not.toHaveProperty(field);
    }
    const listB = await request(app).get('/api/v1/invoice').set(auth(b.token));
    expect(listB.body).toEqual([]);
  });

  it('unknown or malformed invoice ids → 404', async () => {
    expect((await request(app).get(`/api/v1/invoice/${new Types.ObjectId()}/estado`).set(auth(a.token))).status).toBe(
      404,
    );
    expect((await request(app).get('/api/v1/invoice/not-an-id/estado').set(auth(a.token))).status).toBe(404);
  });

  it('owner can DELETE a non-authorized invoice', async () => {
    const res = await request(app).delete(`/api/v1/invoice/${invoiceA}`).set(auth(a.token));
    expect(res.status).toBe(200);
    expect(await Invoice.exists({ _id: invoiceA })).toBeNull();
  });

  // Un token sin companyId (usuario cuya empresa ya no existe) no puede operar sobre facturas.
  it('a token without companyId is rejected with 403', async () => {
    await IssuingCompany.findByIdAndDelete(b.companyId);
    const login = await request(app)
      .post('/auth')
      .send({ email: `${RUC_B}@test.ec`, password: 'user-pass' });
    expect(login.body.company).toBeNull();
    const list = await request(app).get('/api/v1/invoice').set(auth(login.body.token));
    expect(list.status).toBe(403);
    const issue = await request(app).post('/api/v1/invoice/complete').set(auth(login.body.token)).send({ factura: {} });
    expect([400, 403]).toContain(issue.status);
  });
});

describe('DELETE of an authorized invoice', () => {
  it('returns 409 and keeps the invoice', async () => {
    const app = buildApp(new ScriptedSri());
    const { token } = await register(app);
    await createProduct(app, token);
    const res = await request(app).post('/api/v1/invoice/complete?esperar=true').set(auth(token)).send(payload());
    const del = await request(app).delete(`/api/v1/invoice/${res.body.data.id}`).set(auth(token));
    expect(del.status).toBe(409);
    expect(await Invoice.exists({ _id: res.body.data.id })).toBeTruthy();
  });

  // Regresión: DELETE también borra los InvoiceDetail de la factura.
  it('deleting a draft invoice also removes its InvoiceDetail rows', async () => {
    const app = buildApp(new ScriptedSri([{ status: 'DEVUELTA', messages: [] }]));
    const { token } = await register(app);
    await createProduct(app, token);
    const res = await request(app).post('/api/v1/invoice/complete?esperar=true').set(auth(token)).send(payload());
    expect((await request(app).delete(`/api/v1/invoice/${res.body.data.id}`).set(auth(token))).status).toBe(200);
    expect(await InvoiceDetail.countDocuments({ factura_id: res.body.data.id })).toBe(0);
  });
});

describe('issuing-company never exposes the certificate', () => {
  it('GET list and GET /:id return tiene_certificado instead of certificate/certificate_password', async () => {
    const app = buildApp(new ScriptedSri());
    const { token, companyId } = await register(app);

    const list = await request(app).get('/api/v1/issuing-company').set(auth(token));
    expect(list.status).toBe(200);
    for (const c of list.body) {
      expect(c).not.toHaveProperty('certificate');
      expect(c).not.toHaveProperty('certificate_password');
      expect(c.tiene_certificado).toBe(true);
    }
    const one = await request(app).get(`/api/v1/issuing-company/${companyId}`).set(auth(token));
    expect(one.status).toBe(200);
    expect(one.body).not.toHaveProperty('certificate');
    expect(one.body).not.toHaveProperty('certificate_password');
    expect(one.body.tiene_certificado).toBe(true);
    expect(JSON.stringify(one.body)).not.toContain(testCertificate().p12.toString('base64').slice(0, 40));
  });

  it('PUT with certificatePath does not read the file; certificate unchanged', async () => {
    const app = buildApp(new ScriptedSri());
    const { token, companyId } = await register(app);
    const before = await IssuingCompany.findById(companyId).lean();

    const res = await request(app)
      .put(`/api/v1/issuing-company/${companyId}`)
      .set(auth(token))
      .send({ certificatePath: '/etc/passwd', nombre_comercial: 'NUEVO NOMBRE' });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('certificate');
    expect(res.body.nombre_comercial).toBe('NUEVO NOMBRE');

    const after = await IssuingCompany.findById(companyId).lean();
    expect(after!.certificate).toBe(before!.certificate);
    expect(after!.certificate_password).toBe(before!.certificate_password);
    expect(after).not.toHaveProperty('certificatePath');
  });

  it('PUT with certificate_password re-encrypts it', async () => {
    const app = buildApp(new ScriptedSri());
    const { token, companyId } = await register(app);
    await request(app)
      .put(`/api/v1/issuing-company/${companyId}`)
      .set(auth(token))
      .send({ certificate_password: 'nueva' });
    const after = await IssuingCompany.findById(companyId).lean();
    expect(after!.certificate_password).toMatch(/^[0-9a-f]{32}:[0-9a-f]+$/);
  });

  // Regresión: /api/v1/issuing-company está acotado a la empresa del token.
  it('GET /api/v1/issuing-company lists only the caller company', async () => {
    const app = buildApp(new ScriptedSri());
    const a = await register(app, RUC_A);
    await register(app, RUC_B);
    const list = await request(app).get('/api/v1/issuing-company').set(auth(a.token));
    expect(list.body.map((c: { ruc: string }) => c.ruc)).toEqual([RUC_A]);
  });

  it("PUT /api/v1/issuing-company/:id cannot modify another tenant's company", async () => {
    const app = buildApp(new ScriptedSri());
    const a = await register(app, RUC_A);
    const b = await register(app, RUC_B);
    const res = await request(app)
      .put(`/api/v1/issuing-company/${a.companyId}`)
      .set(auth(b.token))
      .send({ certificate: 'QUFBQQ==' });
    expect([403, 404]).toContain(res.status);
  });
});

describe('búsquedas por clave lógica (aporte de #19)', () => {
  it('producto por código, cliente por identificación y tipo de identificación por código', async () => {
    const app = buildApp(new ScriptedSri());
    const { token } = await register(app);
    const h = auth(token);

    await request(app)
      .post('/api/v1/product')
      .set(h)
      .send({ codigo: 'P-001', descripcion: 'Producto', precio_unitario: 5, tiene_iva: true });
    const type = await request(app)
      .post('/api/v1/identification-type')
      .set(h)
      .send({ codigo: '05', descripcion: 'CEDULA' });
    await request(app)
      .post('/api/v1/client')
      .set(h)
      .send({ tipo_identificacion_id: type.body._id, identificacion: '0102030405', razon_social: 'Cliente Uno' });

    const product = await request(app).get('/api/v1/product/code/P-001').set(h);
    expect(product.status).toBe(200);
    expect(product.body.descripcion).toBe('Producto');

    const client = await request(app).get('/api/v1/client/docid/0102030405').set(h);
    expect(client.status).toBe(200);
    expect(client.body.razon_social).toBe('Cliente Uno');

    const idType = await request(app).get('/api/v1/identification-type/code/05').set(h);
    expect(idType.status).toBe(200);
    expect(idType.body.descripcion).toBe('CEDULA');

    expect((await request(app).get('/api/v1/product/code/NOPE').set(h)).status).toBe(404);
    expect((await request(app).get('/api/v1/client/docid/9999999999').set(h)).status).toBe(404);
    expect((await request(app).get('/api/v1/identification-type/code/99').set(h)).status).toBe(404);
  });
});
