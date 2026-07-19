import puppeteer from 'puppeteer';
import { IIssuingCompany } from '../models/IssuingCompany';
import { IClient } from '../models/Client';
import { IProduct } from '../models/Product';
import { InvoiceRequest } from '../interfaces/invoice.interface';
import { CreditNoteRequest } from '../interfaces/credit-note.interface';
import { DebitNoteRequest } from '../interfaces/debit-note.interface';
import { DeliveryNoteRequest } from '../interfaces/delivery-note.interface';
import { WithholdingRequest } from '../interfaces/withholding.interface';

interface InvoiceData {
  factura: any;
  empresa: IIssuingCompany;
  cliente: IClient;
  productos: IProduct[];
  claveAcceso: string;
  secuencial: string;
  fechaEmision: Date;
  numeroAutorizacion: string;
  fechaAutorizacion: Date;
  /** Título del documento en el RIDE. Por defecto 'FACTURA' */
  tipoDocumento?: string;
  /** Información del documento que se modifica (solo notas de crédito/débito) */
  docModificado?: {
    tipo: string;
    numero: string;
    fechaEmision: string;
    motivo: string;
  };
}

export interface CreditNotePDFData {
  notaCredito: CreditNoteRequest;
  empresa: IIssuingCompany;
  cliente: IClient;
  productos: IProduct[];
  claveAcceso: string;
  secuencial: string;
  fechaEmision: Date;
  numeroAutorizacion: string;
  fechaAutorizacion: Date;
}

export interface DebitNotePDFData {
  notaDebito: DebitNoteRequest;
  empresa: IIssuingCompany;
  cliente: IClient;
  claveAcceso: string;
  secuencial: string;
  fechaEmision: Date;
  numeroAutorizacion: string;
  fechaAutorizacion: Date;
}

/**
 * Generates an HTML template for the SRI invoice format
 */
function generateInvoiceHTML(data: InvoiceData): string {
  const {
    factura,
    empresa,
    cliente,
    productos,
    claveAcceso,
    secuencial,
    fechaEmision,
    numeroAutorizacion,
    fechaAutorizacion,
  } = data;

  const tituloDocumento = data.tipoDocumento || 'FACTURA';
  const tarifaIva = process.env.IVA || '15';
  const filasDocModificado = data.docModificado
    ? `
          <tr>
            <td class="label">Comprobante que se modifica</td>
            <td>${data.docModificado.tipo} ${data.docModificado.numero}</td>
            <td class="label">Fecha Emisión (Doc. Sustento)</td>
            <td>${data.docModificado.fechaEmision}</td>
          </tr>
          <tr>
            <td class="label">Razón de Modificación</td>
            <td colspan="3">${data.docModificado.motivo}</td>
          </tr>`
    : '';

  return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Factura Electrónica</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          font-size: 10px;
          margin: 0;
          padding: 10px;
          line-height: 1.2;
        }
        .container {
          max-width: 800px;
          margin: 0 auto;
        }
        .header {
          display: flex;
          border: 1px solid #000;
          margin-bottom: 10px;
        }
        .logo-section {
          width: 200px;
          padding: 10px;
          border-right: 1px solid #000;
          text-align: center;
        }
        .company-info {
          flex: 1;
          padding: 10px;
        }
        .invoice-info {
          width: 200px;
          padding: 10px;
          border-left: 1px solid #000;
        }
        .no-logo {
          color: red;
          font-weight: bold;
          font-size: 14px;
          margin-bottom: 10px;
        }
        .ruc-box {
          border: 2px solid #000;
          padding: 5px;
          margin: 10px 0;
          text-align: center;
          font-weight: bold;
        }
        .access-key-container {
          margin-top: 10px;
          text-align: center;
        }
        .access-key-number {
          font-size: 7px;
          font-family: 'Courier New', monospace;
          margin: 5px 0;
          word-spacing: -1px;
          letter-spacing: 0.5px;
          line-height: 1.2;
          width: 100%;
          overflow-wrap: break-word;
        }
        .info-table {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 10px;
        }
        .info-table td {
          border: 1px solid #000;
          padding: 3px 5px;
          font-size: 9px;
        }
        .label {
          background-color: #f0f0f0;
          font-weight: bold;
          width: 120px;
        }
        .details-table {
          width: 100%;
          border-collapse: collapse;
          margin: 10px 0;
        }
        .details-table th,
        .details-table td {
          border: 1px solid #000;
          padding: 3px 5px;
          text-align: center;
          font-size: 8px;
        }
        .details-table th {
          background-color: #f0f0f0;
          font-weight: bold;
        }
        .text-left {
          text-align: left !important;
        }
        .text-right {
          text-align: right !important;
        }
        .totals-section {
          margin-top: 10px;
        }
        .totals-table {
          width: 300px;
          margin-left: auto;
          border-collapse: collapse;
        }
        .totals-table td {
          border: 1px solid #000;
          padding: 3px 5px;
          font-size: 9px;
        }
        .amount {
          text-align: right;
          font-weight: bold;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <!-- Header Section -->
        <div class="header">
          <div class="logo-section">
            <div class="no-logo">NO TIENE LOGO</div>
          </div>
          
          <div class="company-info">
            <div style="text-align: center; font-weight: bold; margin-bottom: 10px;">
              ${empresa.razon_social}
            </div>
            <div><strong>Dirección Matriz:</strong> ${empresa.direccion_matriz}</div>
            <div><strong>Dirección Sucursal:</strong> ${empresa.direccion_establecimiento}</div>
            <div><strong>Contribuyente Especial Nro:</strong> ${empresa.contribuyente_especial || 'N/A'}</div>
            <div><strong>OBLIGADO A LLEVAR CONTABILIDAD:</strong> ${empresa.obligado_contabilidad ? 'SI' : 'NO'}</div>
          </div>
          
          <div class="invoice-info">
            <div class="ruc-box">
              R.U.C.: ${empresa.ruc}
            </div>
            <div style="text-align: center; font-weight: bold; margin: 10px 0;">
              ${tituloDocumento}
            </div>
            <div><strong>No.:</strong> ${empresa.codigo_establecimiento}-${empresa.punto_emision}-${secuencial}</div>
            <div style="margin: 10px 0;">
              <div><strong>NÚMERO DE AUTORIZACIÓN</strong></div>
              <div style="word-break: break-all; font-size: 8px;">${numeroAutorizacion}</div>
            </div>
            <div><strong>FECHA Y HORA DE AUTORIZACIÓN:</strong></div>
            <div>${fechaAutorizacion.toLocaleDateString('es-EC')} ${fechaAutorizacion.toLocaleTimeString('es-EC')}</div>
            <div style="margin-top: 10px;">
              <div><strong>AMBIENTE:</strong> ${empresa.tipo_ambiente === 1 ? 'PRUEBAS' : 'PRODUCCIÓN'}</div>
              <div><strong>EMISIÓN:</strong> ${empresa.tipo_emision === 1 ? 'NORMAL' : 'CONTINGENCIA'}</div>
            </div>
            <div style="margin-top: 10px;">
              <div><strong>CLAVE DE ACCESO</strong></div>
              <div class="access-key-container">
                <div class="access-key-number">${claveAcceso}</div>
              </div>
            </div>
          </div>
        </div>

        <!-- Client Information -->
        <table class="info-table">
          <tr>
            <td class="label">Razón Social / Nombres y Apellidos</td>
            <td colspan="3">${cliente.razon_social}</td>
          </tr>
          <tr>
            <td class="label">Identificación</td>
            <td>${cliente.identificacion}</td>
            <td class="label">Fecha Emisión</td>
            <td>${fechaEmision.toLocaleDateString('es-EC')}</td>
          </tr>
          <tr>
            <td class="label">Dirección</td>
            <td colspan="3">${cliente.direccion || 'N/A'}</td>
          </tr>${filasDocModificado}
        </table>

        <!-- Invoice Details -->
        <table class="details-table">
          <thead>
            <tr>
              <th style="width: 80px;">Cant.</th>
              <th style="width: 80px;">Unidad</th>
              <th>Descripción</th>
              <th style="width: 100px;">Detalle Adicional</th>
              <th style="width: 80px;">Precio Unitario</th>
              <th style="width: 80px;">Descuento</th>
              <th style="width: 80px;">Precio Total</th>
            </tr>
          </thead>
          <tbody>
            ${factura.detalles
              .map((item: any, index: number) => {
                const det = item.detalle;
                const producto = productos[index];
                return `
                <tr>
                  <td>${det.cantidad}</td>
                  <td>Und</td>
                  <td class="text-left">${det.descripcion}</td>
                  <td class="text-left">${producto.descripcion_adicional || ''}</td>
                  <td class="text-right">$${parseFloat(det.precioUnitario).toFixed(2)}</td>
                  <td class="text-right">$0.00</td>
                  <td class="text-right">$${parseFloat(det.precioTotalSinImpuesto).toFixed(2)}</td>
                </tr>
              `;
              })
              .join('')}
          </tbody>
        </table>

        <!-- Payment Information -->
        <table class="info-table" style="margin-top: 10px;">
          <tr>
            <td class="label">Forma de pago</td>
            <td>EFECTIVO</td>
            <td class="label">Valor</td>
            <td>$${parseFloat(factura.infoFactura.importeTotal).toFixed(2)}</td>
          </tr>
        </table>

        <!-- Totals -->
        <div class="totals-section">
          <table class="totals-table">
            <tr>
              <td class="label">SUBTOTAL ${tarifaIva}%</td>
              <td class="amount">$${parseFloat(factura.infoFactura.totalSinImpuestos).toFixed(2)}</td>
            </tr>
            <tr>
              <td class="label">SUBTOTAL EXENTO IVA</td>
              <td class="amount">$0.00</td>
            </tr>
            <tr>
              <td class="label">SUBTOTAL SIN IMPUESTOS</td>
              <td class="amount">$${parseFloat(factura.infoFactura.totalSinImpuestos).toFixed(2)}</td>
            </tr>
            <tr>
              <td class="label">TOTAL DESCUENTO</td>
              <td class="amount">$0.00</td>
            </tr>
            <tr>
              <td class="label">ICE</td>
              <td class="amount">$0.00</td>
            </tr>
            <tr>
              <td class="label">IVA ${tarifaIva}%</td>
              <td class="amount">$${(parseFloat(factura.infoFactura.importeTotal) - parseFloat(factura.infoFactura.totalSinImpuestos)).toFixed(2)}</td>
            </tr>
            <tr>
              <td class="label">IRBPNR</td>
              <td class="amount">$0.00</td>
            </tr>
            <tr>
              <td class="label">PROPINA</td>
              <td class="amount">$0.00</td>
            </tr>
            <tr style="border-top: 2px solid #000;">
              <td class="label" style="font-weight: bold;">VALOR TOTAL</td>
              <td class="amount" style="font-weight: bold; font-size: 11px;">$${parseFloat(factura.infoFactura.importeTotal).toFixed(2)}</td>
            </tr>
          </tbody>
        </table>

        <!-- Additional Information -->
        <div style="margin-top: 15px; font-size: 8px;">
          <div><strong>Información Adicional:</strong></div>
          <div>Email: ${cliente.email || 'N/A'}</div>
          <div>Teléfono: ${cliente.telefono || 'N/A'}</div>
        </div>
      </div>
    </body>
    </html>
  `;
}

/**
 * Generates a PDF buffer from invoice data
 */
export async function generateInvoicePDF(invoiceData: InvoiceData): Promise<Buffer> {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();

    // Set page format for invoice
    await page.setViewport({ width: 800, height: 1200 });

    // Generate HTML content
    const htmlContent = generateInvoiceHTML(invoiceData);

    // Set HTML content
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });

    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm',
      },
      printBackground: true,
    });

    return Buffer.from(pdfBuffer);
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw new Error(`Failed to generate PDF: ${(error as Error).message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Generates a PDF buffer for a credit note (RIDE) reusing the shared document template
 */
export async function generateCreditNotePDF(data: CreditNotePDFData): Promise<Buffer> {
  const info = data.notaCredito.infoNotaCredito;

  // Map the credit note into the shared document template shape
  const invoiceShapedData: InvoiceData = {
    factura: {
      infoFactura: {
        totalSinImpuestos: info.totalSinImpuestos,
        importeTotal: info.valorModificacion,
      },
      detalles: data.notaCredito.detalles.map((item) => ({
        detalle: {
          codigoPrincipal: item.detalle.codigoInterno,
          descripcion: item.detalle.descripcion,
          cantidad: item.detalle.cantidad,
          precioUnitario: item.detalle.precioUnitario,
          precioTotalSinImpuesto: item.detalle.precioTotalSinImpuesto,
          impuestos: item.detalle.impuestos,
        },
      })),
    },
    empresa: data.empresa,
    cliente: data.cliente,
    productos: data.productos,
    claveAcceso: data.claveAcceso,
    secuencial: data.secuencial,
    fechaEmision: data.fechaEmision,
    numeroAutorizacion: data.numeroAutorizacion,
    fechaAutorizacion: data.fechaAutorizacion,
    tipoDocumento: 'NOTA DE CRÉDITO',
    docModificado: {
      tipo: info.codDocModificado === '01' ? 'FACTURA' : info.codDocModificado,
      numero: info.numDocModificado,
      fechaEmision: info.fechaEmisionDocSustento,
      motivo: info.motivo,
    },
  };

  return generateInvoicePDF(invoiceShapedData);
}

/**
 * Generates a PDF buffer for a debit note (RIDE) reusing the shared document template.
 * The motivos (surcharges) are rendered as the document line items.
 */
export async function generateDebitNotePDF(data: DebitNotePDFData): Promise<Buffer> {
  const info = data.notaDebito.infoNotaDebito;
  const motivoPrincipal = data.notaDebito.motivos[0]?.motivo.razon || '';

  const invoiceShapedData: InvoiceData = {
    factura: {
      infoFactura: {
        totalSinImpuestos: info.totalSinImpuestos,
        importeTotal: info.valorTotal,
      },
      detalles: data.notaDebito.motivos.map((item) => ({
        detalle: {
          codigoPrincipal: '',
          descripcion: item.motivo.razon,
          cantidad: '1',
          precioUnitario: item.motivo.valor,
          precioTotalSinImpuesto: item.motivo.valor,
          impuestos: info.impuestos,
        },
      })),
    },
    empresa: data.empresa,
    cliente: data.cliente,
    productos: data.notaDebito.motivos.map(() => ({}) as IProduct),
    claveAcceso: data.claveAcceso,
    secuencial: data.secuencial,
    fechaEmision: data.fechaEmision,
    numeroAutorizacion: data.numeroAutorizacion,
    fechaAutorizacion: data.fechaAutorizacion,
    tipoDocumento: 'NOTA DE DÉBITO',
    docModificado: {
      tipo: info.codDocModificado === '01' ? 'FACTURA' : info.codDocModificado,
      numero: info.numDocModificado,
      fechaEmision: info.fechaEmisionDocSustento,
      motivo: motivoPrincipal,
    },
  };

  return generateInvoicePDF(invoiceShapedData);
}

export interface DeliveryNotePDFData {
  guiaRemision: DeliveryNoteRequest;
  empresa: IIssuingCompany;
  claveAcceso: string;
  secuencial: string;
  fechaEmision: Date;
  numeroAutorizacion: string;
  fechaAutorizacion: Date;
}

/**
 * Generates an HTML template for the delivery note (guía de remisión) RIDE.
 * Unlike the other documents it has no monetary values: it describes the
 * transport and the recipients of the transferred goods.
 */
function generateDeliveryNoteHTML(data: DeliveryNotePDFData): string {
  const { guiaRemision, empresa, claveAcceso, secuencial, numeroAutorizacion, fechaAutorizacion } = data;
  const info = guiaRemision.infoGuiaRemision;

  const destinatariosHTML = guiaRemision.destinatarios
    .map((item) => {
      const dest = item.destinatario;
      const detallesHTML = dest.detalles
        .map(
          (det) => `
            <tr>
              <td>${det.detalle.codigoInterno || ''}</td>
              <td class="text-left">${det.detalle.descripcion}</td>
              <td class="text-right">${det.detalle.cantidad}</td>
            </tr>`,
        )
        .join('');

      return `
        <table class="info-table">
          <tr>
            <td class="label">Destinatario</td>
            <td>${dest.razonSocialDestinatario}</td>
            <td class="label">Identificación</td>
            <td>${dest.identificacionDestinatario}</td>
          </tr>
          <tr>
            <td class="label">Dirección Destino</td>
            <td colspan="3">${dest.dirDestinatario}</td>
          </tr>
          <tr>
            <td class="label">Motivo Traslado</td>
            <td>${dest.motivoTraslado}</td>
            <td class="label">Ruta</td>
            <td>${dest.ruta || 'N/A'}</td>
          </tr>
          ${
            dest.numDocSustento
              ? `<tr>
            <td class="label">Doc. Sustento</td>
            <td>${dest.codDocSustento === '01' ? 'FACTURA' : dest.codDocSustento || ''} ${dest.numDocSustento}</td>
            <td class="label">Fecha Emisión Doc. Sustento</td>
            <td>${dest.fechaEmisionDocSustento || 'N/A'}</td>
          </tr>`
              : ''
          }
        </table>
        <table class="details-table">
          <thead>
            <tr>
              <th style="width: 120px;">Código</th>
              <th>Descripción</th>
              <th style="width: 100px;">Cantidad</th>
            </tr>
          </thead>
          <tbody>${detallesHTML}
          </tbody>
        </table>`;
    })
    .join('');

  return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Guía de Remisión Electrónica</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 10px; margin: 0; padding: 10px; line-height: 1.2; }
        .container { max-width: 800px; margin: 0 auto; }
        .header { display: flex; border: 1px solid #000; margin-bottom: 10px; }
        .logo-section { width: 200px; padding: 10px; border-right: 1px solid #000; text-align: center; }
        .company-info { flex: 1; padding: 10px; }
        .document-info { width: 200px; padding: 10px; border-left: 1px solid #000; }
        .no-logo { color: red; font-weight: bold; font-size: 14px; margin-bottom: 10px; }
        .ruc-box { border: 2px solid #000; padding: 5px; margin: 10px 0; text-align: center; font-weight: bold; }
        .access-key-number { font-size: 7px; font-family: 'Courier New', monospace; margin: 5px 0; word-spacing: -1px; letter-spacing: 0.5px; line-height: 1.2; width: 100%; overflow-wrap: break-word; }
        .info-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
        .info-table td { border: 1px solid #000; padding: 3px 5px; font-size: 9px; }
        .label { background-color: #f0f0f0; font-weight: bold; width: 140px; }
        .details-table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        .details-table th, .details-table td { border: 1px solid #000; padding: 3px 5px; text-align: center; font-size: 8px; }
        .details-table th { background-color: #f0f0f0; font-weight: bold; }
        .text-left { text-align: left !important; }
        .text-right { text-align: right !important; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo-section">
            <div class="no-logo">NO TIENE LOGO</div>
          </div>
          <div class="company-info">
            <div style="text-align: center; font-weight: bold; margin-bottom: 10px;">
              ${empresa.razon_social}
            </div>
            <div><strong>Dirección Matriz:</strong> ${empresa.direccion_matriz}</div>
            <div><strong>Dirección Sucursal:</strong> ${empresa.direccion_establecimiento}</div>
            <div><strong>OBLIGADO A LLEVAR CONTABILIDAD:</strong> ${empresa.obligado_contabilidad ? 'SI' : 'NO'}</div>
          </div>
          <div class="document-info">
            <div class="ruc-box">R.U.C.: ${empresa.ruc}</div>
            <div style="text-align: center; font-weight: bold; margin: 10px 0;">GUÍA DE REMISIÓN</div>
            <div><strong>No.:</strong> ${empresa.codigo_establecimiento}-${empresa.punto_emision}-${secuencial}</div>
            <div style="margin: 10px 0;">
              <div><strong>NÚMERO DE AUTORIZACIÓN</strong></div>
              <div style="word-break: break-all; font-size: 8px;">${numeroAutorizacion}</div>
            </div>
            <div><strong>FECHA Y HORA DE AUTORIZACIÓN:</strong></div>
            <div>${fechaAutorizacion.toLocaleDateString('es-EC')} ${fechaAutorizacion.toLocaleTimeString('es-EC')}</div>
            <div style="margin-top: 10px;">
              <div><strong>AMBIENTE:</strong> ${empresa.tipo_ambiente === 1 ? 'PRUEBAS' : 'PRODUCCIÓN'}</div>
              <div><strong>EMISIÓN:</strong> ${empresa.tipo_emision === 1 ? 'NORMAL' : 'CONTINGENCIA'}</div>
            </div>
            <div style="margin-top: 10px;">
              <div><strong>CLAVE DE ACCESO</strong></div>
              <div class="access-key-number">${claveAcceso}</div>
            </div>
          </div>
        </div>

        <table class="info-table">
          <tr>
            <td class="label">Dirección de Partida</td>
            <td colspan="3">${info.dirPartida}</td>
          </tr>
          <tr>
            <td class="label">Transportista</td>
            <td>${info.razonSocialTransportista}</td>
            <td class="label">Identificación</td>
            <td>${info.rucTransportista}</td>
          </tr>
          <tr>
            <td class="label">Placa</td>
            <td>${info.placa}</td>
            <td class="label">Fecha Inicio / Fin Transporte</td>
            <td>${info.fechaIniTransporte} - ${info.fechaFinTransporte}</td>
          </tr>
        </table>

        ${destinatariosHTML}
      </div>
    </body>
    </html>
  `;
}

/**
 * Generates a PDF buffer for a delivery note (guía de remisión) RIDE
 */
export async function generateDeliveryNotePDF(data: DeliveryNotePDFData): Promise<Buffer> {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 1200 });
    await page.setContent(generateDeliveryNoteHTML(data), { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
      printBackground: true,
    });

    return Buffer.from(pdfBuffer);
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw new Error(`Failed to generate PDF: ${(error as Error).message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

export interface WithholdingPDFData {
  retencion: WithholdingRequest;
  empresa: IIssuingCompany;
  claveAcceso: string;
  secuencial: string;
  fechaEmision: Date;
  numeroAutorizacion: string;
  fechaAutorizacion: Date;
}

/**
 * Generates an HTML template for the withholding certificate RIDE
 * (printed format of version 1.0.0, as indicated in Anexo 10)
 */
function generateWithholdingHTML(data: WithholdingPDFData): string {
  const { retencion, empresa, claveAcceso, secuencial, numeroAutorizacion, fechaAutorizacion } = data;
  const info = retencion.infoCompRetencion;

  const IMPUESTOS: Record<string, string> = { '1': 'RENTA', '2': 'IVA', '6': 'ISD' };

  const filasRetenciones = retencion.docsSustento
    .flatMap((item) => {
      const ds = item.docSustento;
      const docLabel = `${ds.codDocSustento === '01' ? 'FACTURA' : ds.codDocSustento} ${ds.numDocSustento || ''}`;
      return ds.retenciones.map(
        (ret) => `
            <tr>
              <td>${docLabel}</td>
              <td>${ds.fechaEmisionDocSustento}</td>
              <td>${IMPUESTOS[ret.retencion.codigo] || ret.retencion.codigo}</td>
              <td>${ret.retencion.codigoRetencion}</td>
              <td class="text-right">$${parseFloat(ret.retencion.baseImponible).toFixed(2)}</td>
              <td class="text-right">${ret.retencion.porcentajeRetener}%</td>
              <td class="text-right">$${parseFloat(ret.retencion.valorRetenido).toFixed(2)}</td>
            </tr>`,
      );
    })
    .join('');

  const totalRetenido = retencion.docsSustento
    .flatMap((item) => item.docSustento.retenciones)
    .reduce((s, r) => s + parseFloat(r.retencion.valorRetenido), 0)
    .toFixed(2);

  return `
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Comprobante de Retención Electrónico</title>
      <style>
        body { font-family: Arial, sans-serif; font-size: 10px; margin: 0; padding: 10px; line-height: 1.2; }
        .container { max-width: 800px; margin: 0 auto; }
        .header { display: flex; border: 1px solid #000; margin-bottom: 10px; }
        .logo-section { width: 200px; padding: 10px; border-right: 1px solid #000; text-align: center; }
        .company-info { flex: 1; padding: 10px; }
        .document-info { width: 200px; padding: 10px; border-left: 1px solid #000; }
        .no-logo { color: red; font-weight: bold; font-size: 14px; margin-bottom: 10px; }
        .ruc-box { border: 2px solid #000; padding: 5px; margin: 10px 0; text-align: center; font-weight: bold; }
        .access-key-number { font-size: 7px; font-family: 'Courier New', monospace; margin: 5px 0; word-spacing: -1px; letter-spacing: 0.5px; line-height: 1.2; width: 100%; overflow-wrap: break-word; }
        .info-table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
        .info-table td { border: 1px solid #000; padding: 3px 5px; font-size: 9px; }
        .label { background-color: #f0f0f0; font-weight: bold; width: 140px; }
        .details-table { width: 100%; border-collapse: collapse; margin: 10px 0; }
        .details-table th, .details-table td { border: 1px solid #000; padding: 3px 5px; text-align: center; font-size: 8px; }
        .details-table th { background-color: #f0f0f0; font-weight: bold; }
        .text-right { text-align: right !important; }
        .totals-table { width: 300px; margin-left: auto; border-collapse: collapse; }
        .totals-table td { border: 1px solid #000; padding: 3px 5px; font-size: 9px; }
        .amount { text-align: right; font-weight: bold; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo-section">
            <div class="no-logo">NO TIENE LOGO</div>
          </div>
          <div class="company-info">
            <div style="text-align: center; font-weight: bold; margin-bottom: 10px;">
              ${empresa.razon_social}
            </div>
            <div><strong>Dirección Matriz:</strong> ${empresa.direccion_matriz}</div>
            <div><strong>Dirección Sucursal:</strong> ${empresa.direccion_establecimiento}</div>
            <div><strong>OBLIGADO A LLEVAR CONTABILIDAD:</strong> ${empresa.obligado_contabilidad ? 'SI' : 'NO'}</div>
          </div>
          <div class="document-info">
            <div class="ruc-box">R.U.C.: ${empresa.ruc}</div>
            <div style="text-align: center; font-weight: bold; margin: 10px 0;">COMPROBANTE DE RETENCIÓN</div>
            <div><strong>No.:</strong> ${empresa.codigo_establecimiento}-${empresa.punto_emision}-${secuencial}</div>
            <div style="margin: 10px 0;">
              <div><strong>NÚMERO DE AUTORIZACIÓN</strong></div>
              <div style="word-break: break-all; font-size: 8px;">${numeroAutorizacion}</div>
            </div>
            <div><strong>FECHA Y HORA DE AUTORIZACIÓN:</strong></div>
            <div>${fechaAutorizacion.toLocaleDateString('es-EC')} ${fechaAutorizacion.toLocaleTimeString('es-EC')}</div>
            <div style="margin-top: 10px;">
              <div><strong>AMBIENTE:</strong> ${empresa.tipo_ambiente === 1 ? 'PRUEBAS' : 'PRODUCCIÓN'}</div>
              <div><strong>EMISIÓN:</strong> ${empresa.tipo_emision === 1 ? 'NORMAL' : 'CONTINGENCIA'}</div>
            </div>
            <div style="margin-top: 10px;">
              <div><strong>CLAVE DE ACCESO</strong></div>
              <div class="access-key-number">${claveAcceso}</div>
            </div>
          </div>
        </div>

        <table class="info-table">
          <tr>
            <td class="label">Razón Social Sujeto Retenido</td>
            <td>${info.razonSocialSujetoRetenido}</td>
            <td class="label">Identificación</td>
            <td>${info.identificacionSujetoRetenido}</td>
          </tr>
          <tr>
            <td class="label">Fecha Emisión</td>
            <td>${info.fechaEmision}</td>
            <td class="label">Período Fiscal</td>
            <td>${info.periodoFiscal}</td>
          </tr>
        </table>

        <table class="details-table">
          <thead>
            <tr>
              <th>Comprobante</th>
              <th>Fecha Emisión</th>
              <th>Impuesto</th>
              <th>Código Retención</th>
              <th>Base Imponible</th>
              <th>% Retención</th>
              <th>Valor Retenido</th>
            </tr>
          </thead>
          <tbody>${filasRetenciones}
          </tbody>
        </table>

        <table class="totals-table">
          <tr>
            <td class="label" style="font-weight: bold;">TOTAL RETENIDO</td>
            <td class="amount" style="font-size: 11px;">$${totalRetenido}</td>
          </tr>
        </table>
      </div>
    </body>
    </html>
  `;
}

/**
 * Generates a PDF buffer for a withholding certificate RIDE
 */
export async function generateWithholdingPDF(data: WithholdingPDFData): Promise<Buffer> {
  let browser;

  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 1200 });
    await page.setContent(generateWithholdingHTML(data), { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
      printBackground: true,
    });

    return Buffer.from(pdfBuffer);
  } catch (error) {
    console.error('Error generating PDF:', error);
    throw new Error(`Failed to generate PDF: ${(error as Error).message}`);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

/**
 * Saves PDF to file system
 */
export async function savePDFToFile(pdfBuffer: Buffer, filename: string): Promise<string> {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');

  const tempDir = os.tmpdir();
  const filePath = path.join(tempDir, `${filename}.pdf`);

  fs.writeFileSync(filePath, pdfBuffer);

  return filePath;
}
