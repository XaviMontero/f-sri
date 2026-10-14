import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { clearMongo, startMongo, stopMongo } from '../helpers/mongo';
import { StorageRidePublisher } from '../../src/infrastructure/ride/StorageRidePublisher';
import IssuingCompany from '../../src/models/IssuingCompany';
import InvoicePDF from '../../src/models/InvoicePDF';
import { InvoiceRecord } from '../../src/application/ports/repositories';
import { IPDFStorageProvider } from '../../src/interfaces/pdf-storage.interface';
import { RideData } from '../../src/utils/pdf.utils';

beforeAll(startMongo);
afterAll(stopMongo);
beforeEach(clearMongo);

function invoiceFor(issuerId: string, overrides: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: String(new Types.ObjectId()),
    issuerId,
    buyer: { idType: '07', id: '9999999999999', name: 'CONSUMIDOR FINAL' },
    accessKey: '1310202601010607978300110010010000000011234567811',
    sequential: '000000001',
    number: '001-001-000000001',
    environment: '1',
    emissionDate: new Date('2026-10-13T00:00:00Z'),
    subtotal: 10,
    totalTax: 1.5,
    total: 11.5,
    status: 'AUTORIZADO',
    xml: '<factura/>',
    authorizationNumber: 'AUTH-1',
    authorizationDate: new Date('2026-10-13T20:00:00Z'),
    lines: [],
    ...overrides,
  };
}

class FakeStorage implements IPDFStorageProvider {
  uploads: Array<{ buffer: Buffer; filename: string }> = [];
  constructor(private readonly url = 'https://cdn.test/factura.pdf') {}
  async upload(buffer: Buffer, filename: string) {
    this.uploads.push({ buffer, filename });
    return { url: this.url, publicId: filename, provider: 'fake', size: buffer.length };
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

describe('StorageRidePublisher', () => {
  let issuerId: string;

  beforeEach(async () => {
    const company = await IssuingCompany.create({
      ruc: '0106079783001',
      razon_social: 'EMPRESA',
      nombre_comercial: 'EMPRESA',
      direccion: 'CUENCA',
      user_id: new Types.ObjectId(),
    });
    issuerId = String(company._id);
  });

  it('renders the PDF with invoice + issuer, uploads it and creates the InvoicePDF row', async () => {
    const storage = new FakeStorage();
    const rendered: RideData[] = [];
    const publisher = new StorageRidePublisher({
      storage: () => storage,
      renderPdf: async (data) => {
        rendered.push(data);
        return Buffer.from('%PDF-fake');
      },
    });
    const invoice = invoiceFor(issuerId);
    await publisher.publish(invoice);

    expect(rendered).toHaveLength(1);
    expect(rendered[0].invoice).toBe(invoice);
    expect(rendered[0].issuer).toMatchObject({
      id: issuerId,
      issuer: { ruc: '0106079783001', headOfficeAddress: 'CUENCA' },
    });
    expect(storage.uploads[0].filename).toBe(`factura_000000001_${invoice.accessKey}`);

    const rows = await InvoicePDF.find().lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      factura_id: invoice.id,
      claveAcceso: invoice.accessKey,
      pdf_url: 'https://cdn.test/factura.pdf',
      pdf_public_id: `factura_000000001_${invoice.accessKey}`,
      pdf_provider: 'fake',
      tamano_archivo: 9,
      numero_autorizacion: 'AUTH-1',
      fecha_autorizacion: invoice.authorizationDate,
      estado: 'GENERADO',
      email_estado: 'NO_ENVIADO',
      email_intentos: 0,
    });
  });

  it('upserts on the same access key instead of duplicating', async () => {
    const invoice = invoiceFor(issuerId);
    const render = async () => Buffer.from('pdf');
    await new StorageRidePublisher({
      storage: () => new FakeStorage('https://cdn.test/v1.pdf'),
      renderPdf: render,
    }).publish(invoice);
    await new StorageRidePublisher({
      storage: () => new FakeStorage('https://cdn.test/v2.pdf'),
      renderPdf: render,
    }).publish(invoice);

    const rows = await InvoicePDF.find().lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].pdf_url).toBe('https://cdn.test/v2.pdf');
  });

  it('falls back to the access key when there is no authorization number', async () => {
    const invoice = invoiceFor(issuerId, { authorizationNumber: undefined, authorizationDate: undefined });
    await new StorageRidePublisher({
      storage: () => new FakeStorage(),
      renderPdf: async () => Buffer.from('x'),
    }).publish(invoice);
    const row = await InvoicePDF.findOne({ claveAcceso: invoice.accessKey }).lean();
    expect(row!.numero_autorizacion).toBe(invoice.accessKey);
    expect(row!.fecha_autorizacion).toBeInstanceOf(Date);
  });

  it('throws when the issuing company does not exist', async () => {
    const publisher = new StorageRidePublisher({
      storage: () => new FakeStorage(),
      renderPdf: async () => Buffer.from('x'),
    });
    await expect(publisher.publish(invoiceFor(String(new Types.ObjectId())))).rejects.toThrow(
      /Empresa emisora no encontrada/,
    );
    expect(await InvoicePDF.countDocuments()).toBe(0);
  });
});
