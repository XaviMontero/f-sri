import { generarXMLNotaDebito } from '../../src/utils/xml.utils';
import { generarClaveAcceso, obtenerDigitoVerificador } from '../../src/utils/invoice.utils';
import { DebitNoteRequest } from '../../src/interfaces/debit-note.interface';

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

const notaDebitoMock: DebitNoteRequest = {
  infoTributaria: { ruc: '1790012345001', claveAcceso: '', secuencial: '' },
  infoNotaDebito: {
    fechaEmision: '17/05/2025',
    tipoIdentificacionComprador: '05',
    identificacionComprador: '0106079783',
    codDocModificado: '01',
    numDocModificado: '001-001-000000123',
    fechaEmisionDocSustento: '10/05/2025',
    totalSinImpuestos: '50.00',
    impuestos: [
      {
        impuesto: {
          codigo: '2',
          codigoPorcentaje: '4',
          tarifa: '15.00',
          baseImponible: '50.00',
          valor: '7.50',
        },
      },
    ],
    valorTotal: '57.50',
    pagos: [
      {
        pago: {
          formaPago: '20',
          total: '57.50',
          plazo: '15',
          unidadTiempo: 'dias',
        },
      },
    ],
  },
  motivos: [
    {
      motivo: {
        razon: 'Interés por mora',
        valor: '50.00',
      },
    },
  ],
};

describe('generarClaveAcceso for debit notes', () => {
  it('generates a 49-digit access key with document type 05', () => {
    const clave = generarClaveAcceso({
      fecha: new Date(Date.UTC(2025, 4, 17)),
      tipoComprobante: '05',
      ruc: '1790012345001',
      ambiente: '1',
      serie: '001001',
      secuencial: '000000001',
      codigoNumerico: '12345678',
      tipoEmision: '1',
    });

    expect(clave).toHaveLength(49);
    expect(clave.substring(8, 10)).toBe('05');
    expect(clave[48]).toBe(obtenerDigitoVerificador(clave.substring(0, 48)));
  });
});

describe('generarXMLNotaDebito', () => {
  const xml = generarXMLNotaDebito(
    notaDebitoMock,
    empresaMock,
    clienteMock,
    '1705202505179001234500110010010000000011234567810',
    '000000001',
  );

  it('generates the notaDebito root with version 1.0.0 and id comprobante', () => {
    expect(xml).toContain('<notaDebito id="comprobante" version="1.0.0">');
  });

  it('uses codDoc 05', () => {
    expect(xml).toContain('<codDoc>05</codDoc>');
  });

  it('includes the infoNotaDebito specific fields', () => {
    expect(xml).toContain('<codDocModificado>01</codDocModificado>');
    expect(xml).toContain('<numDocModificado>001-001-000000123</numDocModificado>');
    expect(xml).toContain('<fechaEmisionDocSustento>10/05/2025</fechaEmisionDocSustento>');
    expect(xml).toContain('<totalSinImpuestos>50.00</totalSinImpuestos>');
    expect(xml).toContain('<valorTotal>57.50</valorTotal>');
  });

  it('includes the impuestos block with tax codes from the request', () => {
    expect(xml).toContain('<codigoPorcentaje>4</codigoPorcentaje>');
    expect(xml).toContain('<tarifa>15.00</tarifa>');
    expect(xml).toContain('<valor>7.50</valor>');
  });

  it('includes the pagos block with optional plazo and unidadTiempo', () => {
    expect(xml).toContain('<formaPago>20</formaPago>');
    expect(xml).toContain('<total>57.50</total>');
    expect(xml).toContain('<plazo>15</plazo>');
    expect(xml).toContain('<unidadTiempo>dias</unidadTiempo>');
  });

  it('omits plazo and unidadTiempo when not provided', () => {
    const sinPlazo: DebitNoteRequest = JSON.parse(JSON.stringify(notaDebitoMock));
    delete sinPlazo.infoNotaDebito.pagos[0].pago.plazo;
    delete sinPlazo.infoNotaDebito.pagos[0].pago.unidadTiempo;

    const xmlSinPlazo = generarXMLNotaDebito(sinPlazo, empresaMock, clienteMock, 'clave', '000000001');

    expect(xmlSinPlazo).not.toContain('<plazo>');
    expect(xmlSinPlazo).not.toContain('<unidadTiempo>');
  });

  it('renders motivos with razon and valor instead of product detalles', () => {
    expect(xml).toContain('<motivos>');
    expect(xml).toContain('<razon>Interés por mora</razon>');
    expect(xml).toContain('<valor>50.00</valor>');
    expect(xml).not.toContain('<detalles>');
  });
});
