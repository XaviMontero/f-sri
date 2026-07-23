import fs from 'fs';
import os from 'os';
import path from 'path';
import forge from 'node-forge';

const firmarXMLMock = jest.fn().mockResolvedValue('<factura>firmada</factura>');
jest.mock('../../src/utils/firma.utils', () => ({
  firmarXML: (...args: any[]) => firmarXMLMock(...args),
}));

const enviarComprobanteSRIMock = jest.fn();
const autorizarComprobanteSRIMock = jest.fn();
jest.mock('../../src/utils/sri.utils', () => ({
  enviarComprobanteSRI: (...args: any[]) => enviarComprobanteSRIMock(...args),
  autorizarComprobanteSRI: (...args: any[]) => autorizarComprobanteSRIMock(...args),
}));

const generateInvoicePDFMock = jest.fn().mockResolvedValue(Buffer.from('pdf'));
jest.mock('../../src/utils/pdf.utils', () => ({
  generateInvoicePDF: (...args: any[]) => generateInvoicePDFMock(...args),
}));

const storageUploadMock = jest
  .fn()
  .mockResolvedValue({ url: 'https://cdn/f.pdf', publicId: 'f-1', provider: 'local', size: 3 });
jest.mock('../../src/services/storage', () => ({
  PDFStorageFactory: { create: () => ({ upload: storageUploadMock, getProviderName: () => 'local' }) },
}));

// --- Model mocks ---
const invoiceStatics = { findOne: jest.fn(), findById: jest.fn() };
const savedInvoices: any[] = [];
jest.mock('../../src/models/Invoice', () => {
  class MockInvoice {
    [key: string]: any;
    constructor(data: any) {
      Object.assign(this, data);
      this._id = 'factura-1';
      savedInvoices.push(this);
    }
    save = jest.fn().mockResolvedValue(this);
    static findOne = (...args: any[]) => invoiceStatics.findOne(...args);
    static findById = (...args: any[]) => invoiceStatics.findById(...args);
  }
  return { __esModule: true, default: MockInvoice };
});

const savedDetails: any[] = [];
jest.mock('../../src/models/InvoiceDetail', () => {
  class MockDetail {
    [key: string]: any;
    constructor(data: any) {
      Object.assign(this, data);
      savedDetails.push(this);
    }
    save = jest.fn().mockResolvedValue(this);
  }
  return { __esModule: true, default: MockDetail };
});

const savedPDFs: any[] = [];
jest.mock('../../src/models/InvoicePDF', () => {
  class MockPDF {
    [key: string]: any;
    constructor(data: any) {
      Object.assign(this, data);
      savedPDFs.push(this);
    }
    save = jest.fn().mockResolvedValue(this);
  }
  return { __esModule: true, default: MockPDF };
});

const identificationTypeStatics = { findOne: jest.fn() };
jest.mock('../../src/models/IdentificationType', () => ({
  __esModule: true,
  default: { findOne: (...args: any[]) => identificationTypeStatics.findOne(...args) },
}));

const issuingCompanyStatics = { findOne: jest.fn() };
jest.mock('../../src/models/IssuingCompany', () => ({
  __esModule: true,
  default: { findOne: (...args: any[]) => issuingCompanyStatics.findOne(...args) },
}));

const clientStatics = { findOne: jest.fn() };
jest.mock('../../src/models/Client', () => ({
  __esModule: true,
  default: { findOne: (...args: any[]) => clientStatics.findOne(...args) },
}));

const productStatics = { findOne: jest.fn() };
jest.mock('../../src/models/Product', () => ({
  __esModule: true,
  default: { findOne: (...args: any[]) => productStatics.findOne(...args) },
}));

import { InvoiceService } from '../../src/services/invoice.service';
import { InvoiceRequest } from '../../src/interfaces/invoice.interface';

const P12_PASSWORD = 'test-p12-password';
let p12Path: string;
let p12Base64: string;

function crearP12(): void {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = '01';
  cert.validity.notBefore = new Date();
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 1);
  const attrs = [
    { shortName: 'CN', value: 'JUAN PEREZ' },
    { shortName: 'C', value: 'EC' },
  ];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  const p12Asn1 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, cert, P12_PASSWORD);
  const buffer = Buffer.from(forge.asn1.toDer(p12Asn1).getBytes(), 'binary');
  p12Path = path.join(os.tmpdir(), `invoice-svc-test-${Date.now()}.p12`);
  fs.writeFileSync(p12Path, buffer);
  p12Base64 = buffer.toString('base64');
}

const empresaBase = () => ({
  _id: 'empresa-1',
  ruc: '1790012345001',
  razon_social: 'EMPRESA DEMO S.A.',
  nombre_comercial: 'DEMO',
  codigo_establecimiento: '001',
  punto_emision: '001',
  tipo_ambiente: 1,
  tipo_emision: 1,
  direccion_matriz: 'Av. Principal',
  direccion_establecimiento: 'Av. Principal',
  obligado_contabilidad: true,
  toObject() {
    return { ...this };
  },
});

const clienteMock: any = { _id: 'cliente-1', razon_social: 'CLIENTE', identificacion: '0106079783' };
const productoMock: any = { _id: 'producto-1', codigo: 'P001', tiene_iva: true, precio_unitario: 100 };

const requestValido: InvoiceRequest = {
  infoTributaria: { ruc: '1790012345001', claveAcceso: '', secuencial: '' },
  infoFactura: {
    fechaEmision: '17/05/2025',
    tipoIdentificacionComprador: '05',
    identificacionComprador: clienteMock.identificacion,
    razonSocialComprador: 'CLIENTE',
    totalSinImpuestos: '100.00',
    importeTotal: '115.00',
  },
  detalles: [
    {
      detalle: {
        codigoPrincipal: 'P001',
        descripcion: 'Laptop',
        cantidad: '1.00',
        precioUnitario: '100.00',
        precioTotalSinImpuesto: '100.00',
        impuestos: [
          {
            impuesto: { codigo: '2', codigoPorcentaje: '4', tarifa: '15.00', baseImponible: '100.00', valor: '15.00' },
          },
        ],
      },
    },
  ],
};

beforeAll(() => crearP12());
afterAll(() => {
  if (fs.existsSync(p12Path)) fs.unlinkSync(p12Path);
});

describe('InvoiceService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    savedInvoices.length = 0;
    savedDetails.length = 0;
    savedPDFs.length = 0;
    identificationTypeStatics.findOne.mockResolvedValue({ codigo: '05' });
    issuingCompanyStatics.findOne.mockResolvedValue(empresaBase());
    clientStatics.findOne.mockResolvedValue(clienteMock);
    productStatics.findOne.mockResolvedValue(productoMock);
    invoiceStatics.findOne.mockReturnValue({ sort: jest.fn().mockResolvedValue(null) });
  });

  describe('validarDatosFactura', () => {
    it('accepts complete data and rejects incomplete data', () => {
      expect(InvoiceService.validarDatosFactura(requestValido)).toBe(true);
      expect(InvoiceService.validarDatosFactura({ ...requestValido, detalles: undefined } as any)).toBe(false);
    });
  });

  describe('generarSecuencial', () => {
    it('starts at 000000001 and increments existing sequences', async () => {
      await expect(InvoiceService.generarSecuencial('1790012345001')).resolves.toBe('000000001');

      invoiceStatics.findOne.mockReturnValue({ sort: jest.fn().mockResolvedValue({ secuencial: '000000007' }) });
      await expect(InvoiceService.generarSecuencial('1790012345001')).resolves.toBe('000000008');
    });

    it('throws when the empresa does not exist', async () => {
      issuingCompanyStatics.findOne.mockResolvedValue(null);

      await expect(InvoiceService.generarSecuencial('999')).rejects.toThrow('not found');
    });
  });

  describe('buscarIssuingCompany', () => {
    it('returns the empresa without certificate data when none is stored', async () => {
      const empresa = await InvoiceService.buscarIssuingCompany('1790012345001');

      expect(empresa?.ruc).toBe('1790012345001');
      expect(empresa?.certificatePath).toBeUndefined();
    });

    it('materializes the base64 certificate into a temp P12 file', async () => {
      issuingCompanyStatics.findOne.mockResolvedValue({
        ...empresaBase(),
        certificate: p12Base64,
        certificate_password: P12_PASSWORD,
      });

      const empresa = await InvoiceService.buscarIssuingCompany('1790012345001');

      expect(empresa?.certificatePath).toBeDefined();
      expect(fs.existsSync(empresa!.certificatePath!)).toBe(true);
      expect(empresa?.certificatePassword).toBe(P12_PASSWORD);
    });

    it('falls back to the raw password when decryption fails', async () => {
      issuingCompanyStatics.findOne.mockResolvedValue({
        ...empresaBase(),
        certificate: p12Base64,
        certificate_password: 'test:fake-encrypted-format',
      });

      const empresa = await InvoiceService.buscarIssuingCompany('1790012345001');

      expect(empresa?.certificatePassword).toBe('test:fake-encrypted-format');
    });

    it('returns null when the empresa does not exist', async () => {
      issuingCompanyStatics.findOne.mockResolvedValue(null);

      await expect(InvoiceService.buscarIssuingCompany('999')).resolves.toBeNull();
    });
  });

  describe('buscarProducts', () => {
    it('throws when a product is missing', async () => {
      productStatics.findOne.mockResolvedValue(null);

      await expect(InvoiceService.buscarProducts(requestValido.detalles)).rejects.toThrow('Product not found: P001');
    });
  });

  describe('procesarFacturaCompleta', () => {
    it.each([
      [
        'identification type',
        () => identificationTypeStatics.findOne.mockResolvedValue(null),
        'Identification type not found',
      ],
      ['empresa', () => issuingCompanyStatics.findOne.mockResolvedValue(null), 'Empresa emisora no encontrada'],
      ['client', () => clientStatics.findOne.mockResolvedValue(null), 'Client not found'],
    ])('fails when the %s is missing', async (_n, arrange, mensaje) => {
      arrange();

      await expect(InvoiceService.procesarFacturaCompleta(requestValido)).rejects.toThrow(mensaje);
    });

    it('fails on invalid dates', async () => {
      const invalido = { ...requestValido, infoFactura: { ...requestValido.infoFactura, fechaEmision: 'mala' } };

      await expect(InvoiceService.procesarFacturaCompleta(invalido)).rejects.toThrow('Invalid date format');
    });
  });

  describe('crearFacturaCompleta', () => {
    it('creates the invoice with an 01 access key, XML, totals and details', async () => {
      const resultado = await InvoiceService.crearFacturaCompleta(requestValido);

      expect(resultado.factura.clave_acceso).toHaveLength(49);
      expect(resultado.factura.clave_acceso.substring(8, 10)).toBe('01');
      expect(resultado.xml).toContain('<factura id="comprobante" version="1.0.0">');
      expect(resultado.factura.total_iva).toBe(15);
      expect(resultado.factura.total_con_impuestos).toBe(115);
      // The async SRI submission may already have run (no certificate in this test)
      expect(['PENDIENTE', 'ERROR_FIRMA']).toContain(resultado.factura.sri_estado);
      expect(resultado.detalles).toHaveLength(1);
    });
  });

  describe('P12 helpers (real certificate)', () => {
    it('verifyP12Password accepts the right password and rejects a wrong one', async () => {
      await expect(InvoiceService.verifyP12Password(p12Path, P12_PASSWORD)).resolves.toEqual({ valid: true });

      const wrong = await InvoiceService.verifyP12Password(p12Path, 'incorrecta');
      expect(wrong.valid).toBe(false);
      expect(wrong.error).toBeDefined();
    });

    it('findWorkingP12Password finds the original password and fails when none works', async () => {
      await expect(InvoiceService.findWorkingP12Password(p12Path, P12_PASSWORD)).resolves.toEqual({
        password: P12_PASSWORD,
      });

      const ninguna = await InvoiceService.findWorkingP12Password(p12Path, 'incorrecta');
      expect(ninguna.password).toBeNull();
    });

    it('convertP12ToPem produces a combined PEM with key and certificate', async () => {
      const pemPath = await InvoiceService.convertP12ToPem(p12Path, P12_PASSWORD);

      const contenido = fs.readFileSync(pemPath, 'utf8');
      expect(contenido).toContain('PRIVATE KEY');
      expect(contenido).toContain('BEGIN CERTIFICATE');
      fs.unlinkSync(pemPath);
    });

    it('convertP12ToPem throws a password error for a wrong password', async () => {
      await expect(InvoiceService.convertP12ToPem(p12Path, 'incorrecta')).rejects.toThrow('contraseña');
    });

    it('diagnoseP12Certificate reports a healthy certificate', async () => {
      const diagnosis = await InvoiceService.diagnoseP12Certificate(p12Path, P12_PASSWORD);

      expect(diagnosis.fileExists).toBe(true);
      expect(diagnosis.isValidP12).toBe(true);
      expect(diagnosis.passwordWorks).toBe(true);
      expect(diagnosis.certificateInfo?.subject).toContain('JUAN PEREZ');
    });

    it('diagnoseP12Certificate reports missing files and wrong passwords', async () => {
      const missing = await InvoiceService.diagnoseP12Certificate('/tmp/no-existe.p12', 'x');
      expect(missing.fileExists).toBe(false);

      const badPass = await InvoiceService.diagnoseP12Certificate(p12Path, 'incorrecta');
      expect(badPass.passwordWorks).toBe(false);
      expect(badPass.error).toContain('contraseña');
    });
  });

  describe('procesarEnvioSRI', () => {
    const facturaDoc = () => ({
      _id: 'factura-1',
      xml: '<factura/>',
      clave_acceso: 'clave',
      secuencial: '000000001',
      fecha_emision: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    });

    it('marks ERROR_FIRMA when there is no certificate', async () => {
      const factura: any = facturaDoc();

      await InvoiceService.procesarEnvioSRI(factura, { certificatePath: undefined }, clienteMock, [], requestValido);

      expect(factura.sri_estado).toBe('ERROR_FIRMA');
    });

    it('signs with the real P12, sends, generates the PDF and schedules authorization on RECIBIDA', async () => {
      enviarComprobanteSRIMock.mockResolvedValue({ estado: 'RECIBIDA' });
      const programarSpy = jest.spyOn(InvoiceService, 'programarConsultaAutorizacion').mockImplementation(() => {});
      const factura: any = facturaDoc();
      const empresa = { ...empresaBase(), certificatePath: p12Path, certificatePassword: P12_PASSWORD };

      await InvoiceService.procesarEnvioSRI(factura, empresa, clienteMock, [productoMock], requestValido);

      expect(firmarXMLMock).toHaveBeenCalledWith('<factura/>', p12Path, P12_PASSWORD, '01');
      expect(factura.sri_estado).toBe('RECIBIDA');
      expect(generateInvoicePDFMock).toHaveBeenCalled();
      expect(savedPDFs[0].estado).toBe('GENERADO');
      expect(programarSpy).toHaveBeenCalledWith('factura-1');
    });

    it('records the DEVUELTA state without generating a PDF', async () => {
      enviarComprobanteSRIMock.mockResolvedValue({
        estado: 'DEVUELTA',
        mensajes: { mensaje: { identificador: '35' } },
      });
      const factura: any = facturaDoc();
      const empresa = { ...empresaBase(), certificatePath: p12Path, certificatePassword: P12_PASSWORD };

      await InvoiceService.procesarEnvioSRI(factura, empresa, clienteMock, [], requestValido);

      expect(factura.sri_estado).toBe('DEVUELTA');
      expect(generateInvoicePDFMock).not.toHaveBeenCalled();
    });
  });

  describe('consultarAutorizacionSRI', () => {
    it('updates the invoice when the SRI authorizes it', async () => {
      const factura: any = {
        clave_acceso: 'clave',
        secuencial: '000000001',
        save: jest.fn().mockResolvedValue(undefined),
      };
      invoiceStatics.findById.mockResolvedValue(factura);
      autorizarComprobanteSRIMock.mockResolvedValue({
        estado: 'AUTORIZADO',
        numeroAutorizacion: 'clave',
        fechaAutorizacion: '2025-05-17T12:00:00-05:00',
      });

      const resultado = await InvoiceService.consultarAutorizacionSRI('factura-1');

      expect(resultado?.estado).toBe('AUTORIZADO');
      expect(factura.estado).toBe('AUTORIZADA');
      expect(factura.autorizacion_numero).toBe('clave');
    });

    it('returns null when the invoice does not exist', async () => {
      invoiceStatics.findById.mockResolvedValue(null);

      await expect(InvoiceService.consultarAutorizacionSRI('nope')).resolves.toBeNull();
    });
  });

  describe('programarConsultaAutorizacion', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('retries while pending, up to the max attempts', async () => {
      const consultarSpy = jest
        .spyOn(InvoiceService, 'consultarAutorizacionSRI')
        .mockResolvedValue({ estado: 'EN PROCESO' } as any);

      InvoiceService.programarConsultaAutorizacion('factura-1', 1, 3, 500);
      await jest.advanceTimersByTimeAsync(2500);

      expect(consultarSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('generarPDFFactura', () => {
    it('stores an ERROR record when the PDF generation fails', async () => {
      generateInvoicePDFMock.mockRejectedValueOnce(new Error('render failed'));
      const factura: any = {
        _id: 'factura-1',
        clave_acceso: 'clave',
        secuencial: '000000001',
        fecha_emision: new Date(),
      };

      await InvoiceService.generarPDFFactura(factura, empresaBase() as any, clienteMock, [], requestValido);

      expect(savedPDFs[0].estado).toBe('ERROR');
    });
  });
});
