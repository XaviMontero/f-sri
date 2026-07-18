import { generarXMLGuiaRemision } from '../../src/utils/xml.utils';
import { generarClaveAcceso, obtenerDigitoVerificador } from '../../src/utils/invoice.utils';
import { DeliveryNoteRequest } from '../../src/interfaces/delivery-note.interface';

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

const guiaRemisionMock: DeliveryNoteRequest = {
  infoTributaria: { ruc: '1790012345001', claveAcceso: '', secuencial: '' },
  infoGuiaRemision: {
    fechaEmision: '17/05/2025',
    dirPartida: 'Av. Eloy Alfaro 34 y Av. Libertad',
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
        ruta: 'Quito - Cayambe - Otavalo',
        codDocSustento: '01',
        numDocSustento: '001-001-000000123',
        numAutDocSustento: '1705202501179001234500110010010000000011234567810',
        fechaEmisionDocSustento: '17/05/2025',
        detalles: [
          {
            detalle: {
              codigoInterno: 'P001',
              descripcion: 'Laptop Lenovo',
              cantidad: '10.00',
            },
          },
          {
            detalle: {
              descripcion: 'Mouse inalámbrico',
              cantidad: '25.00',
            },
          },
        ],
      },
    },
    {
      destinatario: {
        identificacionDestinatario: '0106079783',
        razonSocialDestinatario: 'María García',
        dirDestinatario: 'Calle Larga 456',
        motivoTraslado: 'Traslado entre bodegas',
        detalles: [
          {
            detalle: {
              descripcion: 'Monitor 24 pulgadas',
              cantidad: '5.00',
            },
          },
        ],
      },
    },
  ],
};

describe('generarClaveAcceso for delivery notes', () => {
  it('generates a 49-digit access key with document type 06', () => {
    const clave = generarClaveAcceso({
      fecha: new Date(Date.UTC(2025, 4, 17)),
      tipoComprobante: '06',
      ruc: '1790012345001',
      ambiente: '1',
      serie: '001001',
      secuencial: '000000001',
      codigoNumerico: '12345678',
      tipoEmision: '1',
    });

    expect(clave).toHaveLength(49);
    expect(clave.substring(8, 10)).toBe('06');
    expect(clave[48]).toBe(obtenerDigitoVerificador(clave.substring(0, 48)));
  });
});

describe('generarXMLGuiaRemision', () => {
  const xml = generarXMLGuiaRemision(
    guiaRemisionMock,
    empresaMock,
    '1705202506179001234500110010010000000011234567810',
    '000000001',
  );

  it('generates the guiaRemision root with version 1.1.0 and id comprobante', () => {
    expect(xml).toContain('<guiaRemision id="comprobante" version="1.1.0">');
  });

  it('uses codDoc 06', () => {
    expect(xml).toContain('<codDoc>06</codDoc>');
  });

  it('includes the transport information', () => {
    expect(xml).toContain('<dirPartida>Av. Eloy Alfaro 34 y Av. Libertad</dirPartida>');
    expect(xml).toContain('<razonSocialTransportista>Transportes S.A.</razonSocialTransportista>');
    expect(xml).toContain('<tipoIdentificacionTransportista>04</tipoIdentificacionTransportista>');
    expect(xml).toContain('<rucTransportista>1796875790001</rucTransportista>');
    expect(xml).toContain('<fechaIniTransporte>17/05/2025</fechaIniTransporte>');
    expect(xml).toContain('<fechaFinTransporte>18/05/2025</fechaFinTransporte>');
    expect(xml).toContain('<placa>MCL0827</placa>');
  });

  it('renders every destinatario with its own detalles', () => {
    expect((xml.match(/<destinatario>/g) || []).length).toBe(2);
    expect(xml).toContain('<identificacionDestinatario>1716849140001</identificacionDestinatario>');
    expect(xml).toContain('<identificacionDestinatario>0106079783</identificacionDestinatario>');
    expect((xml.match(/<detalles>/g) || []).length).toBe(2);
    expect((xml.match(/<detalle>/g) || []).length).toBe(3);
  });

  it('includes the documento de sustento fields when provided', () => {
    expect(xml).toContain('<codDocSustento>01</codDocSustento>');
    expect(xml).toContain('<numDocSustento>001-001-000000123</numDocSustento>');
    expect(xml).toContain('<ruta>Quito - Cayambe - Otavalo</ruta>');
  });

  it('omits optional fields when not provided', () => {
    // Second destinatario has no ruta/doc sustento; second detalle has no codigoInterno
    expect((xml.match(/<ruta>/g) || []).length).toBe(1);
    expect((xml.match(/<codDocSustento>/g) || []).length).toBe(1);
    expect((xml.match(/<codigoInterno>/g) || []).length).toBe(1);
  });

  it('contains no monetary fields', () => {
    expect(xml).not.toContain('precioUnitario');
    expect(xml).not.toContain('totalSinImpuestos');
    expect(xml).not.toContain('importeTotal');
    expect(xml).not.toContain('<impuestos>');
  });

  it('nests detalles inside each destinatario', () => {
    const primerDestinatario = xml.substring(
      xml.indexOf('<destinatario>'),
      xml.indexOf('</destinatario>') + '</destinatario>'.length,
    );
    expect(primerDestinatario).toContain('<descripcion>Laptop Lenovo</descripcion>');
    expect(primerDestinatario).toContain('<cantidad>10.00</cantidad>');
  });
});
