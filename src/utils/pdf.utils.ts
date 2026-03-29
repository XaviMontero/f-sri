import puppeteer from 'puppeteer';
import { IIssuingCompany } from '../models/IssuingCompany';
import { IClient } from '../models/Client';
import { IProduct } from '../models/Product';
import { InvoiceRequest } from '../interfaces/invoice.interface';

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
              FACTURA
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
          </tr>
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
              <td class="label">SUBTOTAL ${process.env.IVA}%</td>
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
              <td class="label">IVA ${process.env.IVA}%</td>
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
