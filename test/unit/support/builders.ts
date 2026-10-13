import { EmissionDate } from '../../../src/domain/invoice/EmissionDate';
import { Invoice, InvoiceProps } from '../../../src/domain/invoice/Invoice';
import { InvoiceLineProps } from '../../../src/domain/invoice/InvoiceLine';
import { ISSUER } from '../../helpers/fakes';

export const line = (overrides: Partial<InvoiceLineProps> = {}): InvoiceLineProps => ({
  code: 'P001',
  description: 'Producto de prueba',
  quantity: 1,
  unitPrice: 10,
  ivaCode: '4',
  ...overrides,
});

export const invoiceProps = (overrides: Partial<InvoiceProps> = {}): InvoiceProps => ({
  issuer: ISSUER,
  buyer: { idType: '05', id: '0102030405', name: 'JUAN PEREZ' },
  emissionDate: EmissionDate.of(13, 10, 2026),
  sequential: '000000123',
  numericCode: '12345678',
  lines: [line()],
  ...overrides,
});

export const buildInvoice = (overrides: Partial<InvoiceProps> = {}) => Invoice.create(invoiceProps(overrides));
