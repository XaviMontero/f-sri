import { create } from 'xmlbuilder2';
import { IIssuingCompany } from '../models/IssuingCompany';
import { IClient } from '../models/Client';
import { IProduct } from '../models/Product';
import { InvoiceRequest } from '../interfaces/invoice.interface';
import { CreditNoteRequest } from '../interfaces/credit-note.interface';
import { DebitNoteRequest } from '../interfaces/debit-note.interface';
import { DeliveryNoteRequest } from '../interfaces/delivery-note.interface';
import { WithholdingRequest } from '../interfaces/withholding.interface';

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

/**
 * Genera un documento XML para una nota de débito electrónica según el formato
 * v1.0.0 de la Ficha Técnica del SRI de Ecuador (codDoc 05)
 * @param notaDebito Datos de la nota de débito
 * @param empresa Empresa emisora
 * @param cliente Cliente
 * @param claveAcceso Clave de acceso generada
 * @param secuencial Número secuencial de la nota de débito
 * @returns XML de la nota de débito como string
 */
export function generarXMLNotaDebito(
  notaDebito: DebitNoteRequest,
  empresa: IIssuingCompany,
  cliente: IClient,
  claveAcceso: string,
  secuencial: string,
): string {
  const info = notaDebito.infoNotaDebito;

  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('notaDebito', {
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
    .txt('05')
    .up() // nota de débito
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
    .ele('infoNotaDebito')
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
    .ele('impuestos');

  // Tax codes are taken from the request (tablas 16 y 17 de la ficha técnica).
  // La tarifa de IVA corresponde a la fecha de emisión del documento de sustento.
  for (const item of info.impuestos) {
    const impuesto = item.impuesto;
    doc
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
      .up();
  }

  // Cursor tracking: xmlbuilder2 returns a new node reference on each call,
  // so the position after each block must be captured explicitly
  const pagosNode = doc
    .up() // salir de <impuestos>
    .ele('valorTotal')
    .txt(info.valorTotal)
    .up()
    .ele('pagos');

  for (const item of info.pagos) {
    const pago = item.pago;
    const pagoNode = pagosNode.ele('pago').ele('formaPago').txt(pago.formaPago).up().ele('total').txt(pago.total).up();

    if (pago.plazo) {
      pagoNode.ele('plazo').txt(pago.plazo).up();
    }
    if (pago.unidadTiempo) {
      pagoNode.ele('unidadTiempo').txt(pago.unidadTiempo).up();
    }
  }

  const motivosNode = pagosNode
    .up() // salir de <pagos>
    .up() // salir de <infoNotaDebito>
    .ele('motivos');

  for (const item of notaDebito.motivos) {
    motivosNode.ele('motivo').ele('razon').txt(item.motivo.razon).up().ele('valor').txt(item.motivo.valor).up().up();
  }

  motivosNode
    .up() // salir de <motivos>
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
 * Genera un documento XML para una guía de remisión electrónica según el formato
 * v1.1.0 de la Ficha Técnica del SRI de Ecuador (codDoc 06).
 * Documento sin valores monetarios: describe el transporte y los destinatarios.
 * @param guiaRemision Datos de la guía de remisión
 * @param empresa Empresa emisora
 * @param claveAcceso Clave de acceso generada
 * @param secuencial Número secuencial de la guía de remisión
 * @returns XML de la guía de remisión como string
 */
export function generarXMLGuiaRemision(
  guiaRemision: DeliveryNoteRequest,
  empresa: IIssuingCompany,
  claveAcceso: string,
  secuencial: string,
): string {
  const info = guiaRemision.infoGuiaRemision;

  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('guiaRemision', {
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
    .txt('06')
    .up() // guía de remisión
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
    .ele('infoGuiaRemision')
    .ele('dirEstablecimiento')
    .txt(empresa.direccion_establecimiento || empresa.direccion || 'Dirección no especificada')
    .up()
    .ele('dirPartida')
    .txt(info.dirPartida)
    .up()
    .ele('razonSocialTransportista')
    .txt(info.razonSocialTransportista)
    .up()
    .ele('tipoIdentificacionTransportista')
    .txt(info.tipoIdentificacionTransportista)
    .up()
    .ele('rucTransportista')
    .txt(info.rucTransportista)
    .up()
    .ele('obligadoContabilidad')
    .txt(empresa.obligado_contabilidad ? 'SI' : 'NO')
    .up()
    .ele('fechaIniTransporte')
    .txt(info.fechaIniTransporte)
    .up()
    .ele('fechaFinTransporte')
    .txt(info.fechaFinTransporte)
    .up()
    .ele('placa')
    .txt(info.placa)
    .up()
    .up()
    .ele('destinatarios');

  // Cursor tracking: xmlbuilder2 returns a new node reference on each call,
  // so nested loops must build from an explicitly captured parent node
  for (const item of guiaRemision.destinatarios) {
    const dest = item.destinatario;
    const destNode = doc
      .ele('destinatario')
      .ele('identificacionDestinatario')
      .txt(dest.identificacionDestinatario)
      .up()
      .ele('razonSocialDestinatario')
      .txt(dest.razonSocialDestinatario)
      .up()
      .ele('dirDestinatario')
      .txt(dest.dirDestinatario)
      .up()
      .ele('motivoTraslado')
      .txt(dest.motivoTraslado)
      .up();

    if (dest.docAduaneroUnico) {
      destNode.ele('docAduaneroUnico').txt(dest.docAduaneroUnico).up();
    }
    if (dest.codEstabDestino) {
      destNode.ele('codEstabDestino').txt(dest.codEstabDestino).up();
    }
    if (dest.ruta) {
      destNode.ele('ruta').txt(dest.ruta).up();
    }
    if (dest.codDocSustento) {
      destNode.ele('codDocSustento').txt(dest.codDocSustento).up();
    }
    if (dest.numDocSustento) {
      destNode.ele('numDocSustento').txt(dest.numDocSustento).up();
    }
    if (dest.numAutDocSustento) {
      destNode.ele('numAutDocSustento').txt(dest.numAutDocSustento).up();
    }
    if (dest.fechaEmisionDocSustento) {
      destNode.ele('fechaEmisionDocSustento').txt(dest.fechaEmisionDocSustento).up();
    }

    const detallesNode = destNode.ele('detalles');
    for (const det of dest.detalles) {
      const d = det.detalle;
      const detalleNode = detallesNode.ele('detalle');
      if (d.codigoInterno) {
        detalleNode.ele('codigoInterno').txt(d.codigoInterno).up();
      }
      if (d.codigoAdicional) {
        detalleNode.ele('codigoAdicional').txt(d.codigoAdicional).up();
      }
      detalleNode.ele('descripcion').txt(d.descripcion).up().ele('cantidad').txt(d.cantidad).up();
    }
  }

  return doc.end({ prettyPrint: true });
}

/**
 * Genera un documento XML para un comprobante de retención electrónico según el
 * formato ATS v2.0.0 (Anexo 10 de la Ficha Técnica del SRI, codDoc 07).
 * Los bloques condicionales de reembolsos, dividendos y compra de cajas de
 * banano no están incluidos en esta versión inicial.
 * @param retencion Datos del comprobante de retención
 * @param empresa Empresa emisora
 * @param claveAcceso Clave de acceso generada
 * @param secuencial Número secuencial del comprobante
 * @returns XML del comprobante de retención como string
 */
export function generarXMLRetencion(
  retencion: WithholdingRequest,
  empresa: IIssuingCompany,
  claveAcceso: string,
  secuencial: string,
): string {
  const info = retencion.infoCompRetencion;

  const infoNode = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('comprobanteRetencion', {
      id: 'comprobante',
      version: '2.0.0',
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
    .txt('07')
    .up() // comprobante de retención
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
    .ele('infoCompRetencion')
    .ele('fechaEmision')
    .txt(info.fechaEmision)
    .up()
    .ele('dirEstablecimiento')
    .txt(empresa.direccion_establecimiento || empresa.direccion || 'Dirección no especificada')
    .up()
    .ele('obligadoContabilidad')
    .txt(empresa.obligado_contabilidad ? 'SI' : 'NO')
    .up()
    .ele('tipoIdentificacionSujetoRetenido')
    .txt(info.tipoIdentificacionSujetoRetenido)
    .up();

  if (info.tipoSujetoRetenido) {
    infoNode.ele('tipoSujetoRetenido').txt(info.tipoSujetoRetenido).up();
  }
  // <parteRel> es obligatorio en el esquema de retención ATS 2.0.0 (SI/NO).
  // Si no se envía en el request se emite 'NO' por defecto, de lo contrario el SRI
  // devuelve el comprobante con error 35: ARCHIVO NO CUMPLE ESTRUCTURA XML.
  infoNode
    .ele('parteRel')
    .txt(info.parteRel || 'NO')
    .up();

  const docsSustentoNode = infoNode
    .ele('razonSocialSujetoRetenido')
    .txt(info.razonSocialSujetoRetenido)
    .up()
    .ele('identificacionSujetoRetenido')
    .txt(info.identificacionSujetoRetenido)
    .up()
    .ele('periodoFiscal')
    .txt(info.periodoFiscal)
    .up()
    .up() // salir de <infoCompRetencion>
    .ele('docsSustento');

  // Cursor tracking: xmlbuilder2 returns a new node reference on each call,
  // so nested loops must build from an explicitly captured parent node
  for (const item of retencion.docsSustento) {
    const ds = item.docSustento;
    const docSustentoNode = docsSustentoNode
      .ele('docSustento')
      .ele('codSustento')
      .txt(ds.codSustento)
      .up()
      .ele('codDocSustento')
      .txt(ds.codDocSustento)
      .up();

    if (ds.numDocSustento) {
      docSustentoNode.ele('numDocSustento').txt(ds.numDocSustento).up();
    }

    docSustentoNode.ele('fechaEmisionDocSustento').txt(ds.fechaEmisionDocSustento).up();

    if (ds.fechaRegistroContable) {
      docSustentoNode.ele('fechaRegistroContable').txt(ds.fechaRegistroContable).up();
    }
    if (ds.numAutDocSustento) {
      docSustentoNode.ele('numAutDocSustento').txt(ds.numAutDocSustento).up();
    }

    docSustentoNode
      .ele('pagoLocExt')
      .txt(ds.pagoLocExt)
      .up()
      .ele('totalSinImpuestos')
      .txt(ds.totalSinImpuestos)
      .up()
      .ele('importeTotal')
      .txt(ds.importeTotal)
      .up();

    const impuestosNode = docSustentoNode.ele('impuestosDocSustento');
    for (const imp of ds.impuestosDocSustento) {
      const impuesto = imp.impuestoDocSustento;
      impuestosNode
        .ele('impuestoDocSustento')
        .ele('codImpuestoDocSustento')
        .txt(impuesto.codImpuestoDocSustento)
        .up()
        .ele('codigoPorcentaje')
        .txt(impuesto.codigoPorcentaje)
        .up()
        .ele('baseImponible')
        .txt(impuesto.baseImponible)
        .up()
        .ele('tarifa')
        .txt(impuesto.tarifa)
        .up()
        .ele('valorImpuesto')
        .txt(impuesto.valorImpuesto)
        .up()
        .up();
    }

    const retencionesNode = docSustentoNode.ele('retenciones');
    for (const ret of ds.retenciones) {
      const r = ret.retencion;
      retencionesNode
        .ele('retencion')
        .ele('codigo')
        .txt(r.codigo)
        .up()
        .ele('codigoRetencion')
        .txt(r.codigoRetencion)
        .up()
        .ele('baseImponible')
        .txt(r.baseImponible)
        .up()
        .ele('porcentajeRetener')
        .txt(r.porcentajeRetener)
        .up()
        .ele('valorRetenido')
        .txt(r.valorRetenido)
        .up()
        .up();
    }

    const pagosNode = docSustentoNode.ele('pagos');
    for (const pg of ds.pagos) {
      // El ejemplo del Anexo 10 muestra <formapago> en minúscula, pero es un error de la
      // ficha técnica: el XSD del SRI exige <formaPago> (error 35 si se envía en minúscula)
      pagosNode.ele('pago').ele('formaPago').txt(pg.pago.formaPago).up().ele('total').txt(pg.pago.total).up().up();
    }
  }

  return docsSustentoNode.end({ prettyPrint: true });
}
