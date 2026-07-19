const setContentMock = jest.fn();
const pdfMock = jest.fn().mockResolvedValue(Buffer.from('pdf-bytes'));
const closeMock = jest.fn();
const launchMock = jest.fn().mockResolvedValue({
  newPage: jest.fn().mockResolvedValue({
    setViewport: jest.fn(),
    setContent: setContentMock,
    pdf: pdfMock,
  }),
  close: closeMock,
});

jest.mock('puppeteer', () => ({
  __esModule: true,
  default: { launch: (...args: any[]) => launchMock(...args) },
}));

import fs from 'fs';
import {
  generateInvoicePDF,
  generateCreditNotePDF,
  generateDebitNotePDF,
  generateDeliveryNotePDF,
  generateWithholdingPDF,
  savePDFToFile,
} from '../../src/utils/pdf.utils';

const empresaMock: any = {
  tipo_ambiente: 1,
  tipo_emision: 1,
  razon_social: 'EMPRESA DEMO S.A.',
  nombre_comercial: 'DEMO',
  ruc: '1790012345001',
  codigo_establecimiento: '001',
  punto_emision: '001',
  direccion_matriz: 'Av. Principal 123',
  direccion_establecimiento: 'Av. Principal 123',
  obligado_contabilidad: true,
};

const clienteMock: any = {
  razon_social: 'CLIENTE DE PRUEBA',
  identificacion: '0106079783',
  direccion: 'Calle Larga 456',
  email: 'cliente@test.com',
  telefono: '0999999999',
};

const productoMock: any = { descripcion_adicional: 'Serie X' };

const baseData = {
  empresa: empresaMock,
  cliente: clienteMock,
  claveAcceso: '1705202501179001234500110010010000000011234567810',
  secuencial: '000000001',
  fechaEmision: new Date('2025-05-17T12:00:00Z'),
  numeroAutorizacion: '1705202501179001234500110010010000000011234567810',
  fechaAutorizacion: new Date('2025-05-17T12:05:00Z'),
};

const ultimoHTML = () => setContentMock.mock.calls[setContentMock.mock.calls.length - 1][0] as string;

describe('PDF generators', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('generates the invoice RIDE with totals and client info', async () => {
    const buffer = await generateInvoicePDF({
      ...baseData,
      factura: {
        infoFactura: { totalSinImpuestos: '100.00', importeTotal: '115.00' },
        detalles: [
          {
            detalle: {
              descripcion: 'Laptop Lenovo',
              cantidad: '1.00',
              precioUnitario: '100.00',
              precioTotalSinImpuesto: '100.00',
            },
          },
        ],
      },
      productos: [productoMock],
    } as any);

    expect(Buffer.isBuffer(buffer)).toBe(true);
    const html = ultimoHTML();
    expect(html).toContain('FACTURA');
    expect(html).toContain('EMPRESA DEMO S.A.');
    expect(html).toContain('CLIENTE DE PRUEBA');
    expect(html).toContain('Laptop Lenovo');
    expect(html).toContain('$115.00');
    expect(html).toContain(baseData.claveAcceso);
  });

  it('generates the credit note RIDE with the modified document info', async () => {
    await generateCreditNotePDF({
      ...baseData,
      productos: [productoMock],
      notaCredito: {
        infoTributaria: { ruc: empresaMock.ruc },
        infoNotaCredito: {
          fechaEmision: '17/05/2025',
          tipoIdentificacionComprador: '05',
          identificacionComprador: clienteMock.identificacion,
          codDocModificado: '01',
          numDocModificado: '001-001-000000123',
          fechaEmisionDocSustento: '10/05/2025',
          totalSinImpuestos: '100.00',
          valorModificacion: '115.00',
          motivo: 'DEVOLUCIÓN',
        },
        detalles: [
          {
            detalle: {
              codigoInterno: 'P001',
              descripcion: 'Laptop Lenovo',
              cantidad: '1.00',
              precioUnitario: '100.00',
              precioTotalSinImpuesto: '100.00',
              impuestos: [
                {
                  impuesto: {
                    codigo: '2',
                    codigoPorcentaje: '4',
                    tarifa: '15.00',
                    baseImponible: '100.00',
                    valor: '15.00',
                  },
                },
              ],
            },
          },
        ],
      },
    } as any);

    const html = ultimoHTML();
    expect(html).toContain('NOTA DE CRÉDITO');
    expect(html).toContain('FACTURA 001-001-000000123');
    expect(html).toContain('DEVOLUCIÓN');
  });

  it('generates the debit note RIDE with the motivos as line items', async () => {
    await generateDebitNotePDF({
      ...baseData,
      notaDebito: {
        infoTributaria: { ruc: empresaMock.ruc },
        infoNotaDebito: {
          fechaEmision: '17/05/2025',
          tipoIdentificacionComprador: '05',
          identificacionComprador: clienteMock.identificacion,
          codDocModificado: '01',
          numDocModificado: '001-001-000000123',
          fechaEmisionDocSustento: '10/05/2025',
          totalSinImpuestos: '50.00',
          impuestos: [
            {
              impuesto: { codigo: '2', codigoPorcentaje: '4', tarifa: '15.00', baseImponible: '50.00', valor: '7.50' },
            },
          ],
          valorTotal: '57.50',
          pagos: [{ pago: { formaPago: '20', total: '57.50' } }],
        },
        motivos: [{ motivo: { razon: 'Interés por mora', valor: '50.00' } }],
      },
    } as any);

    const html = ultimoHTML();
    expect(html).toContain('NOTA DE DÉBITO');
    expect(html).toContain('Interés por mora');
    expect(html).toContain('$57.50');
  });

  it('generates the delivery note RIDE with transport and destinatarios (no totals)', async () => {
    await generateDeliveryNotePDF({
      ...baseData,
      guiaRemision: {
        infoTributaria: { ruc: empresaMock.ruc },
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
              motivoTraslado: 'Venta de mercadería',
              codDocSustento: '01',
              numDocSustento: '001-001-000000123',
              fechaEmisionDocSustento: '17/05/2025',
              detalles: [{ detalle: { codigoInterno: 'P001', descripcion: 'Laptop Lenovo', cantidad: '10.00' } }],
            },
          },
        ],
      },
    } as any);

    const html = ultimoHTML();
    expect(html).toContain('GUÍA DE REMISIÓN');
    expect(html).toContain('Transportes S.A.');
    expect(html).toContain('MCL0827');
    expect(html).toContain('Juan Pérez');
    expect(html).toContain('FACTURA 001-001-000000123');
    expect(html).not.toContain('VALOR TOTAL');
  });

  it('generates the withholding RIDE with the retenciones table and total', async () => {
    await generateWithholdingPDF({
      ...baseData,
      retencion: {
        infoTributaria: { ruc: empresaMock.ruc },
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
              impuestosDocSustento: [],
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
      },
    } as any);

    const html = ultimoHTML();
    expect(html).toContain('COMPROBANTE DE RETENCIÓN');
    expect(html).toContain('Proveedor S.A.');
    expect(html).toContain('RENTA');
    expect(html).toContain('IVA');
    expect(html).toContain('312');
    expect(html).toContain('$12.25'); // 1.75 + 10.50
  });

  it('closes the browser and rethrows when PDF rendering fails', async () => {
    pdfMock.mockRejectedValueOnce(new Error('render failed'));

    await expect(
      generateInvoicePDF({
        ...baseData,
        factura: { infoFactura: { totalSinImpuestos: '1', importeTotal: '1' }, detalles: [] },
        productos: [],
      } as any),
    ).rejects.toThrow('Failed to generate PDF');

    expect(closeMock).toHaveBeenCalled();
  });
});

describe('savePDFToFile', () => {
  it('writes the buffer to a temp file and returns its path', async () => {
    const filePath = await savePDFToFile(Buffer.from('pdf'), `test-pdf-${process.pid}`);

    expect(filePath).toContain('test-pdf');
    expect(fs.existsSync(filePath)).toBe(true);
    fs.unlinkSync(filePath);
  });
});
