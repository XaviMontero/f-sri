import { IssuerRecord } from '../../../application/ports/repositories';
import { ivaRate } from '../../../domain/invoice/catalogs';
import { formatDecimal, formatMoney } from '../../../domain/shared/money';
import { accessKeyBarcodeSvg, escapeHtml } from '../../../utils/pdf.utils';
import { CreditNoteRecord } from '../application/IssueCreditNote';
import { MODIFIABLE_DOCUMENTS } from '../domain/CreditNote';

export interface CreditNoteRideData {
  document: CreditNoteRecord;
  issuer: IssuerRecord;
}

/** Fecha y hora de autorización en Ecuador (UTC-5). */
function formatDateTime(date: Date | undefined): string {
  if (!date) return '';
  const ec = new Date(new Date(date).getTime() - 5 * 3600 * 1000);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(ec.getUTCDate())}/${p(ec.getUTCMonth() + 1)}/${ec.getUTCFullYear()} ${p(ec.getUTCHours())}:${p(ec.getUTCMinutes())}:${p(ec.getUTCSeconds())}`;
}

/** Fechas de emisión: se guardan a medianoche UTC del día civil. */
function formatDay(date: Date | undefined): string {
  if (!date) return '';
  const d = new Date(date);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
}

function rateLabel(code: string): string {
  try {
    const rate = ivaRate(code);
    return rate.rate > 0 ? `${rate.rate}%` : rate.label.toUpperCase().replace('IVA ', '');
  } catch {
    return code;
  }
}

/**
 * HTML del RIDE de la nota de crédito, con el mismo estilo que el de la factura. Función pura
 * (se prueba sin Chromium); todo dato del cliente pasa por {@link escapeHtml}.
 */
export function renderCreditNoteRideHtml({ document: nc, issuer }: CreditNoteRideData): string {
  const e = escapeHtml;
  const i = issuer.issuer;
  const subtotalRows = nc.taxes
    .map(
      (t) =>
        `<tr><td class="label">SUBTOTAL ${e(rateLabel(t.ivaCode))}</td><td class="amount">$${formatMoney(t.base)}</td></tr>`,
    )
    .join('');
  const discount = nc.lines.reduce((sum, l) => sum + (l.discount ?? 0), 0);
  const modifiedLabel = MODIFIABLE_DOCUMENTS[nc.modifiedDocument.type] ?? nc.modifiedDocument.type;

  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><title>Nota de crédito ${e(nc.number)}</title>
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
      <div class="name">NOTA DE CRÉDITO</div>
      <div><strong>No.</strong> ${e(nc.number)}</div>
      <div><strong>NÚMERO DE AUTORIZACIÓN</strong></div>
      <div class="key">${e(nc.authorizationNumber ?? nc.accessKey)}</div>
      <div><strong>FECHA Y HORA DE AUTORIZACIÓN:</strong> ${e(formatDateTime(nc.authorizationDate))}</div>
      <div><strong>AMBIENTE:</strong> ${nc.environment === '2' ? 'PRODUCCIÓN' : 'PRUEBAS'}</div>
      <div><strong>EMISIÓN:</strong> NORMAL</div>
      <div><strong>CLAVE DE ACCESO</strong></div>
      <div class="barcode">${accessKeyBarcodeSvg(nc.accessKey)}</div>
      <div class="key">${e(nc.accessKey)}</div>
    </div>
  </div>

  <table>
    <tr><td class="label">Razón Social / Nombres y Apellidos:</td><td>${e(nc.buyer.name)}</td>
        <td class="label">Identificación:</td><td>${e(nc.buyer.id)}</td></tr>
    <tr><td class="label">Fecha Emisión:</td><td colspan="3">${e(formatDay(nc.emissionDate))}</td></tr>
  </table>

  <table>
    <tr><td class="label">Comprobante que se modifica:</td><td>${e(modifiedLabel)}</td>
        <td class="label">Número:</td><td>${e(nc.modifiedDocument.number)}</td></tr>
    <tr><td class="label">Fecha Emisión (Comprobante a modificar):</td><td colspan="3">${e(formatDay(nc.modifiedDocument.emissionDate))}</td></tr>
    <tr><td class="label">Razón de Modificación:</td><td colspan="3">${e(nc.reason)}</td></tr>
  </table>

  <table>
    <thead><tr><th>Cod. Principal</th><th>Cod. Auxiliar</th><th>Cant.</th><th>Descripción</th><th>Precio Unitario</th><th>Descuento</th><th>Precio Total</th></tr></thead>
    <tbody>
      ${nc.lines
        .map(
          (
            l,
          ) => `<tr><td>${e(l.code)}</td><td>${e(l.auxiliaryCode ?? '')}</td><td class="num">${formatDecimal(l.quantity)}</td><td>${e(l.description)}</td>
          <td class="num">${formatDecimal(l.unitPrice)}</td><td class="num">${formatMoney(l.discount ?? 0)}</td><td class="num">${formatMoney(l.subtotal)}</td></tr>`,
        )
        .join('')}
    </tbody>
  </table>

  <div class="bottom">
    <div>
      <table><tr><th colspan="2">Información Adicional</th></tr>
        ${Object.entries(nc.additionalInfo ?? {})
          .map(([name, value]) => `<tr><td class="label">${e(name)}</td><td>${e(value)}</td></tr>`)
          .join('')}
      </table>
    </div>
    <div>
      <table>
        ${subtotalRows}
        <tr><td class="label">SUBTOTAL SIN IMPUESTOS</td><td class="amount">$${formatMoney(nc.subtotal)}</td></tr>
        <tr><td class="label">TOTAL DESCUENTO</td><td class="amount">$${formatMoney(discount)}</td></tr>
        <tr><td class="label">IVA</td><td class="amount">$${formatMoney(nc.totalTax)}</td></tr>
        <tr><td class="label">VALOR TOTAL</td><td class="amount"><strong>$${formatMoney(nc.total)}</strong></td></tr>
      </table>
    </div>
  </div>
</body></html>`;
}
