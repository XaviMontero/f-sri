import fs from 'fs';

const firmarXMLMock = jest.fn().mockResolvedValue('<guiaRemision>firmada</guiaRemision>');
jest.mock('../../src/utils/firma.utils', () => ({
  firmarXML: (...args: any[]) => firmarXMLMock(...args),
}));

const enviarComprobanteSRIMock = jest.fn();
const autorizarComprobanteSRIMock = jest.fn();
jest.mock('../../src/utils/sri.utils', () => ({
  enviarComprobanteSRI: (...args: any[]) => enviarComprobanteSRIMock(...args),
  autorizarComprobanteSRI: (...args: any[]) => autorizarComprobanteSRIMock(...args),
}));

const generateDeliveryNotePDFMock = jest.fn().mockResolvedValue(Buffer.from('pdf'));
jest.mock('../../src/utils/pdf.utils', () => ({
  generateDeliveryNotePDF: (...args: any[]) => generateDeliveryNotePDFMock(...args),
}));

const storageUploadMock = jest
  .fn()
  .mockResolvedValue({ url: 'https://cdn/gr.pdf', publicId: 'gr-1', provider: 'local', size: 3 });
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

const deliveryNoteStatics = { findOne: jest.fn(), findById: jest.fn() };
jest.mock('../../src/models/DeliveryNote', () => {
  class MockDeliveryNote {
    [key: string]: any;
    constructor(data: any) {
      Object.assign(this, data);
      this._id = 'gr-1';
    }
    save = jest.fn().mockResolvedValue(this);
    static findOne = (...args: any[]) => deliveryNoteStatics.findOne(...args);
    static findById = (...args: any[]) => deliveryNoteStatics.findById(...args);
  }
  return { __esModule: true, default: MockDeliveryNote };
});

const savedPDFs: any[] = [];
jest.mock('../../src/models/DeliveryNotePDF', () => {
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

import { DeliveryNoteService } from '../../src/services/delivery-note.service';
import { DeliveryNoteRequest } from '../../src/interfaces/delivery-note.interface';

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

const requestValido: DeliveryNoteRequest = {
  infoTributaria: { ruc: empresaMock.ruc, claveAcceso: '', secuencial: '' },
  infoGuiaRemision: {
    fechaEmision: '17/05/2025',
    dirPartida: 'Av. Eloy Alfaro 34',
    razonSocialTransportista: 'Transportes S.A.',
    tipoIdentificacionTransportista: '04',
    rucTransportista: '1796875790001',
    fechaIniTransporte: '17/05/2025',
    fechaFinTransporte: '18/05/2025',
    placa: 'MCL0827',
  },
  destinatarios: [
    {
      destinatario: {
        identificacionDestinatario: '1716849140001',
        razonSocialDestinatario: 'Juan Pérez',
        dirDestinatario: 'Av. Simón Bolívar S/N',
        motivoTraslado: 'Venta',
        detalles: [{ detalle: { descripcion: 'Laptop', cantidad: '10.00' } }],
      },
    },
  ],
};

describe('DeliveryNoteService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    savedPDFs.length = 0;
    invoiceServiceMocks.buscarIssuingCompany.mockResolvedValue(empresaMock);
    issuingCompanyStatics.findOne.mockResolvedValue(empresaMock);
    deliveryNoteStatics.findOne.mockReturnValue({ sort: jest.fn().mockResolvedValue(null) });
  });

  describe('validarDatosGuiaRemision', () => {
    it('accepts a complete request', () => {
      expect(DeliveryNoteService.validarDatosGuiaRemision(requestValido)).toBe(true);
    });

    it('rejects requests without destinatarios, detalles or transport data', () => {
      expect(DeliveryNoteService.validarDatosGuiaRemision({ ...requestValido, destinatarios: [] })).toBe(false);
      expect(
        DeliveryNoteService.validarDatosGuiaRemision({
          ...requestValido,
          destinatarios: [{ destinatario: { ...requestValido.destinatarios[0].destinatario, detalles: [] } }],
        }),
      ).toBe(false);
      expect(
        DeliveryNoteService.validarDatosGuiaRemision({
          ...requestValido,
          infoGuiaRemision: { ...requestValido.infoGuiaRemision, placa: '' },
        }),
      ).toBe(false);
      expect(
        DeliveryNoteService.validarDatosGuiaRemision({
          ...requestValido,
          infoGuiaRemision: { ...requestValido.infoGuiaRemision, rucTransportista: '' },
        }),
      ).toBe(false);
      expect(
        DeliveryNoteService.validarDatosGuiaRemision({
          ...requestValido,
          infoGuiaRemision: { ...requestValido.infoGuiaRemision, dirPartida: '' },
        }),
      ).toBe(false);
      expect(
        DeliveryNoteService.validarDatosGuiaRemision({
          ...requestValido,
          infoGuiaRemision: { ...requestValido.infoGuiaRemision, razonSocialTransportista: '' },
        }),
      ).toBe(false);
    });

    it('rejects an incomplete request through procesarGuiaRemisionCompleta', async () => {
      await expect(
        DeliveryNoteService.procesarGuiaRemisionCompleta({ ...requestValido, destinatarios: [] }),
      ).rejects.toThrow('Datos de guía de remisión inválidos o incompletos');
    });
  });

  describe('generarSecuencial', () => {
    it('increments the latest secuencial', async () => {
      deliveryNoteStatics.findOne.mockReturnValue({ sort: jest.fn().mockResolvedValue({ secuencial: '000000004' }) });

      await expect(DeliveryNoteService.generarSecuencial(empresaMock.ruc)).resolves.toBe('000000005');
    });

    it('throws when the empresa does not exist', async () => {
      issuingCompanyStatics.findOne.mockResolvedValue(null);

      await expect(DeliveryNoteService.generarSecuencial('999')).rejects.toThrow('not found');
    });
  });

  describe('procesarGuiaRemisionCompleta', () => {
    it('fails when the empresa is missing', async () => {
      invoiceServiceMocks.buscarIssuingCompany.mockResolvedValue(null);

      await expect(DeliveryNoteService.procesarGuiaRemisionCompleta(requestValido)).rejects.toThrow(
        'Empresa emisora no encontrada',
      );
    });

    it('fails on invalid transport dates', async () => {
      const invalido = {
        ...requestValido,
        infoGuiaRemision: { ...requestValido.infoGuiaRemision, fechaFinTransporte: 'mala' },
      };

      await expect(DeliveryNoteService.procesarGuiaRemisionCompleta(invalido)).rejects.toThrow('Invalid date format');
    });
  });

  describe('crearGuiaRemisionCompleta', () => {
    it('creates the delivery note with an 06 access key and transport data', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      const resultado = await DeliveryNoteService.crearGuiaRemisionCompleta(requestValido);

      expect(resultado.guia_remision.clave_acceso).toHaveLength(49);
      expect(resultado.guia_remision.clave_acceso.substring(8, 10)).toBe('06');
      expect(resultado.xml).toContain('<guiaRemision id="comprobante" version="1.1.0">');
      expect(resultado.guia_remision.placa).toBe('MCL0827');
      expect(resultado.guia_remision.destinatarios).toHaveLength(1);
    });

    it('does not fail the creation when the async SRI submission rejects', async () => {
      const envioSpy = jest.spyOn(DeliveryNoteService, 'procesarEnvioSRI').mockRejectedValue(new Error('sri caído'));

      const resultado = await DeliveryNoteService.crearGuiaRemisionCompleta(requestValido);

      expect(resultado.guia_remision.clave_acceso).toHaveLength(49);
      expect(envioSpy).toHaveBeenCalled();
      // give the rejected fire-and-forget promise a tick to settle
      await new Promise((resolve) => setImmediate(resolve));
    });
  });

  describe('procesarEnvioSRI', () => {
    const doc = () => ({
      _id: 'gr-1',
      xml: '<guiaRemision/>',
      clave_acceso: 'clave',
      secuencial: '000000001',
      fecha_emision: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    });

    it('marks ERROR_FIRMA when there is no certificate', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      const guia: any = doc();

      await DeliveryNoteService.procesarEnvioSRI(guia, { ...empresaMock, certificatePath: undefined }, requestValido);

      expect(guia.sri_estado).toBe('ERROR_FIRMA');
    });

    it('signs with tipoDocumento 06 and completes the RECIBIDA flow', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      invoiceServiceMocks.diagnoseP12Certificate.mockResolvedValue({ isValidP12: true });
      invoiceServiceMocks.verifyP12Password.mockResolvedValue({ valid: true });
      enviarComprobanteSRIMock.mockResolvedValue({ estado: 'RECIBIDA' });
      const programarSpy = jest
        .spyOn(DeliveryNoteService, 'programarConsultaAutorizacion')
        .mockImplementation(() => {});
      const guia: any = doc();

      await DeliveryNoteService.procesarEnvioSRI(guia, empresaMock, requestValido);

      expect(firmarXMLMock).toHaveBeenCalledWith(
        '<guiaRemision/>',
        empresaMock.certificatePath,
        'test-cert-password',
        '06',
      );
      expect(guia.sri_estado).toBe('RECIBIDA');
      expect(generateDeliveryNotePDFMock).toHaveBeenCalled();
      expect(programarSpy).toHaveBeenCalledWith('gr-1');
    });

    it('records the DEVUELTA state and its mensajes without generating a PDF', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      invoiceServiceMocks.diagnoseP12Certificate.mockResolvedValue({ isValidP12: true });
      invoiceServiceMocks.verifyP12Password.mockResolvedValue({ valid: true });
      enviarComprobanteSRIMock.mockResolvedValue({
        estado: 'DEVUELTA',
        mensajes: { mensaje: { identificador: '35' } },
      });
      const guia: any = doc();

      await DeliveryNoteService.procesarEnvioSRI(guia, empresaMock, requestValido);

      expect(guia.sri_estado).toBe('DEVUELTA');
      expect(guia.sri_mensajes).toEqual({ mensaje: { identificador: '35' } });
      expect(generateDeliveryNotePDFMock).not.toHaveBeenCalled();
    });

    it('rejects an invalid P12 as ERROR_FIRMA', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      invoiceServiceMocks.diagnoseP12Certificate.mockResolvedValue({ isValidP12: false, error: 'corrupt' });
      const guia: any = doc();

      await DeliveryNoteService.procesarEnvioSRI(guia, empresaMock, requestValido);

      expect(guia.sri_estado).toBe('ERROR_FIRMA');
      expect(guia.sri_mensajes.error).toContain('P12');
      expect(firmarXMLMock).not.toHaveBeenCalled();
    });

    it('falls back to an alternative password when verification fails', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      invoiceServiceMocks.diagnoseP12Certificate.mockResolvedValue({ isValidP12: true });
      invoiceServiceMocks.verifyP12Password.mockResolvedValue({ valid: false, error: 'bad mac' });
      invoiceServiceMocks.findWorkingP12Password.mockResolvedValue({ password: 'test-fallback-password' });
      enviarComprobanteSRIMock.mockResolvedValue({ estado: 'RECIBIDA' });
      jest.spyOn(DeliveryNoteService, 'programarConsultaAutorizacion').mockImplementation(() => {});
      const guia: any = doc();

      await DeliveryNoteService.procesarEnvioSRI(guia, empresaMock, requestValido);

      expect(firmarXMLMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'test-fallback-password', '06');
    });

    it('marks ERROR_FIRMA when no password works', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      invoiceServiceMocks.diagnoseP12Certificate.mockResolvedValue({ isValidP12: true });
      invoiceServiceMocks.verifyP12Password.mockResolvedValue({ valid: false, error: 'bad mac' });
      invoiceServiceMocks.findWorkingP12Password.mockResolvedValue({ password: null });
      const guia: any = doc();

      await DeliveryNoteService.procesarEnvioSRI(guia, empresaMock, requestValido);

      expect(guia.sri_estado).toBe('ERROR_FIRMA');
      expect(guia.sri_mensajes.error).toContain('contraseña');
    });

    it('marks ERROR_FIRMA when the signing itself throws', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      invoiceServiceMocks.diagnoseP12Certificate.mockResolvedValue({ isValidP12: true });
      invoiceServiceMocks.verifyP12Password.mockResolvedValue({ valid: true });
      firmarXMLMock.mockRejectedValueOnce(new Error('Error al firmar XML: llave dañada'));
      const guia: any = doc();

      await DeliveryNoteService.procesarEnvioSRI(guia, empresaMock, requestValido);

      expect(guia.sri_estado).toBe('ERROR_FIRMA');
      expect(guia.sri_mensajes.error).toContain('firmar');
    });

    it('marks ERROR_PROCESO when persisting the document fails unexpectedly', async () => {
      const guia: any = doc();
      // fs.existsSync throwing escapes the inner try and reaches the outer catch
      jest.spyOn(fs, 'existsSync').mockImplementation(() => {
        throw new Error('EIO: disco dañado');
      });

      await DeliveryNoteService.procesarEnvioSRI(guia, empresaMock, requestValido);

      expect(guia.sri_estado).toBe('ERROR_PROCESO');
      expect(guia.sri_mensajes.error).toContain('EIO');
    });
  });

  describe('consultarAutorizacionSRI', () => {
    it('updates the delivery note when the SRI authorizes it', async () => {
      const guia: any = {
        clave_acceso: 'clave',
        secuencial: '000000001',
        save: jest.fn().mockResolvedValue(undefined),
      };
      deliveryNoteStatics.findById.mockResolvedValue(guia);
      autorizarComprobanteSRIMock.mockResolvedValue({ estado: 'AUTORIZADO' });

      const resultado = await DeliveryNoteService.consultarAutorizacionSRI('gr-1');

      expect(resultado?.estado).toBe('AUTORIZADO');
      expect(guia.estado).toBe('AUTORIZADA');
      expect(guia.autorizacion_numero).toBe('clave');
    });

    it('returns null when the delivery note does not exist', async () => {
      deliveryNoteStatics.findById.mockResolvedValue(null);

      await expect(DeliveryNoteService.consultarAutorizacionSRI('nope')).resolves.toBeNull();
    });
  });

  describe('programarConsultaAutorizacion', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('stops retrying once the receipt is resolved', async () => {
      const consultarSpy = jest
        .spyOn(DeliveryNoteService, 'consultarAutorizacionSRI')
        .mockResolvedValue({ estado: 'NO AUTORIZADO' } as any);

      DeliveryNoteService.programarConsultaAutorizacion('gr-1', 1, 3, 500);
      await jest.advanceTimersByTimeAsync(2000);

      expect(consultarSpy).toHaveBeenCalledTimes(1);
    });

    it('retries while pending, up to the max attempts', async () => {
      const consultarSpy = jest
        .spyOn(DeliveryNoteService, 'consultarAutorizacionSRI')
        .mockResolvedValue({ estado: 'EN PROCESO' } as any);

      DeliveryNoteService.programarConsultaAutorizacion('gr-1', 1, 3, 500);
      await jest.advanceTimersByTimeAsync(2500);

      expect(consultarSpy).toHaveBeenCalledTimes(3);
    });
  });

  describe('generarPDFGuiaRemision', () => {
    it('generates, uploads and records the PDF', async () => {
      const guia: any = {
        _id: 'gr-1',
        clave_acceso: 'clave',
        secuencial: '000000001',
        fecha_emision: new Date(),
        sri_fecha_respuesta: new Date(),
      };

      await DeliveryNoteService.generarPDFGuiaRemision(guia, empresaMock, requestValido);

      expect(generateDeliveryNotePDFMock).toHaveBeenCalledWith(
        expect.objectContaining({ claveAcceso: 'clave', secuencial: '000000001' }),
      );
      expect(storageUploadMock).toHaveBeenCalledWith(expect.any(Buffer), 'guia_remision_000000001_clave');
      expect(savedPDFs[0].estado).toBe('GENERADO');
      expect(savedPDFs[0].pdf_url).toBe('https://cdn/gr.pdf');
    });

    it('stores an ERROR record when the PDF generation fails', async () => {
      generateDeliveryNotePDFMock.mockRejectedValueOnce(new Error('render failed'));
      const guia: any = { _id: 'gr-1', clave_acceso: 'clave', secuencial: '000000001', fecha_emision: new Date() };

      await DeliveryNoteService.generarPDFGuiaRemision(guia, empresaMock, requestValido);

      expect(savedPDFs[0].estado).toBe('ERROR');
    });
  });
});
