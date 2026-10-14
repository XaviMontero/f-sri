import { round2 } from '../shared/money';
import { IvaRate } from './catalogs';
import { InvoiceLine } from './InvoiceLine';

export interface TaxTotal {
  taxCode: string;
  iva: IvaRate;
  base: number;
  value: number;
}

/** Totales de la factura agrupados por tarifa, como los exige `totalConImpuestos`. */
export class InvoiceTotals {
  readonly subtotal: number;
  readonly totalDiscount: number;
  readonly taxes: TaxTotal[];
  readonly totalTax: number;
  readonly tip: number;
  readonly total: number;

  constructor(lines: InvoiceLine[], tip = 0) {
    this.subtotal = round2(lines.reduce((sum, l) => sum + l.subtotal, 0));
    this.totalDiscount = round2(lines.reduce((sum, l) => sum + l.discount, 0));

    const groups = new Map<string, TaxTotal>();
    for (const line of lines) {
      const key = `${line.taxCode}-${line.iva.code}`;
      const group = groups.get(key) ?? { taxCode: line.taxCode, iva: line.iva, base: 0, value: 0 };
      group.base = round2(group.base + line.taxBase);
      group.value = round2(group.value + line.taxValue);
      groups.set(key, group);
    }
    this.taxes = [...groups.values()].sort((a, b) => Number(a.iva.code) - Number(b.iva.code));
    this.totalTax = round2(this.taxes.reduce((sum, t) => sum + t.value, 0));
    this.tip = round2(tip);
    this.total = round2(this.subtotal + this.totalTax + this.tip);
  }

  /** Base imponible de una tarifa concreta (0 si no hay líneas con ella). */
  baseFor(ivaCode: string): number {
    return this.taxes.filter((t) => t.iva.code === ivaCode).reduce((sum, t) => sum + t.base, 0);
  }
}
