import { create } from 'xmlbuilder2';
import { IIssuingCompany } from '../models/IssuingCompany';
import { IClient } from '../models/Client';
import { IProduct } from '../models/Product';
import { InvoiceRequest } from '../interfaces/invoice.interface';
import { CreditNoteRequest } from '../interfaces/credit-note.interface';

/**
 * IVA configuration (tabla 17 de la Ficha Técnica del SRI).
 * Defaults to the 15% rate in force since April 2024 (codigoPorcentaje 4).
 */
export function obtenerConfiguracionIVA(): { tarifa: string; codigoPorcentaje: string } {
  return {
    tarifa: process.env.IVA || '15',
    codigoPorcentaje: process.env.CODIGO_PORCENTAJE || '4',
  };
}

/**
 * Genera un documento XML para una factura electrónica según el formato del SRI de Ecuador
 * @param factura Datos de la factura
 * @param empresa Empresa emisora
 * @param cliente Cliente
 * @param productos Lista de productos
 * @param claveAcceso Clave de acceso generada
 * @param secuencial Número secuencial de la factura
 * @returns XML de la factura como string
 */
export function generarXMLFactura(
  factura: InvoiceRequest,
  empresa: IIssuingCompany,
  cliente: IClient,
  productos: IProduct[],
  claveAcceso: string,
  secuencial: string,
): string {
  const iva = obtenerConfiguracionIVA();
  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('factura', {
      id: 'comprobante',
      version: '1.0.0',
    })
    .ele('infoTributaria')
    .ele('ambiente')
    .txt(String(empresa.tipo_ambiente))
    .up()
    .ele('tipoEmision')
    .txt(String(empresa.tipo_emision))
    .up()
    .ele('razonSocial')
    .txt(empresa.razon_social)
    .up()
    .ele('nombreComercial')
    .txt(empresa.nombre_comercial)
    .up()
    .ele('ruc')
    .txt(empresa.ruc)
    .up()
    .ele('claveAcceso')
    .txt(claveAcceso)
    .up()
    .ele('codDoc')
    .txt('01')
    .up() // factura
    .ele('estab')
    .txt(empresa.codigo_establecimiento)
    .up()
    .ele('ptoEmi')
    .txt(empresa.punto_emision)
    .up()
    .ele('secuencial')
    .txt(secuencial)
    .up()
    .ele('dirMatriz')
    .txt(empresa.direccion_matriz || empresa.direccion || 'Dirección no especificada')
    .up()
    .up()
    .ele('infoFactura')
    .ele('fechaEmision')
    .txt(factura.infoFactura.fechaEmision)
    .up()
    .ele('dirEstablecimiento')
    .txt(empresa.direccion_establecimiento || empresa.direccion || 'Dirección no especificada')
    .up()
    .ele('obligadoContabilidad')
    .txt(empresa.obligado_contabilidad ? 'SI' : 'NO')
    .up()
    .ele('tipoIdentificacionComprador')
    .txt(factura.infoFactura.tipoIdentificacionComprador)
    .up()
    .ele('razonSocialComprador')
    .txt(cliente.razon_social)
    .up()
    .ele('identificacionComprador')
    .txt(cliente.identificacion)
    .up()
    .ele('totalSinImpuestos')
    .txt(factura.infoFactura.totalSinImpuestos)
    .up()
    .ele('totalDescuento')
    .txt('0.00')
    .up()
    .ele('totalConImpuestos')
    .ele('totalImpuesto')
    .ele('codigo')
    .txt('2')
    .up()
    .ele('codigoPorcentaje')
    .txt(iva.codigoPorcentaje)
    .up()
    .ele('baseImponible')
    .txt(factura.infoFactura.totalSinImpuestos)
    .up()
    .ele('valor')
    .txt(
      productos
        .reduce((acc, p) => (p.tiene_iva ? acc + (parseFloat(iva.tarifa) / 100) * p.precio_unitario : acc), 0)
        .toFixed(2),
    )
    .up()
    .up()
    .up()
    .ele('propina')
    .txt('0.00')
    .up()
    .ele('importeTotal')
    .txt(factura.infoFactura.importeTotal)
    .up()
    .ele('moneda')
    .txt('DOLAR')
    .up()
    .up()
    .ele('detalles');

  // Add product details
  for (const item of factura.detalles) {
    const d = item.detalle;
    doc
      .ele('detalle')
      .ele('codigoPrincipal')
      .txt(d.codigoPrincipal)
      .up()
      .ele('descripcion')
      .txt(d.descripcion)
      .up()
      .ele('cantidad')
      .txt(d.cantidad)
      .up()
      .ele('precioUnitario')
      .txt(d.precioUnitario)
      .up()
      .ele('descuento')
      .txt('0.00')
      .up()
      .ele('precioTotalSinImpuesto')
      .txt(d.precioTotalSinImpuesto)
      .up()
      .ele('impuestos')
      .ele('impuesto')
      .ele('codigo')
      .txt('2')
      .up()
      .ele('codigoPorcentaje')
      .txt(iva.codigoPorcentaje)
      .up()
      .ele('tarifa')
      .txt(`${iva.tarifa}.00`)
      .up()
      .ele('baseImponible')
      .txt(d.precioTotalSinImpuesto)
      .up()
      .ele('valor')
      .txt(d.impuestos[0].impuesto.valor)
      .up()
      .up()
      .up()
      .up();
  }

  doc
    .up() // salir de <detalles>
    .ele('infoAdicional')
    .ele('campoAdicional', { nombre: 'Email' })
    .txt(cliente.email || 'sinfactura@cliente.com')
    .up()
    .ele('campoAdicional', { nombre: 'Teléfono' })
    .txt(cliente.telefono || '0000000000')
    .up();

  return doc.end({ prettyPrint: true });
}

/**
 * Genera un documento XML para una nota de crédito electrónica según el formato
 * v1.1.0 de la Ficha Técnica del SRI de Ecuador (codDoc 04)
 * @param notaCredito Datos de la nota de crédito
 * @param empresa Empresa emisora
 * @param cliente Cliente
 * @param claveAcceso Clave de acceso generada
 * @param secuencial Número secuencial de la nota de crédito
 * @returns XML de la nota de crédito como string
 */
export function generarXMLNotaCredito(
  notaCredito: CreditNoteRequest,
  empresa: IIssuingCompany,
  cliente: IClient,
  claveAcceso: string,
  secuencial: string,
): string {
  const info = notaCredito.infoNotaCredito;
  const totalIva = notaCredito.detalles
    .reduce((acc, d) => acc + parseFloat(d.detalle.impuestos[0].impuesto.valor), 0)
    .toFixed(2);
  // Tax codes are taken from the request details (tablas 16 y 17 de la ficha técnica)
  const impuestoReferencia = notaCredito.detalles[0].detalle.impuestos[0].impuesto;

  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('notaCredito', {
      id: 'comprobante',
      version: '1.1.0',
    })
    .ele('infoTributaria')
    .ele('ambiente')
    .txt(String(empresa.tipo_ambiente))
    .up()
    .ele('tipoEmision')
    .txt(String(empresa.tipo_emision))
    .up()
    .ele('razonSocial')
    .txt(empresa.razon_social)
    .up()
    .ele('nombreComercial')
    .txt(empresa.nombre_comercial)
    .up()
    .ele('ruc')
    .txt(empresa.ruc)
    .up()
    .ele('claveAcceso')
    .txt(claveAcceso)
    .up()
    .ele('codDoc')
    .txt('04')
    .up() // nota de crédito
    .ele('estab')
    .txt(empresa.codigo_establecimiento)
    .up()
    .ele('ptoEmi')
    .txt(empresa.punto_emision)
    .up()
    .ele('secuencial')
    .txt(secuencial)
    .up()
    .ele('dirMatriz')
    .txt(empresa.direccion_matriz || empresa.direccion || 'Dirección no especificada')
    .up()
    .up()
    .ele('infoNotaCredito')
    .ele('fechaEmision')
    .txt(info.fechaEmision)
    .up()
    .ele('dirEstablecimiento')
    .txt(empresa.direccion_establecimiento || empresa.direccion || 'Dirección no especificada')
    .up()
    .ele('tipoIdentificacionComprador')
    .txt(info.tipoIdentificacionComprador)
    .up()
    .ele('razonSocialComprador')
    .txt(cliente.razon_social)
    .up()
    .ele('identificacionComprador')
    .txt(cliente.identificacion)
    .up()
    .ele('obligadoContabilidad')
    .txt(empresa.obligado_contabilidad ? 'SI' : 'NO')
    .up()
    .ele('codDocModificado')
    .txt(info.codDocModificado)
    .up()
    .ele('numDocModificado')
    .txt(info.numDocModificado)
    .up()
    .ele('fechaEmisionDocSustento')
    .txt(info.fechaEmisionDocSustento)
    .up()
    .ele('totalSinImpuestos')
    .txt(info.totalSinImpuestos)
    .up()
    .ele('valorModificacion')
    .txt(info.valorModificacion)
    .up()
    .ele('moneda')
    .txt(info.moneda || 'DOLAR')
    .up()
    .ele('totalConImpuestos')
    .ele('totalImpuesto')
    .ele('codigo')
    .txt(impuestoReferencia.codigo)
    .up()
    .ele('codigoPorcentaje')
    .txt(impuestoReferencia.codigoPorcentaje)
    .up()
    .ele('baseImponible')
    .txt(info.totalSinImpuestos)
    .up()
    .ele('valor')
    .txt(totalIva)
    .up()
    .up()
    .up()
    .ele('motivo')
    .txt(info.motivo)
    .up()
    .up()
    .ele('detalles');

  // Add credit note details
  for (const item of notaCredito.detalles) {
    const d = item.detalle;
    const impuesto = d.impuestos[0].impuesto;
    const detalle = doc.ele('detalle').ele('codigoInterno').txt(d.codigoInterno).up();

    if (d.codigoAdicional) {
      detalle.ele('codigoAdicional').txt(d.codigoAdicional).up();
    }

    detalle
      .ele('descripcion')
      .txt(d.descripcion)
      .up()
      .ele('cantidad')
      .txt(d.cantidad)
      .up()
      .ele('precioUnitario')
      .txt(d.precioUnitario)
      .up()
      .ele('descuento')
      .txt(d.descuento || '0.00')
      .up()
      .ele('precioTotalSinImpuesto')
      .txt(d.precioTotalSinImpuesto)
      .up()
      .ele('impuestos')
      .ele('impuesto')
      .ele('codigo')
      .txt(impuesto.codigo)
      .up()
      .ele('codigoPorcentaje')
      .txt(impuesto.codigoPorcentaje)
      .up()
      .ele('tarifa')
      .txt(impuesto.tarifa)
      .up()
      .ele('baseImponible')
      .txt(impuesto.baseImponible)
      .up()
      .ele('valor')
      .txt(impuesto.valor)
      .up()
      .up()
      .up()
      .up();
  }

  doc
    .up() // salir de <detalles>
    .ele('infoAdicional')
    .ele('campoAdicional', { nombre: 'Email' })
    .txt(cliente.email || 'sinfactura@cliente.com')
    .up()
    .ele('campoAdicional', { nombre: 'Teléfono' })
    .txt(cliente.telefono || '0000000000')
    .up();

  return doc.end({ prettyPrint: true });
}
