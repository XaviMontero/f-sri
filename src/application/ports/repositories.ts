import { Buyer, Issuer, Payment } from '../../domain/invoice/Invoice';
import { SriMessage } from './sri';

export interface IssuerRecord {
  id: string;
  userId?: string;
  issuer: Issuer;
  email?: string;
  phone?: string;
}

export interface IssuerRepository {
  findByRuc(ruc: string): Promise<IssuerRecord | null>;
}

export interface BuyerRepository {
  findByIdentification(identification: string): Promise<(Buyer & { id: string; recordId: string }) | null>;
}

export interface ProductRecord {
  id: string;
  code: string;
  description: string;
  unitPrice: number;
  chargesIva: boolean;
  additionalDescription?: string;
}

export interface ProductRepository {
  findByCodes(codes: string[]): Promise<Map<string, ProductRecord>>;
}

/** Entrega el siguiente secuencial (9 dígitos) de forma atómica por serie y tipo de comprobante. */
export interface SequenceGenerator {
  next(key: { ruc: string; establishment: string; emissionPoint: string; documentType: string }): Promise<string>;
}

export interface InvoiceLineRecord {
  productId?: string;
  code: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  subtotal: number;
  ivaCode: string;
  ivaRate: number;
  taxValue: number;
}

export interface InvoiceRecord {
  id: string;
  issuerId: string;
  buyerRecordId?: string;
  buyer: Buyer;
  accessKey: string;
  sequential: string;
  number: string;
  environment: '1' | '2';
  emissionDate: Date;
  subtotal: number;
  totalTax: number;
  total: number;
  status: string;
  xml: string;
  signedXml?: string;
  authorizedXml?: string;
  authorizationNumber?: string;
  authorizationDate?: Date;
  sentAt?: Date;
  respondedAt?: Date;
  messages?: SriMessage[];
  lines: InvoiceLineRecord[];
  payments?: Payment[];
  additionalInfo?: Record<string, string>;
  request?: unknown;
}

export type NewInvoiceRecord = Omit<InvoiceRecord, 'id'>;

export type InvoiceUpdate = Partial<
  Pick<
    InvoiceRecord,
    | 'status'
    | 'signedXml'
    | 'authorizedXml'
    | 'authorizationNumber'
    | 'authorizationDate'
    | 'sentAt'
    | 'respondedAt'
    | 'messages'
  >
>;

export interface InvoiceRepository {
  create(invoice: NewInvoiceRecord): Promise<InvoiceRecord>;
  findById(id: string): Promise<InvoiceRecord | null>;
  update(id: string, changes: InvoiceUpdate): Promise<InvoiceRecord>;
}

/** Genera y publica el RIDE (representación impresa) de una factura autorizada. */
export interface RidePublisher {
  publish(invoice: InvoiceRecord): Promise<void>;
}
