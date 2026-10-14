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

/**
 * Estado común de cualquier comprobante electrónico frente al SRI (factura, notas de
 * crédito/débito, guía de remisión, retención). El pipeline de firma, recepción y
 * autorización opera solo sobre estos campos.
 */
export interface SriDocumentRecord {
  id: string;
  issuerId: string;
  /** codDoc de la tabla 3 (01, 04, 05, 06, 07). */
  documentType?: string;
  accessKey: string;
  sequential: string;
  number: string;
  environment: '1' | '2';
  emissionDate: Date;
  status: string;
  xml: string;
  signedXml?: string;
  authorizedXml?: string;
  authorizationNumber?: string;
  authorizationDate?: Date;
  sentAt?: Date;
  respondedAt?: Date;
  messages?: SriMessage[];
}

export type SriDocumentUpdate = Partial<
  Pick<
    SriDocumentRecord,
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

/** Lo mínimo que necesita el pipeline SRI de un repositorio de comprobantes. */
export interface SriDocumentRepository<T extends SriDocumentRecord = SriDocumentRecord> {
  findById(id: string): Promise<T | null>;
  update(id: string, changes: SriDocumentUpdate): Promise<T>;
}

/** Genera y publica el RIDE (representación impresa) de un comprobante autorizado. */
export interface RidePublisher<T extends SriDocumentRecord = InvoiceRecord> {
  publish(document: T): Promise<void>;
}

export interface InvoiceRecord extends SriDocumentRecord {
  buyerRecordId?: string;
  buyer: Buyer;
  subtotal: number;
  totalTax: number;
  total: number;
  lines: InvoiceLineRecord[];
  payments?: Payment[];
  additionalInfo?: Record<string, string>;
  request?: unknown;
}

export type NewInvoiceRecord = Omit<InvoiceRecord, 'id'>;

export type InvoiceUpdate = SriDocumentUpdate;

export interface InvoiceRepository extends SriDocumentRepository<InvoiceRecord> {
  create(invoice: NewInvoiceRecord): Promise<InvoiceRecord>;
}
