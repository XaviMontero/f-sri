import { ValidationError } from '../shared/errors';
import { round2, roundTo } from '../shared/money';
import { IVA_TAX_CODE, IvaRate, ivaRate } from './catalogs';

export interface InvoiceLineProps {
  code: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount?: number;
  /** codigoPorcentaje de IVA (tabla 17). */
  ivaCode: string;
  auxiliaryCode?: string;
}

/** Línea de detalle de la factura con su base imponible e IVA calculados. */
export class InvoiceLine {
  readonly code: string;
  readonly auxiliaryCode?: string;
  readonly description: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly discount: number;
  readonly iva: IvaRate;
  readonly taxCode = IVA_TAX_CODE;

  constructor(props: InvoiceLineProps) {
    const code = props.code?.trim();
    const description = props.description?.trim();
    if (!code) throw new ValidationError('Cada detalle requiere codigoPrincipal');
    if (!description) throw new ValidationError(`El detalle ${code} requiere descripción`);
    if (code.length > 25) throw new ValidationError(`codigoPrincipal "${code}" excede 25 caracteres`);
    if (description.length > 300) throw new ValidationError(`La descripción de ${code} excede 300 caracteres`);
    if (!(props.quantity > 0)) throw new ValidationError(`La cantidad de ${code} debe ser mayor a 0`);
    if (!(props.unitPrice >= 0)) throw new ValidationError(`El precio unitario de ${code} no puede ser negativo`);
    const discount = props.discount ?? 0;
    if (discount < 0) throw new ValidationError(`El descuento de ${code} no puede ser negativo`);

    this.code = code;
    this.auxiliaryCode = props.auxiliaryCode?.trim() || undefined;
    this.description = description;
    this.quantity = roundTo(props.quantity, 6);
    this.unitPrice = roundTo(props.unitPrice, 6);
    this.discount = round2(discount);
    this.iva = ivaRate(props.ivaCode);

    if (this.discount > round2(this.quantity * this.unitPrice)) {
      throw new ValidationError(`El descuento de ${code} supera el valor de la línea`);
    }
  }

  /** precioTotalSinImpuesto = cantidad × precio − descuento. */
  get subtotal(): number {
    return round2(this.quantity * this.unitPrice - this.discount);
  }

  get taxBase(): number {
    return this.subtotal;
  }

  get taxValue(): number {
    return round2((this.taxBase * this.iva.rate) / 100);
  }
}
