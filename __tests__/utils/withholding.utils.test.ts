import { generarXMLRetencion } from '../../src/utils/xml.utils';
import { generarClaveAcceso, obtenerDigitoVerificador } from '../../src/utils/invoice.utils';
import { WithholdingRequest } from '../../src/interfaces/withholding.interface';

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

const retencionMock: WithholdingRequest = {
  infoTributaria: { ruc: '1790012345001', claveAcceso: '', secuencial: '' },
  infoCompRetencion: {
    fechaEmision: '17/05/2025',
    tipoIdentificacionSujetoRetenido: '04',
    parteRel: 'NO',
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
        numAutDocSustento: '1005202501179001234500110010010000001231234567818',
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
        pagos: [
          {
            pago: {
              formaPago: '01',
              total: '115.00',
            },
          },
        ],
      },
    },
  ],
};

describe('generarClaveAcceso for withholding certificates', () => {
  it('generates a 49-digit access key with document type 07', () => {
    const clave = generarClaveAcceso({
      fecha: new Date(Date.UTC(2025, 4, 17)),
      tipoComprobante: '07',
      ruc: '1790012345001',
      ambiente: '1',
      serie: '001001',
      secuencial: '000000001',
      codigoNumerico: '12345678',
      tipoEmision: '1',
    });

    expect(clave).toHaveLength(49);
    expect(clave.substring(8, 10)).toBe('07');
    expect(clave[48]).toBe(obtenerDigitoVerificador(clave.substring(0, 48)));
  });
});

describe('generarXMLRetencion', () => {
  const xml = generarXMLRetencion(
    retencionMock,
    empresaMock,
    '1705202507179001234500110010010000000011234567810',
    '000000001',
  );

  it('generates the comprobanteRetencion root with version 2.0.0 and id comprobante', () => {
    expect(xml).toContain('<comprobanteRetencion id="comprobante" version="2.0.0">');
  });

  it('uses codDoc 07', () => {
    expect(xml).toContain('<codDoc>07</codDoc>');
  });

  it('includes the infoCompRetencion fields', () => {
    expect(xml).toContain('<tipoIdentificacionSujetoRetenido>04</tipoIdentificacionSujetoRetenido>');
    expect(xml).toContain('<parteRel>NO</parteRel>');
    expect(xml).toContain('<razonSocialSujetoRetenido>Proveedor S.A.</razonSocialSujetoRetenido>');
    expect(xml).toContain('<identificacionSujetoRetenido>1713328506001</identificacionSujetoRetenido>');
    expect(xml).toContain('<periodoFiscal>05/2025</periodoFiscal>');
  });

  it('omits tipoSujetoRetenido when not provided', () => {
    expect(xml).not.toContain('<tipoSujetoRetenido>');
  });

  it('includes the docSustento with its catalog codes and totals', () => {
    expect(xml).toContain('<codSustento>01</codSustento>');
    expect(xml).toContain('<codDocSustento>01</codDocSustento>');
    expect(xml).toContain('<numDocSustento>001001000000123</numDocSustento>');
    expect(xml).toContain('<pagoLocExt>01</pagoLocExt>');
    expect(xml).toContain('<totalSinImpuestos>100.00</totalSinImpuestos>');
    expect(xml).toContain('<importeTotal>115.00</importeTotal>');
  });

  it('includes the impuestosDocSustento block', () => {
    expect(xml).toContain('<codImpuestoDocSustento>2</codImpuestoDocSustento>');
    expect(xml).toContain('<valorImpuesto>15.00</valorImpuesto>');
  });

  it('includes every retencion with its codes and values', () => {
    expect((xml.match(/<retencion>/g) || []).length).toBe(2);
    expect(xml).toContain('<codigoRetencion>312</codigoRetencion>');
    expect(xml).toContain('<porcentajeRetener>1.75</porcentajeRetener>');
    expect(xml).toContain('<valorRetenido>1.75</valorRetenido>');
    expect(xml).toContain('<codigoRetencion>3</codigoRetencion>');
    expect(xml).toContain('<valorRetenido>10.50</valorRetenido>');
  });

  it('includes the pagos block with the ATS formapago tag', () => {
    // El Anexo 10 del ATS 2.0.0 usa la etiqueta <formapago> en minúscula
    expect(xml).toContain('<formapago>01</formapago>');
    expect(xml).toContain('<total>115.00</total>');
  });

  it('nests the blocks inside docSustento in the required order', () => {
    const docSustento = xml.substring(xml.indexOf('<docSustento>'), xml.indexOf('</docSustento>'));
    expect(docSustento).toContain('<impuestosDocSustento>');
    expect(docSustento).toContain('<retenciones>');
    expect(docSustento).toContain('<pagos>');
    expect(docSustento.indexOf('<impuestosDocSustento>')).toBeLessThan(docSustento.indexOf('<retenciones>'));
    expect(docSustento.indexOf('<retenciones>')).toBeLessThan(docSustento.indexOf('<pagos>'));
  });
});
