import { IssuerRecord, RidePublisher } from '../../../application/ports/repositories';
import { MODIFIABLE_DOCUMENT_TYPES } from '../domain/DebitNote';
import { PAYMENT_METHODS } from '../../../domain/invoice/catalogs';
import { formatMoney } from '../../../domain/shared/money';
import { DocumentRidePublisher } from '../../../infrastructure/ride/DocumentRidePublisher';
import { DocumentModuleDeps } from '../../types';
import { accessKeyBarcodeSvg, escapeHtml } from '../../../utils/pdf.utils';
import { DebitNoteRecord } from '../application/DebitNoteRecord';

export interface DebitNoteRideData {
  document: DebitNoteRecord;
  issuer: IssuerRecord;
}

function formatDateTime(date: Date | undefined): string {
  if (!date) return '';
  const ec = new Date(new Date(date).getTime() - 5 * 3600 * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${pad(ec.getUTCDate())}/${pad(ec.getUTCMonth() + 1)}/${ec.getUTCFullYear()} ` +
    `${pad(ec.getUTCHours())}:${pad(ec.getUTCMinutes())}:${pad(ec.getUTCSeconds())}`
  );
}

/** Fechas de día civil: se guardan a medianoche UTC, no se desplazan a UTC-5. */
function formatDay(date: Date | undefined): string {
  if (!date) return '';
  const d = new Date(date);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

/** HTML del RIDE de la nota de débito (función pura; todo dato de usuario va escapado). */
export function renderDebitNoteRideHtml({ document: nd, issuer }: DebitNoteRideData): string {
  const e = escapeHtml;
  const i = issuer.issuer;
  const taxRows = nd.taxes
    .map(
      (t) =>
        `<tr><td class="label">SUBTOTAL ${e(t.rate)}%</td><td class="amount">$${formatMoney(t.base)}</td></tr>` +
        `<tr><td class="label">IVA ${e(t.rate)}%</td><td class="amount">$${formatMoney(t.value)}</td></tr>`,
    )
    .join('');
  const paymentRows = nd.payments
    .map(
      (p) =>
        `<tr><td>${e(PAYMENT_METHODS[p.method] ?? p.method)}</td><td class="amount">$${formatMoney(p.amount)}</td></tr>`,
    )
    .join('');
  const modifiedLabel = MODIFIABLE_DOCUMENT_TYPES[nd.modifiedDocument.type] ?? nd.modifiedDocument.type;

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Nota de Débito ${e(nd.number)}</title>
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
      <div class="name">NOTA DE DÉBITO</div>
      <div><strong>No.</strong> ${e(nd.number)}</div>
      <div><strong>NÚMERO DE AUTORIZACIÓN</strong></div>
      <div class="key">${e(nd.authorizationNumber ?? nd.accessKey)}</div>
      <div><strong>FECHA Y HORA DE AUTORIZACIÓN:</strong> ${e(formatDateTime(nd.authorizationDate))}</div>
      <div><strong>AMBIENTE:</strong> ${nd.environment === '2' ? 'PRODUCCIÓN' : 'PRUEBAS'}</div>
      <div><strong>EMISIÓN:</strong> NORMAL</div>
      <div><strong>CLAVE DE ACCESO</strong></div>
      <div class="barcode">${accessKeyBarcodeSvg(nd.accessKey)}</div>
      <div class="key">${e(nd.accessKey)}</div>
    </div>
  </div>

  <table>
    <tr><td class="label">Razón Social / Nombres y Apellidos:</td><td>${e(nd.buyer.name)}</td>
        <td class="label">Identificación:</td><td>${e(nd.buyer.id)}</td></tr>
    <tr><td class="label">Fecha Emisión:</td><td>${e(formatDay(nd.emissionDate))}</td>
        <td class="label">Comprobante que se modifica:</td><td>${e(modifiedLabel)} ${e(nd.modifiedDocument.number)}</td></tr>
    <tr><td class="label">Fecha Emisión (Comprobante a modificar):</td><td>${e(formatDay(nd.modifiedDocument.emissionDate))}</td>
        <td></td><td></td></tr>
  </table>

  <table>
    <thead><tr><th>Razón de la modificación</th><th>Valor de la modificación</th></tr></thead>
    <tbody>
      ${nd.reasons.map((r) => `<tr><td>${e(r.reason)}</td><td class="num">${formatMoney(r.value)}</td></tr>`).join('')}
    </tbody>
  </table>

  <div class="bottom">
    <div>
      <table><tr><th colspan="2">Información Adicional</th></tr>
        ${Object.entries(nd.additionalInfo ?? {})
          .map(([name, value]) => `<tr><td class="label">${e(name)}</td><td>${e(value)}</td></tr>`)
          .join('')}
      </table>
      <table><tr><th>Forma de pago</th><th>Valor</th></tr>${paymentRows}</table>
    </div>
    <div>
      <table>
        ${taxRows}
        <tr><td class="label">SUBTOTAL SIN IMPUESTOS</td><td class="amount">$${formatMoney(nd.subtotal)}</td></tr>
        <tr><td class="label">VALOR TOTAL</td><td class="amount"><strong>$${formatMoney(nd.total)}</strong></td></tr>
      </table>
    </div>
  </div>
</body></html>`;
}

/** RIDE de notas de débito sobre el publicador genérico (solo tras AUTORIZADO, lo invoca el pipeline). */
export function createDebitNoteRidePublisher(
  ride: DocumentModuleDeps['ride'],
): RidePublisher<DebitNoteRecord> | undefined {
  if (!ride) return undefined;
  return new DocumentRidePublisher<DebitNoteRecord>({
    storage: ride.storage,
    renderPdf: (data) => ride.htmlToPdf(renderDebitNoteRideHtml(data)),
    filePrefix: 'nota_debito',
  });
}
