import { generarXMLNotaCredito, obtenerConfiguracionIVA } from '../../src/utils/xml.utils';
import { generarClaveAcceso, obtenerDigitoVerificador } from '../../src/utils/invoice.utils';
import { CreditNoteRequest } from '../../src/interfaces/credit-note.interface';

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
  email: 'cliente@test.com',
  telefono: '0999999999',
};

const notaCreditoMock: CreditNoteRequest = {
  infoTributaria: { ruc: '1790012345001', claveAcceso: '', secuencial: '' },
  infoNotaCredito: {
    fechaEmision: '17/05/2025',
    tipoIdentificacionComprador: '05',
    identificacionComprador: '0106079783',
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
};

describe('obtenerConfiguracionIVA', () => {
  const originalIva = process.env.IVA;
  const originalCodigo = process.env.CODIGO_PORCENTAJE;

  afterEach(() => {
    process.env.IVA = originalIva;
    process.env.CODIGO_PORCENTAJE = originalCodigo;
    if (originalIva === undefined) delete process.env.IVA;
    if (originalCodigo === undefined) delete process.env.CODIGO_PORCENTAJE;
  });

  it('defaults to 15% (codigoPorcentaje 4)', () => {
    delete process.env.IVA;
    delete process.env.CODIGO_PORCENTAJE;
    expect(obtenerConfiguracionIVA()).toEqual({ tarifa: '15', codigoPorcentaje: '4' });
  });

  it('honors environment overrides', () => {
    process.env.IVA = '12';
    process.env.CODIGO_PORCENTAJE = '2';
    expect(obtenerConfiguracionIVA()).toEqual({ tarifa: '12', codigoPorcentaje: '2' });
  });
});

describe('generarClaveAcceso for credit notes', () => {
  it('generates a 49-digit access key with document type 04', () => {
    const clave = generarClaveAcceso({
      fecha: new Date(Date.UTC(2025, 4, 17)),
      tipoComprobante: '04',
      ruc: '1790012345001',
      ambiente: '1',
      serie: '001001',
      secuencial: '000000001',
      codigoNumerico: '12345678',
      tipoEmision: '1',
    });

    expect(clave).toHaveLength(49);
    // ddmmyyyy (8) + tipoComprobante (2)
    expect(clave.substring(0, 8)).toBe('17052025');
    expect(clave.substring(8, 10)).toBe('04');
    // Valid módulo 11 check digit
    expect(clave[48]).toBe(obtenerDigitoVerificador(clave.substring(0, 48)));
  });
});

describe('generarXMLNotaCredito', () => {
  const xml = generarXMLNotaCredito(
    notaCreditoMock,
    empresaMock,
    clienteMock,
    '1705202504179001234500110010010000000011234567810',
    '000000001',
  );

  it('generates the notaCredito root with version 1.1.0 and id comprobante', () => {
    expect(xml).toContain('<notaCredito id="comprobante" version="1.1.0">');
  });

  it('uses codDoc 04', () => {
    expect(xml).toContain('<codDoc>04</codDoc>');
  });

  it('includes the infoNotaCredito specific fields', () => {
    expect(xml).toContain('<codDocModificado>01</codDocModificado>');
    expect(xml).toContain('<numDocModificado>001-001-000000123</numDocModificado>');
    expect(xml).toContain('<fechaEmisionDocSustento>10/05/2025</fechaEmisionDocSustento>');
    expect(xml).toContain('<valorModificacion>115.00</valorModificacion>');
    expect(xml).toContain('<motivo>DEVOLUCIÓN</motivo>');
  });

  it('uses codigoInterno for details (not codigoPrincipal)', () => {
    expect(xml).toContain('<codigoInterno>P001</codigoInterno>');
    expect(xml).not.toContain('codigoPrincipal');
  });

  it('takes tax codes from the request details', () => {
    expect(xml).toContain('<codigoPorcentaje>4</codigoPorcentaje>');
    expect(xml).toContain('<tarifa>15.00</tarifa>');
  });

  it('computes totalConImpuestos from the details', () => {
    expect(xml).toContain('<baseImponible>100.00</baseImponible>');
    expect(xml).toContain('<valor>15.00</valor>');
  });
});
