import { Invoice } from '../../domain/invoice/Invoice';

/** Serializa el agregado al XML del esquema `factura` del SRI. */
export interface InvoiceXmlRenderer {
  render(invoice: Invoice): string;
}
