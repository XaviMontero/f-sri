import { DOMImplementation, XMLSerializer } from '@xmldom/xmldom';
import JsBarcode from 'jsbarcode';
import { formatDecimal, formatMoney } from '../domain/shared/money';
import { ivaRate, PAYMENT_METHODS } from '../domain/invoice/catalogs';
import { InvoiceRecord, IssuerRecord } from '../application/ports/repositories';

/** Datos necesarios para el RIDE (representación impresa del documento electrónico). */
export interface RideData {
  invoice: InvoiceRecord;
  issuer: IssuerRecord;
}

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escapa texto para HTML: los datos vienen del cliente y se renderizan en Chromium. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);
}

/** Código de barras Code128 de la clave de acceso como SVG inline. */
export function accessKeyBarcodeSvg(accessKey: string): string {
  const document = new DOMImplementation().createDocument('http://www.w3.org/1999/xhtml', 'html', null);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  JsBarcode(svg, accessKey, {
    xmlDocument: document,
    format: 'CODE128',
    displayValue: false,
    height: 40,
    width: 1,
    margin: 0,
  });
  return new XMLSerializer().serializeToString(svg);
}

function formatDate(date: Date | undefined, withTime = false): string {
  if (!date) return '';
  const ec = new Date(new Date(date).getTime() - 5 * 3600 * 1000);
  const d = `${String(ec.getUTCDate()).padStart(2, '0')}/${String(ec.getUTCMonth() + 1).padStart(2, '0')}/${ec.getUTCFullYear()}`;
  if (!withTime) return d;
  return `${d} ${String(ec.getUTCHours()).padStart(2, '0')}:${String(ec.getUTCMinutes()).padStart(2, '0')}:${String(ec.getUTCSeconds()).padStart(2, '0')}`;
}

/** Fecha de emisión: se guarda a medianoche UTC del día civil, no se desplaza a UTC-5. */
function formatEmissionDate(date: Date): string {
  const d = new Date(date);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

/** HTML del RIDE. Función pura para poder probarla sin Chromium. */
export function renderRideHtml({ invoice, issuer }: RideData): string {
  const e = escapeHtml;
  const i = issuer.issuer;
  const subtotalsByRate = new Map<string, number>();
  for (const line of invoice.lines) {
    subtotalsByRate.set(line.ivaCode, (subtotalsByRate.get(line.ivaCode) ?? 0) + line.subtotal);
  }
  const subtotalRows = [...subtotalsByRate.entries()]
    .map(
      ([code, base]) =>
        `<tr><td class="label">SUBTOTAL ${e(rateLabel(code))}</td><td class="amount">$${formatMoney(base)}</td></tr>`,
    )
    .join('');
  const discount = invoice.lines.reduce((sum, l) => sum + (l.discount ?? 0), 0);
  const payments = invoice.payments;
  const paymentRows = (payments?.length ? payments : [{ method: '01', amount: invoice.total }])
    .map(
      (p) =>
        `<tr><td>${e(PAYMENT_METHODS[p.method] ?? p.method)}</td><td class="amount">$${formatMoney(p.amount)}</td></tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Factura ${e(invoice.number)}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 10px; margin: 0; padding: 10px; line-height: 1.25; }
  .header { display: flex; gap: 10px; margin-bottom: 10px; }
  .box { border: 1px solid #000; border-radius: 6px; padding: 8px; }
  .company { flex: 1; }
  .doc { width: 48%; }
  .name { font-weight: bold; font-size: 12px; margin-bottom: 6px; }
  .key { font-family: 'Courier New', monospace; font-size: 9px; word-break: break-all; text-align: center; }
  .barcode svg { width: 100%; height: 40px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  td, th { border: 1px solid #000; padding: 3px 5px; font-size: 9px; }
  th, .label { background: #f0f0f0; font-weight: bold; }
  .amount, .num { text-align: right; }
  .bottom { display: flex; gap: 10px; align-items: flex-start; }
  .bottom > div { flex: 1; }
</style></head>
<body>
  <div class="header">
    <div class="box company">
      <div class="name">${e(i.businessName)}</div>
      ${i.tradeName && i.tradeName !== i.businessName ? `<div>${e(i.tradeName)}</div>` : ''}
      <div><strong>Dirección Matriz:</strong> ${e(i.headOfficeAddress)}</div>
      ${i.establishmentAddress ? `<div><strong>Dirección Sucursal:</strong> ${e(i.establishmentAddress)}</div>` : ''}
      ${i.specialTaxpayer ? `<div><strong>Contribuyente Especial Nro:</strong> ${e(i.specialTaxpayer)}</div>` : ''}
      <div><strong>OBLIGADO A LLEVAR CONTABILIDAD:</strong> ${i.keepsAccounting ? 'SI' : 'NO'}</div>
    </div>
    <div class="box doc">
      <div><strong>R.U.C.:</strong> ${e(i.ruc)}</div>
      <div class="name">FACTURA</div>
      <div><strong>No.</strong> ${e(invoice.number)}</div>
      <div><strong>NÚMERO DE AUTORIZACIÓN</strong></div>
      <div class="key">${e(invoice.authorizationNumber ?? invoice.accessKey)}</div>
      <div><strong>FECHA Y HORA DE AUTORIZACIÓN:</strong> ${e(formatDate(invoice.authorizationDate, true))}</div>
      <div><strong>AMBIENTE:</strong> ${invoice.environment === '2' ? 'PRODUCCIÓN' : 'PRUEBAS'}</div>
      <div><strong>EMISIÓN:</strong> NORMAL</div>
      <div><strong>CLAVE DE ACCESO</strong></div>
      <div class="barcode">${accessKeyBarcodeSvg(invoice.accessKey)}</div>
      <div class="key">${e(invoice.accessKey)}</div>
    </div>
  </div>

  <table>
    <tr><td class="label">Razón Social / Nombres y Apellidos:</td><td>${e(invoice.buyer.name)}</td>
        <td class="label">Identificación:</td><td>${e(invoice.buyer.id)}</td></tr>
    <tr><td class="label">Fecha Emisión:</td><td>${e(formatEmissionDate(invoice.emissionDate))}</td>
        <td class="label">Dirección:</td><td>${e(invoice.buyer.address ?? '')}</td></tr>
  </table>

  <table>
    <thead><tr><th>Cod. Principal</th><th>Cant.</th><th>Descripción</th><th>Precio Unitario</th><th>Descuento</th><th>Precio Total</th></tr></thead>
    <tbody>
      ${invoice.lines
        .map(
          (l) => `<tr><td>${e(l.code)}</td><td class="num">${formatDecimal(l.quantity)}</td><td>${e(l.description)}</td>
          <td class="num">${formatDecimal(l.unitPrice)}</td><td class="num">${formatMoney(l.discount ?? 0)}</td><td class="num">${formatMoney(l.subtotal)}</td></tr>`,
        )
        .join('')}
    </tbody>
  </table>

  <div class="bottom">
    <div>
      <table><tr><th colspan="2">Información Adicional</th></tr>
        ${Object.entries(invoice.additionalInfo ?? {})
          .map(([name, value]) => `<tr><td class="label">${e(name)}</td><td>${e(value)}</td></tr>`)
          .join('')}
      </table>
      <table><tr><th>Forma de pago</th><th>Valor</th></tr>${paymentRows}</table>
    </div>
    <div>
      <table>
        ${subtotalRows}
        <tr><td class="label">SUBTOTAL SIN IMPUESTOS</td><td class="amount">$${formatMoney(invoice.subtotal)}</td></tr>
        <tr><td class="label">TOTAL DESCUENTO</td><td class="amount">$${formatMoney(discount)}</td></tr>
        <tr><td class="label">IVA</td><td class="amount">$${formatMoney(invoice.totalTax)}</td></tr>
        <tr><td class="label">VALOR TOTAL</td><td class="amount"><strong>$${formatMoney(invoice.total)}</strong></td></tr>
      </table>
    </div>
  </div>
</body></html>`;
}

function rateLabel(code: string): string {
  try {
    const rate = ivaRate(code);
    return rate.rate > 0 ? `${rate.rate}%` : rate.label.toUpperCase().replace('IVA ', '');
  } catch {
    return code;
  }
}

type PuppeteerModule = { default: { launch(options: Record<string, unknown>): Promise<any> } };
let puppeteerModule: Promise<PuppeteerModule> | undefined;

/** puppeteer ≥ 25 es solo ESM: con `module: node16` el `import()` dinámico se conserva en CommonJS. */
function loadPuppeteer(): Promise<PuppeteerModule> {
  puppeteerModule ??= import('puppeteer') as unknown as Promise<PuppeteerModule>;
  return puppeteerModule;
}

/** Renderiza HTML a PDF A4 con Chromium headless. */
export async function htmlToPdf(html: string): Promise<Buffer> {
  const { default: puppeteer } = await loadPuppeteer();
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    const pdf = await page.pdf({
      format: 'A4',
      margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
      printBackground: true,
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

/** Genera el PDF del RIDE. */
export async function generateInvoicePDF(data: RideData): Promise<Buffer> {
  return htmlToPdf(renderRideHtml(data));
}
