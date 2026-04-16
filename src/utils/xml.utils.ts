import { create } from 'xmlbuilder2';
import { IIssuingCompany } from '../models/IssuingCompany';
import { IClient } from '../models/Client';
import { IProduct } from '../models/Product';
import { InvoiceRequest } from '../interfaces/invoice.interface';

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
  const doc = create({ version: '1.0', encoding: 'UTF-8' })
    .ele('factura', {
      id: 'comprobante',
      version: '1.0.0',
    })
    .ele('infoTributaria')
    .ele('ambiente')
    .txt(empresa.tipo_ambiente.toString()) // 1=Pruebas, 2=Producción
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
    .txt(process.env.CODIGO_PORCENTAJE || '4')
    .up()
    .ele('baseImponible')
    .txt(factura.infoFactura.totalSinImpuestos)
    .up()
    .ele('valor')
    .txt(productos.reduce((acc, p) => (p.tiene_iva ? acc + 0.12 * p.precio_unitario : acc), 0).toFixed(2))
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
      .txt(process.env.CODIGO_PORCENTAJE || '4')
      .up()
      .ele('tarifa')
      .txt(`${process.env.IVA || '15'}.00`)
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
