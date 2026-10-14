import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { clearMongo, startMongo, stopMongo } from '../helpers/mongo';
import IssuingCompany from '../../src/models/IssuingCompany';
import Client from '../../src/models/Client';
import Product from '../../src/models/Product';
import Invoice from '../../src/models/Invoice';
import InvoiceDetail from '../../src/models/InvoiceDetail';
import Counter from '../../src/models/Counter';
import { MongoIssuerRepository } from '../../src/infrastructure/persistence/MongoIssuerRepository';
import { MongoBuyerRepository } from '../../src/infrastructure/persistence/MongoBuyerRepository';
import { MongoProductRepository } from '../../src/infrastructure/persistence/MongoProductRepository';
import { MongoInvoiceRepository } from '../../src/infrastructure/persistence/MongoInvoiceRepository';
import { MongoSequenceGenerator } from '../../src/infrastructure/persistence/MongoSequenceGenerator';
import { MongoCertificateStore, decryptPassword } from '../../src/infrastructure/certificates/MongoCertificateStore';
import { encrypt } from '../../src/utils/encryption.utils';
import { NewInvoiceRecord } from '../../src/application/ports/repositories';

const RUC = '0106079783001';

function companyData(overrides: Record<string, unknown> = {}) {
  return {
    ruc: RUC,
    razon_social: 'EMPRESA DE PRUEBA',
    nombre_comercial: 'PRUEBA',
    codigo_establecimiento: '001',
    punto_emision: '001',
    tipo_ambiente: 1,
    tipo_emision: 1,
    user_id: new Types.ObjectId(),
    ...overrides,
  };
}

function newInvoice(issuerId: string, overrides: Partial<NewInvoiceRecord> = {}): NewInvoiceRecord {
  return {
    issuerId,
    buyer: { idType: '05', id: '0102030405', name: 'JUAN PEREZ', address: 'CUENCA', email: 'j@x.ec', phone: '0999' },
    accessKey: '1310202601010607978300110010010000000011234567811',
    sequential: '000000001',
    number: '001-001-000000001',
    environment: '1',
    emissionDate: new Date('2026-10-13T00:00:00Z'),
    subtotal: 10,
    totalTax: 1.5,
    total: 11.5,
    status: 'PENDIENTE',
    xml: '<factura id="comprobante"/>',
    lines: [
      {
        productId: String(new Types.ObjectId()),
        code: 'SERV001',
        description: 'Servicio',
        quantity: 1,
        unitPrice: 10,
        discount: 0,
        subtotal: 10,
        ivaCode: '4',
        ivaRate: 15,
        taxValue: 1.5,
      },
      {
        code: 'SERV002',
        description: 'Otro',
        quantity: 2,
        unitPrice: 0,
        discount: 0,
        subtotal: 0,
        ivaCode: '0',
        ivaRate: 0,
        taxValue: 0,
      },
    ],
    request: { factura: { a: 1 } },
    ...overrides,
  };
}

beforeAll(startMongo);
afterAll(stopMongo);
beforeEach(clearMongo);

describe('MongoIssuerRepository', () => {
  const repo = new MongoIssuerRepository();

  it('returns null for an unknown RUC', async () => {
    expect(await repo.findByRuc('9999999999001')).toBeNull();
  });

  it('maps the Spanish fields to the Issuer aggregate', async () => {
    const company = await IssuingCompany.create(
      companyData({
        direccion_matriz: 'MATRIZ AV 1',
        direccion_establecimiento: 'SUCURSAL AV 2',
        direccion: 'GENERICA',
        email: 'e@x.ec',
        telefono: '072',
        codigo_establecimiento: '002',
        punto_emision: '003',
        tipo_ambiente: 2,
        obligado_contabilidad: true,
        contribuyente_especial: '5368',
      }),
    );
    const record = await repo.findByRuc(RUC);
    expect(record).toEqual({
      id: String(company._id),
      userId: String(company.user_id),
      email: 'e@x.ec',
      phone: '072',
      issuer: {
        ruc: RUC,
        businessName: 'EMPRESA DE PRUEBA',
        tradeName: 'PRUEBA',
        headOfficeAddress: 'MATRIZ AV 1',
        establishmentAddress: 'SUCURSAL AV 2',
        establishment: '002',
        emissionPoint: '003',
        environment: '2',
        emissionType: '1',
        keepsAccounting: true,
        specialTaxpayer: '5368',
      },
    });
  });

  it('falls back to `direccion` for both addresses and defaults to pruebas', async () => {
    await IssuingCompany.create(companyData({ direccion: 'SOLO DIRECCION', tipo_ambiente: 1 }));
    const { issuer } = (await repo.findByRuc(RUC))!;
    expect(issuer.headOfficeAddress).toBe('SOLO DIRECCION');
    expect(issuer.establishmentAddress).toBe('SOLO DIRECCION');
    expect(issuer.environment).toBe('1');
    expect(issuer.keepsAccounting).toBe(false);
    expect(issuer.specialTaxpayer).toBeUndefined();
  });

  it('uses empty head-office address and undefined establishment address when no address is stored', async () => {
    await IssuingCompany.create(companyData());
    const { issuer } = (await repo.findByRuc(RUC))!;
    expect(issuer.headOfficeAddress).toBe('');
    expect(issuer.establishmentAddress).toBeUndefined();
  });

  it('treats any tipo_ambiente other than 2 as pruebas (1)', async () => {
    await IssuingCompany.create(companyData({ tipo_ambiente: 3 }));
    expect((await repo.findByRuc(RUC))!.issuer.environment).toBe('1');
  });
});

describe('MongoBuyerRepository', () => {
  const repo = new MongoBuyerRepository();

  it('returns null when the client does not exist', async () => {
    expect(await repo.findByIdentification('0102030405')).toBeNull();
  });

  it('maps a stored client and turns empty optional fields into undefined', async () => {
    const client = await Client.create({
      tipo_identificacion_id: new Types.ObjectId(),
      identificacion: '0102030405',
      razon_social: 'JUAN PEREZ',
      direccion: 'CUENCA',
      email: '',
      telefono: '0999',
    });
    expect(await repo.findByIdentification('0102030405')).toEqual({
      recordId: String(client._id),
      idType: '',
      id: '0102030405',
      name: 'JUAN PEREZ',
      address: 'CUENCA',
      email: undefined,
      phone: '0999',
    });
  });
});

describe('MongoProductRepository', () => {
  const repo = new MongoProductRepository();

  it('returns a map keyed by code with only the requested products (deduplicated codes)', async () => {
    const p1 = await Product.create({
      codigo: 'A',
      descripcion: 'Prod A',
      precio_unitario: 1.25,
      tiene_iva: true,
      descripcion_adicional: 'extra',
    });
    await Product.create({ codigo: 'B', descripcion: 'Prod B', precio_unitario: 2, tiene_iva: false });
    await Product.create({ codigo: 'C', descripcion: 'Prod C', precio_unitario: 3, tiene_iva: true });

    const map = await repo.findByCodes(['A', 'B', 'A', 'Z']);
    expect([...map.keys()].sort()).toEqual(['A', 'B']);
    expect(map.get('A')).toEqual({
      id: String(p1._id),
      code: 'A',
      description: 'Prod A',
      unitPrice: 1.25,
      chargesIva: true,
      additionalDescription: 'extra',
    });
    expect(map.get('B')!.chargesIva).toBe(false);
  });

  it('returns an empty map when nothing matches', async () => {
    expect((await repo.findByCodes(['X'])).size).toBe(0);
  });
});

describe('MongoInvoiceRepository', () => {
  const repo = new MongoInvoiceRepository();
  let issuerId: string;

  beforeEach(async () => {
    issuerId = String((await IssuingCompany.create(companyData()))._id);
  });

  it('create persists the invoice with Spanish fields and inserts one InvoiceDetail per line', async () => {
    const buyerRecordId = String(new Types.ObjectId());
    const input = newInvoice(issuerId, { buyerRecordId });
    const created = await repo.create(input);

    const doc = await Invoice.findById(created.id).lean();
    expect(doc).toMatchObject({
      numero: '001-001-000000001',
      ambiente: '1',
      clave_acceso: input.accessKey,
      secuencial: '000000001',
      estado: 'PENDIENTE',
      sri_estado: 'PENDIENTE',
      total_sin_impuestos: 10,
      total_iva: 1.5,
      total_con_impuestos: 11.5,
      xml: input.xml,
      datos_originales: JSON.stringify(input.request),
      comprador: {
        tipo_identificacion: '05',
        identificacion: '0102030405',
        razon_social: 'JUAN PEREZ',
        direccion: 'CUENCA',
      },
    });
    expect(String(doc!.empresa_emisora_id)).toBe(issuerId);
    expect(String(doc!.cliente_id)).toBe(buyerRecordId);

    const details = await InvoiceDetail.find({ factura_id: created.id }).sort({ codigo: 1 }).lean();
    expect(details).toHaveLength(2);
    expect(details[0]).toMatchObject({
      codigo: 'SERV001',
      descripcion: 'Servicio',
      cantidad: 1,
      precio_unitario: 10,
      descuento: 0,
      subtotal: 10,
      codigo_porcentaje_iva: '4',
      valor_iva: 1.5,
    });
    expect(String(details[0].producto_id)).toBe(input.lines[0].productId);
    expect(details[1].producto_id).toBeUndefined();
  });

  it('create returns a record that round-trips through findById', async () => {
    const input = newInvoice(issuerId);
    const created = await repo.create(input);
    const { request: _req, ...expected } = input;

    expect(created).toMatchObject({ ...expected, id: expect.any(String) });
    expect(created.lines.map((l) => l.ivaRate)).toEqual([15, 0]);
    expect(created.signedXml).toBeUndefined();
    expect(created.authorizedXml).toBeUndefined();
    expect(created.buyerRecordId).toBeUndefined();

    const found = await repo.findById(created.id);
    expect(found).toEqual(created);
  });

  it('create without request leaves datos_originales unset', async () => {
    const created = await repo.create(newInvoice(issuerId, { request: undefined }));
    const doc = await Invoice.findById(created.id).lean();
    expect(doc!.datos_originales).toBeUndefined();
  });

  it('findById returns null for invalid ObjectIds and for missing documents', async () => {
    expect(await repo.findById('not-an-id')).toBeNull();
    expect(await repo.findById(String(new Types.ObjectId()))).toBeNull();
  });

  it('update maps each field to its Mongo column and returns the updated record', async () => {
    const created = await repo.create(newInvoice(issuerId));
    const sentAt = new Date('2026-10-13T17:00:00Z');
    const respondedAt = new Date('2026-10-13T17:00:05Z');
    const authorizationDate = new Date('2026-10-13T17:00:06Z');
    const messages = [{ identifier: '60', message: 'OK', type: 'INFORMATIVO' }];

    const updated = await repo.update(created.id, {
      status: 'AUTORIZADO',
      signedXml: '<signed/>',
      authorizedXml: '<authorized/>',
      authorizationNumber: '1234',
      authorizationDate,
      sentAt,
      respondedAt,
      messages,
    });

    const doc = await Invoice.findById(created.id).lean();
    expect(doc).toMatchObject({
      estado: 'AUTORIZADO',
      sri_estado: 'AUTORIZADO',
      xml_firmado: '<signed/>',
      xml_autorizado: '<authorized/>',
      autorizacion_numero: '1234',
      fecha_autorizacion: authorizationDate,
      sri_fecha_envio: sentAt,
      sri_fecha_respuesta: respondedAt,
      sri_mensajes: messages,
    });
    expect(updated).toMatchObject({
      status: 'AUTORIZADO',
      signedXml: '<signed/>',
      authorizedXml: '<authorized/>',
      authorizationNumber: '1234',
      authorizationDate,
      sentAt,
      respondedAt,
      messages,
    });
    expect(updated.lines).toHaveLength(2);
  });

  it('partial update leaves untouched fields alone', async () => {
    const created = await repo.create(newInvoice(issuerId));
    await repo.update(created.id, { signedXml: '<s/>', status: 'FIRMADA' });
    const updated = await repo.update(created.id, { messages: [] });
    expect(updated.signedXml).toBe('<s/>');
    expect(updated.status).toBe('FIRMADA');
    expect(updated.messages).toEqual([]);
  });

  it('update of a missing invoice throws NotFoundError', async () => {
    await expect(repo.update(String(new Types.ObjectId()), { status: 'X' })).rejects.toMatchObject({
      name: 'NotFoundError',
      httpStatus: 404,
    });
  });

  it('toRecord tolerates legacy documents (no comprador/numero/ambiente, estado only)', async () => {
    const legacy = await Invoice.create({
      empresa_emisora_id: issuerId,
      fecha_emision: new Date(),
      clave_acceso: 'LEGACY',
      secuencial: '000000077',
      estado: 'AUTORIZADO',
      total_sin_impuestos: 1,
      total_iva: 0,
      total_con_impuestos: 1,
      xml: '<x/>',
      sri_mensajes: 'not-an-array',
    });
    await InvoiceDetail.create({
      factura_id: legacy._id,
      cantidad: 1,
      precio_unitario: 1,
      subtotal: 1,
      valor_iva: 0,
      codigo_porcentaje_iva: 'ZZ',
    });
    const record = (await repo.findById(String(legacy._id)))!;
    expect(record).toMatchObject({
      number: '000000077',
      environment: '1',
      status: 'AUTORIZADO',
      buyer: { idType: '', id: '', name: '' },
      messages: undefined,
    });
    expect(record.lines[0]).toMatchObject({ code: '', description: '', ivaCode: 'ZZ', ivaRate: 0, discount: 0 });
  });
});

describe('MongoSequenceGenerator', () => {
  const gen = new MongoSequenceGenerator();
  const key = { ruc: RUC, establishment: '001', emissionPoint: '001', documentType: '01' };

  it('starts at 000000001 and increments', async () => {
    await IssuingCompany.create(companyData());
    expect(await gen.next(key)).toBe('000000001');
    expect(await gen.next(key)).toBe('000000002');
    expect(await Counter.findById(`${RUC}-001-001-01`).lean()).toMatchObject({ seq: 2 });
  });

  it('starts at 000000001 even when the company does not exist', async () => {
    expect(await gen.next({ ...key, ruc: '1790000000001' })).toBe('000000001');
  });

  it('seeds the counter from the highest secuencial already issued by that company', async () => {
    const company = await IssuingCompany.create(companyData());
    const other = await IssuingCompany.create(companyData({ ruc: '1790000000001' }));
    const base = {
      fecha_emision: new Date(),
      estado: 'AUTORIZADO',
      total_sin_impuestos: 1,
      total_iva: 0,
      total_con_impuestos: 1,
    };
    await Invoice.create([
      { ...base, empresa_emisora_id: company._id, clave_acceso: 'k1', secuencial: '000000041' },
      { ...base, empresa_emisora_id: company._id, clave_acceso: 'k2', secuencial: '000000007' },
      { ...base, empresa_emisora_id: other._id, clave_acceso: 'k3', secuencial: '000000900' },
    ]);
    expect(await gen.next(key)).toBe('000000042');
    expect(await gen.next(key)).toBe('000000043');
  });

  it('20 concurrent next() calls produce 20 unique consecutive values', async () => {
    await IssuingCompany.create(companyData());
    const values = await Promise.all(Array.from({ length: 20 }, () => gen.next(key)));
    expect(new Set(values).size).toBe(20);
    expect([...values].sort()).toEqual(Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(9, '0')));
  });

  it('keeps separate counters per establishment / emission point / document type', async () => {
    await IssuingCompany.create(companyData());
    expect(await gen.next(key)).toBe('000000001');
    expect(await gen.next(key)).toBe('000000002');
    expect(await gen.next({ ...key, establishment: '002' })).toBe('000000001');
    expect(await gen.next({ ...key, emissionPoint: '002' })).toBe('000000001');
    expect(await gen.next({ ...key, documentType: '04' })).toBe('000000001');
    expect(await gen.next(key)).toBe('000000003');
    expect(await Counter.countDocuments()).toBe(4);
  });
});

describe('MongoCertificateStore', () => {
  const store = new MongoCertificateStore();
  const p12 = Buffer.from('fake-p12-binary-content');

  it('decrypts `iv:hex` encrypted passwords', async () => {
    const company = await IssuingCompany.create(
      companyData({ certificate: p12.toString('base64'), certificate_password: encrypt('s3cr3t-clave') }),
    );
    const cert = await store.forIssuer(String(company._id));
    expect(cert.p12.equals(p12)).toBe(true);
    expect(cert.password).toBe('s3cr3t-clave');
  });

  it('accepts legacy plaintext passwords', async () => {
    const company = await IssuingCompany.create(
      companyData({ certificate: p12.toString('base64'), certificate_password: 'plain:text' }),
    );
    expect((await store.forIssuer(String(company._id))).password).toBe('plain:text');
  });

  it('uses an empty password when none is stored', async () => {
    const company = await IssuingCompany.create(companyData({ certificate: p12.toString('base64') }));
    expect((await store.forIssuer(String(company._id))).password).toBe('');
  });

  it('throws when the company has no certificate', async () => {
    const company = await IssuingCompany.create(companyData());
    await expect(store.forIssuer(String(company._id))).rejects.toThrow(/no tiene certificado/);
  });

  it('throws when the certificate is blank', async () => {
    const company = await IssuingCompany.create(companyData({ certificate: '   ' }));
    await expect(store.forIssuer(String(company._id))).rejects.toThrow(/no tiene certificado/);
  });

  it('throws when the certificate is not valid base64 (decodes to nothing)', async () => {
    const company = await IssuingCompany.create(companyData({ certificate: '!!!' }));
    await expect(store.forIssuer(String(company._id))).rejects.toThrow(/vacío o no es base64/);
  });

  it('throws when the company does not exist', async () => {
    await expect(store.forIssuer(String(new Types.ObjectId()))).rejects.toThrow(/no tiene certificado/);
  });

  it('decryptPassword only decrypts the iv:hex shape', () => {
    const enc = encrypt('abc');
    expect(decryptPassword(enc)).toBe('abc');
    expect(decryptPassword('abc')).toBe('abc');
    expect(decryptPassword('')).toBe('');
  });
});
