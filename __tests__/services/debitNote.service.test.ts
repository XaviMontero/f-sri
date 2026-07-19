import fs from 'fs';

const firmarXMLMock = jest.fn().mockResolvedValue('<notaDebito>firmada</notaDebito>');
jest.mock('../../src/utils/firma.utils', () => ({
  firmarXML: (...args: any[]) => firmarXMLMock(...args),
}));

const enviarComprobanteSRIMock = jest.fn();
const autorizarComprobanteSRIMock = jest.fn();
jest.mock('../../src/utils/sri.utils', () => ({
  enviarComprobanteSRI: (...args: any[]) => enviarComprobanteSRIMock(...args),
  autorizarComprobanteSRI: (...args: any[]) => autorizarComprobanteSRIMock(...args),
}));

const generateDebitNotePDFMock = jest.fn().mockResolvedValue(Buffer.from('pdf'));
jest.mock('../../src/utils/pdf.utils', () => ({
  generateDebitNotePDF: (...args: any[]) => generateDebitNotePDFMock(...args),
}));

const storageUploadMock = jest
  .fn()
  .mockResolvedValue({ url: 'https://cdn/nd.pdf', publicId: 'nd-1', provider: 'local', size: 3 });
jest.mock('../../src/services/storage', () => ({
  PDFStorageFactory: { create: () => ({ upload: storageUploadMock, getProviderName: () => 'local' }) },
}));

const invoiceServiceMocks = {
  buscarTipoIdentificacion: jest.fn(),
  buscarIssuingCompany: jest.fn(),
  buscarClient: jest.fn(),
  diagnoseP12Certificate: jest.fn(),
  verifyP12Password: jest.fn(),
  findWorkingP12Password: jest.fn(),
};
jest.mock('../../src/services/invoice.service', () => ({ InvoiceService: invoiceServiceMocks }));

const debitNoteStatics = { findOne: jest.fn(), findById: jest.fn() };
const savedDebitNotes: any[] = [];
jest.mock('../../src/models/DebitNote', () => {
  class MockDebitNote {
    [key: string]: any;
    constructor(data: any) {
      Object.assign(this, data);
      this._id = 'nd-1';
      savedDebitNotes.push(this);
    }
    save = jest.fn().mockResolvedValue(this);
    static findOne = (...args: any[]) => debitNoteStatics.findOne(...args);
    static findById = (...args: any[]) => debitNoteStatics.findById(...args);
  }
  return { __esModule: true, default: MockDebitNote };
});

const savedPDFs: any[] = [];
jest.mock('../../src/models/DebitNotePDF', () => {
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

jest.mock('../../src/models/Invoice', () => ({
  __esModule: true,
  default: { findOne: jest.fn().mockResolvedValue(null) },
}));

const issuingCompanyStatics = { findOne: jest.fn() };
jest.mock('../../src/models/IssuingCompany', () => ({
  __esModule: true,
  default: { findOne: (...args: any[]) => issuingCompanyStatics.findOne(...args) },
}));

import { DebitNoteService } from '../../src/services/debit-note.service';
import { DebitNoteRequest } from '../../src/interfaces/debit-note.interface';

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

const clienteMock: any = { _id: 'cliente-1', razon_social: 'CLIENTE', identificacion: '0106079783' };

const requestValido: DebitNoteRequest = {
  infoTributaria: { ruc: empresaMock.ruc, claveAcceso: '', secuencial: '' },
  infoNotaDebito: {
    fechaEmision: '17/05/2025',
    tipoIdentificacionComprador: '05',
    identificacionComprador: clienteMock.identificacion,
    codDocModificado: '01',
    numDocModificado: '001-001-000000123',
    fechaEmisionDocSustento: '10/05/2025',
    totalSinImpuestos: '50.00',
    impuestos: [
      { impuesto: { codigo: '2', codigoPorcentaje: '4', tarifa: '15.00', baseImponible: '50.00', valor: '7.50' } },
    ],
    valorTotal: '57.50',
    pagos: [{ pago: { formaPago: '20', total: '57.50' } }],
  },
  motivos: [{ motivo: { razon: 'Interés por mora', valor: '50.00' } }],
};

describe('DebitNoteService', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
    savedDebitNotes.length = 0;
    savedPDFs.length = 0;
    invoiceServiceMocks.buscarTipoIdentificacion.mockResolvedValue({ codigo: '05' });
    invoiceServiceMocks.buscarIssuingCompany.mockResolvedValue(empresaMock);
    invoiceServiceMocks.buscarClient.mockResolvedValue(clienteMock);
    issuingCompanyStatics.findOne.mockResolvedValue(empresaMock);
    debitNoteStatics.findOne.mockReturnValue({ sort: jest.fn().mockResolvedValue(null) });
  });

  describe('validarDatosNotaDebito', () => {
    it('accepts a complete request', () => {
      expect(DebitNoteService.validarDatosNotaDebito(requestValido)).toBe(true);
    });

    it('rejects requests without motivos, impuestos or pagos', () => {
      expect(DebitNoteService.validarDatosNotaDebito({ ...requestValido, motivos: [] })).toBe(false);
      expect(
        DebitNoteService.validarDatosNotaDebito({
          ...requestValido,
          infoNotaDebito: { ...requestValido.infoNotaDebito, impuestos: [] },
        }),
      ).toBe(false);
      expect(
        DebitNoteService.validarDatosNotaDebito({
          ...requestValido,
          infoNotaDebito: { ...requestValido.infoNotaDebito, pagos: [] },
        }),
      ).toBe(false);
    });
  });

  describe('generarSecuencial', () => {
    it('increments the latest secuencial', async () => {
      debitNoteStatics.findOne.mockReturnValue({ sort: jest.fn().mockResolvedValue({ secuencial: '000000009' }) });

      await expect(DebitNoteService.generarSecuencial(empresaMock.ruc)).resolves.toBe('000000010');
    });

    it('throws when the empresa does not exist', async () => {
      issuingCompanyStatics.findOne.mockResolvedValue(null);

      await expect(DebitNoteService.generarSecuencial('999')).rejects.toThrow('not found');
    });
  });

  describe('procesarNotaDebitoCompleta', () => {
    it('fails when the client is missing', async () => {
      invoiceServiceMocks.buscarClient.mockResolvedValue(null);

      await expect(DebitNoteService.procesarNotaDebitoCompleta(requestValido)).rejects.toThrow('Client not found');
    });

    it('fails on invalid dates', async () => {
      const invalido = {
        ...requestValido,
        infoNotaDebito: { ...requestValido.infoNotaDebito, fechaEmisionDocSustento: 'mala' },
      };

      await expect(DebitNoteService.procesarNotaDebitoCompleta(invalido)).rejects.toThrow('Invalid date format');
    });
  });

  describe('crearNotaDebitoCompleta', () => {
    it('creates the debit note with an 05 access key, totals and motivos', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);

      const resultado = await DebitNoteService.crearNotaDebitoCompleta(requestValido);

      expect(resultado.nota_debito.clave_acceso).toHaveLength(49);
      expect(resultado.nota_debito.clave_acceso.substring(8, 10)).toBe('05');
      expect(resultado.xml).toContain('<notaDebito id="comprobante" version="1.0.0">');
      expect(resultado.nota_debito.total_impuestos).toBe(7.5);
      expect(resultado.nota_debito.valor_total).toBe(57.5);
      expect(resultado.nota_debito.motivos).toEqual([{ razon: 'Interés por mora', valor: 50 }]);
    });
  });

  describe('procesarEnvioSRI', () => {
    const doc = () => ({
      _id: 'nd-1',
      xml: '<notaDebito/>',
      clave_acceso: 'clave',
      secuencial: '000000001',
      fecha_emision: new Date(),
      save: jest.fn().mockResolvedValue(undefined),
    });

    it('marks ERROR_FIRMA when there is no certificate', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(false);
      const nota: any = doc();

      await DebitNoteService.procesarEnvioSRI(
        nota,
        { ...empresaMock, certificatePath: undefined },
        clienteMock,
        requestValido,
      );

      expect(nota.sri_estado).toBe('ERROR_FIRMA');
    });

    it('signs with tipoDocumento 05 and completes the RECIBIDA flow', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      invoiceServiceMocks.diagnoseP12Certificate.mockResolvedValue({ isValidP12: true });
      invoiceServiceMocks.verifyP12Password.mockResolvedValue({ valid: true });
      enviarComprobanteSRIMock.mockResolvedValue({ estado: 'RECIBIDA' });
      const programarSpy = jest.spyOn(DebitNoteService, 'programarConsultaAutorizacion').mockImplementation(() => {});
      const nota: any = doc();

      await DebitNoteService.procesarEnvioSRI(nota, empresaMock, clienteMock, requestValido);

      expect(firmarXMLMock).toHaveBeenCalledWith(
        '<notaDebito/>',
        empresaMock.certificatePath,
        'test-cert-password',
        '05',
      );
      expect(nota.sri_estado).toBe('RECIBIDA');
      expect(generateDebitNotePDFMock).toHaveBeenCalled();
      expect(savedPDFs[0].estado).toBe('GENERADO');
      expect(programarSpy).toHaveBeenCalledWith('nd-1');
    });

    it('records signing errors as ERROR_FIRMA', async () => {
      jest.spyOn(fs, 'existsSync').mockReturnValue(true);
      invoiceServiceMocks.diagnoseP12Certificate.mockResolvedValue({ isValidP12: false, error: 'corrupt' });
      const nota: any = doc();

      await DebitNoteService.procesarEnvioSRI(nota, empresaMock, clienteMock, requestValido);

      expect(nota.sri_estado).toBe('ERROR_FIRMA');
      expect(nota.sri_mensajes.error).toContain('P12');
    });
  });

  describe('consultarAutorizacionSRI', () => {
    it('updates the debit note when the SRI authorizes it', async () => {
      const nota: any = {
        clave_acceso: 'clave',
        secuencial: '000000001',
        save: jest.fn().mockResolvedValue(undefined),
      };
      debitNoteStatics.findById.mockResolvedValue(nota);
      autorizarComprobanteSRIMock.mockResolvedValue({ estado: 'AUTORIZADO', numeroAutorizacion: 'clave' });

      const resultado = await DebitNoteService.consultarAutorizacionSRI('nd-1');

      expect(resultado?.estado).toBe('AUTORIZADO');
      expect(nota.estado).toBe('AUTORIZADA');
    });

    it('returns null when the debit note does not exist', async () => {
      debitNoteStatics.findById.mockResolvedValue(null);

      await expect(DebitNoteService.consultarAutorizacionSRI('nope')).resolves.toBeNull();
    });
  });

  describe('programarConsultaAutorizacion', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('retries while pending and stops at maxIntentos', async () => {
      const consultarSpy = jest
        .spyOn(DebitNoteService, 'consultarAutorizacionSRI')
        .mockResolvedValue({ estado: 'EN PROCESO' } as any);

      DebitNoteService.programarConsultaAutorizacion('nd-1', 1, 2, 500);
      await jest.advanceTimersByTimeAsync(2000);

      expect(consultarSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('generarPDFNotaDebito', () => {
    it('stores an ERROR record when the PDF generation fails', async () => {
      generateDebitNotePDFMock.mockRejectedValueOnce(new Error('render failed'));
      const nota: any = { _id: 'nd-1', clave_acceso: 'clave', secuencial: '000000001', fecha_emision: new Date() };

      await DebitNoteService.generarPDFNotaDebito(nota, empresaMock, clienteMock, requestValido);

      expect(savedPDFs[0].estado).toBe('ERROR');
    });
  });
});
