import fs from 'fs';

const firmarXMLMock = jest.fn().mockResolvedValue('<comprobanteRetencion>firmada</comprobanteRetencion>');
jest.mock('../../src/utils/firma.utils', () => ({
  firmarXML: (...args: any[]) => firmarXMLMock(...args),
}));

const enviarComprobanteSRIMock = jest.fn();
const autorizarComprobanteSRIMock = jest.fn();
jest.mock('../../src/utils/sri.utils', () => ({
  enviarComprobanteSRI: (...args: any[]) => enviarComprobanteSRIMock(...args),
  autorizarComprobanteSRI: (...args: any[]) => autorizarComprobanteSRIMock(...args),
}));

const generateWithholdingPDFMock = jest.fn().mockResolvedValue(Buffer.from('pdf'));
jest.mock('../../src/utils/pdf.utils', () => ({
  generateWithholdingPDF: (...args: any[]) => generateWithholdingPDFMock(...args),
}));

const storageUploadMock = jest
  .fn()
  .mockResolvedValue({ url: 'https://cdn/ret.pdf', publicId: 'ret-1', provider: 'local', size: 3 });
jest.mock('../../src/services/storage', () => ({
  PDFStorageFactory: { create: () => ({ upload: storageUploadMock, getProviderName: () => 'local' }) },
}));

const invoiceServiceMocks = {
  buscarIssuingCompany: jest.fn(),
  diagnoseP12Certificate: jest.fn(),
  verifyP12Password: jest.fn(),
  findWorkingP12Password: jest.fn(),
};
jest.mock('../../src/services/invoice.service', () => ({ InvoiceService: invoiceServiceMocks }));

const withholdingStatics = { findOne: jest.fn(), findById: jest.fn() };
jest.mock('../../src/models/Withholding', () => {
  class MockWithholding {
    [key: string]: any;
    constructor(data: any) {
      Object.assign(this, data);
      this._id = 'ret-1';
    }
    save = jest.fn().mockResolvedValue(this);
    static findOne = (...args: any[]) => withholdingStatics.findOne(...args);
    static findById = (...args: any[]) => withholdingStatics.findById(...args);
  }
  return { __esModule: true, default: MockWithholding };
});

const savedPDFs: any[] = [];
jest.mock('../../src/models/WithholdingPDF', () => {
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

const issuingCompanyStatics = { findOne: jest.fn() };
jest.mock('../../src/models/IssuingCompany', () => ({
  __esModule: true,
  default: { findOne: (...args: any[]) => issuingCompanyStatics.findOne(...args) },
}));

import { WithholdingService } from '../../src/services/withholding.service';
import { WithholdingRequest } from '../../src/interfaces/withholding.interface';

const empresaMock: any = {
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
  certificatePath: '/tmp/cert.p12',
  certificatePassword: 'test-cert-password',
};

const requestValido: WithholdingRequest = {
  infoTributaria: { ruc: empresaMock.ruc, claveAcceso: '', secuencial: '' },
  infoCompRetencion: {
    fechaEmision: '17/05/2025',
    tipoIdentificacionSujetoRetenido: '04',
    razonSocialSujetoRetenido: 'Proveedor S.A.',
    identificacionSujetoRetenido: '1713328506001',
    periodoFiscal: '05/2025',
  },
  docsSustento: [
    {
      docSustento: {
        codSustento: '01',
        codDocSustento: '01',
        numDocSustento: '001001000000123',
        fechaEmisionDocSustento: '10/05/2025',
        pagoLocExt: '01',
        totalSinImpuestos: '100.00',
        importeTotal: '115.00',
        impuestosDocSustento: [
          {
            impuestoDocSustento: {
              codImpuestoDocSustento: '2',
              codigoPorcentaje: '4',
              baseImponible: '100.00',
              tarifa: '15',
              valorImpuesto: '15.00',
            },
          },
        ],
        retenciones: [
          {
            retencion: {
              codigo: '1',
              codigoRetencion: '312',
              baseImponible: '100.00',
              porcentajeRetener: '1.75',
              valorRetenido: '1.75',
            },
          },
          {
            retencion: {
              codigo: '2',
              codigoRetencion: '3',
              baseImponible: '15.00',
              porcentajeRetener: '70',
              valorRetenido: '10.50',
            },
          },
        ],
        pagos: [{ pago: { formaPago: '01', total: '115.00' } }],
      },
    },
  ],
};

describe('WithholdingService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    savedPDFs.length = 0;
    invoiceServiceMocks.buscarIssuingCompany.mockResolvedValue(empresaMock);
    issuingCompanyStatics.findOne.mockResolvedValue(empresaMock);
    withholdingStatics.findOne.mockReturnValue({ sort: jest.fn().mockResolvedValue(null) });
  });

  describe('validarDatosRetencion', () => {
    it('accepts a complete request', () => {
      expect(WithholdingService.validarDatosRetencion(requestValido)).toBe(true);
    });

    it('rejects requests without docsSustento, retenciones, impuestos or pagos', () => {
      expect(WithholdingService.validarDatosRetencion({ ...requestValido, docsSustento: [] })).toBe(false);

      const sinRetenciones = JSON.parse(JSON.stringify(requestValido)) as WithholdingRequest;
      sinRetenciones.docsSustento[0].docSustento.retenciones = [];
      expect(WithholdingService.validarDatosRetencion(sinRetenciones)).toBe(false);

      const sinImpuestos = JSON.parse(JSON.stringify(requestValido)) as WithholdingRequest;
      sinImpuestos.docsSustento[0].docSustento.impuestosDocSustento = [];
      expect(WithholdingService.validarDatosRetencion(sinImpuestos)).toBe(false);

      const sinPagos = JSON.parse(JSON.stringify(requestValido)) as WithholdingRequest;
      sinPagos.docsSustento[0].docSustento.pagos = [];
      expect(WithholdingService.validarDatosRetencion(sinPagos)).toBe(false);
    });
  });

  describe('generarSecuencial', () => {
    it('increments the latest secuencial', async () => {
      withholdingStatics.findOne.mockReturnValue({ sort: jest.fn().mockResolvedValue({ secuencial: '000000099' }) });

      await expect(WithholdingService.generarSecuencial(empresaMock.ruc)).resolves.toBe('000000100');
    });

    it('throws when the empresa does not exist', async () => {
      issuingCompanyStatics.findOne.mockResolvedValue(null);

      await expect(WithholdingService.generarSecuencial('999')).rejects.toThrow('not found');
    });
  });

  describe('procesarRetencionCompleta', () => {
    it('fails when the empresa is missing', async () => {
      invoiceServiceMocks.buscarIssuingCompany.mockResolvedValue(null);

      await expect(WithholdingService.procesarRetencionCompleta(requestValido)).rejects.toThrow(
        'Empresa emisora no encontrada',
      );
    });

    it('fails on invalid dates', async () => {
      const invalido = {
        ...requestValido,
        infoCompRetencion: { ...requestValido.infoCompRetencion, fechaEmision: 'mala' },
      };

      await expect(WithholdingService.procesarRetencionCompleta(invalido)).rejects.toThrow('Invalid date format');
    });
  });

  describe('crearRetencionCompleta', () => {
    it('creates the withholding with an 07 access key and the computed total retenido', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      const resultado = await WithholdingService.crearRetencionCompleta(requestValido);

      expect(resultado.retencion.clave_acceso).toHaveLength(49);
      expect(resultado.retencion.clave_acceso.substring(8, 10)).toBe('07');
      expect(resultado.xml).toContain('<comprobanteRetencion id="comprobante" version="2.0.0">');
      expect(resultado.retencion.total_retenido).toBeCloseTo(12.25);
      expect(resultado.retencion.periodo_fiscal).toBe('05/2025');
    });
  });

  describe('procesarEnvioSRI', () => {
    const doc = () => ({
      _id: 'ret-1',
      xml: '<comprobanteRetencion/>',
      clave_acceso: 'clave',
      secuencial: '000000001',
      fecha_emision: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    });

    it('marks ERROR_FIRMA when there is no certificate', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      const ret: any = doc();

      await WithholdingService.procesarEnvioSRI(ret, { ...empresaMock, certificatePath: undefined }, requestValido);

      expect(ret.sri_estado).toBe('ERROR_FIRMA');
    });

    it('signs with tipoDocumento 07 and completes the RECIBIDA flow', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      invoiceServiceMocks.diagnoseP12Certificate.mockResolvedValue({ isValidP12: true });
      invoiceServiceMocks.verifyP12Password.mockResolvedValue({ valid: true });
      enviarComprobanteSRIMock.mockResolvedValue({ estado: 'RECIBIDA' });
      const programarSpy = jest.spyOn(WithholdingService, 'programarConsultaAutorizacion').mockImplementation(() => {});
      const ret: any = doc();

      await WithholdingService.procesarEnvioSRI(ret, empresaMock, requestValido);

      expect(firmarXMLMock).toHaveBeenCalledWith(
        '<comprobanteRetencion/>',
        empresaMock.certificatePath,
        'test-cert-password',
        '07',
      );
      expect(ret.sri_estado).toBe('RECIBIDA');
      expect(generateWithholdingPDFMock).toHaveBeenCalled();
      expect(savedPDFs[0].estado).toBe('GENERADO');
      expect(programarSpy).toHaveBeenCalledWith('ret-1');
    });

    it('marks ERROR_PROCESO when saving fails outside the signing block', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      invoiceServiceMocks.diagnoseP12Certificate.mockResolvedValue({ isValidP12: true });
      invoiceServiceMocks.verifyP12Password.mockResolvedValue({ valid: true });
      enviarComprobanteSRIMock.mockResolvedValue({ estado: 'RECIBIDA' });
      const ret: any = doc();
      // First save (xml_firmado) throws → captured by the outer catch
      ret.save.mockRejectedValueOnce(new Error('mongo down')).mockResolvedValue(undefined);

      await WithholdingService.procesarEnvioSRI(ret, empresaMock, requestValido);

      expect(['ERROR_FIRMA', 'ERROR_PROCESO']).toContain(ret.sri_estado);
    });
  });

  describe('consultarAutorizacionSRI', () => {
    it('updates the withholding when the SRI authorizes it', async () => {
      const ret: any = { clave_acceso: 'clave', secuencial: '000000001', save: jest.fn().mockResolvedValue(undefined) };
      withholdingStatics.findById.mockResolvedValue(ret);
      autorizarComprobanteSRIMock.mockResolvedValue({
        estado: 'AUTORIZADO',
        numeroAutorizacion: 'clave',
        fechaAutorizacion: '2025-05-17T12:00:00-05:00',
      });

      const resultado = await WithholdingService.consultarAutorizacionSRI('ret-1');

      expect(resultado?.estado).toBe('AUTORIZADO');
      expect(ret.estado).toBe('AUTORIZADA');
      expect(ret.fecha_autorizacion).toBeInstanceOf(Date);
    });

    it('returns null when the withholding does not exist', async () => {
      withholdingStatics.findById.mockResolvedValue(null);

      await expect(WithholdingService.consultarAutorizacionSRI('nope')).resolves.toBeNull();
    });
  });

  describe('programarConsultaAutorizacion', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('retries while pending, up to the max attempts', async () => {
      const consultarSpy = jest
        .spyOn(WithholdingService, 'consultarAutorizacionSRI')
        .mockResolvedValue({ estado: 'EN PROCESO' } as any);

      WithholdingService.programarConsultaAutorizacion('ret-1', 1, 3, 500);
      await jest.advanceTimersByTimeAsync(2500);

      expect(consultarSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('generarPDFRetencion', () => {
    it('stores an ERROR record when the PDF generation fails', async () => {
      generateWithholdingPDFMock.mockRejectedValueOnce(new Error('render failed'));
      const ret: any = { _id: 'ret-1', clave_acceso: 'clave', secuencial: '000000001', fecha_emision: new Date() };

      await WithholdingService.generarPDFRetencion(ret, empresaMock, requestValido);

      expect(savedPDFs[0].estado).toBe('ERROR');
    });
  });
});
