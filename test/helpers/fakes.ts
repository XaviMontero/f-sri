import {
  BuyerRepository,
  InvoiceRecord,
  InvoiceRepository,
  InvoiceUpdate,
  IssuerRecord,
  IssuerRepository,
  NewInvoiceRecord,
  ProductRecord,
  ProductRepository,
  RidePublisher,
  SequenceGenerator,
} from '../../src/application/ports/repositories';
import { CertificateStore, DocumentSigner, SigningCertificate } from '../../src/application/ports/signing';
import { AuthorizationResult, ReceptionResult, SriEnvironment, SriGateway } from '../../src/application/ports/sri';
import { Buyer, Issuer } from '../../src/domain/invoice/Invoice';

export const ISSUER: Issuer = {
  ruc: '0106079783001',
  businessName: 'MONTERO CAMPOVERDE OSCAR XAVIER',
  tradeName: 'F-SRI PRUEBAS',
  headOfficeAddress: 'CUENCA',
  establishmentAddress: 'CUENCA',
  establishment: '001',
  emissionPoint: '001',
  environment: '1',
  emissionType: '1',
  keepsAccounting: false,
};

export const ISSUER_RECORD: IssuerRecord = { id: 'issuer-1', userId: 'user-1', issuer: ISSUER };

export class InMemoryIssuers implements IssuerRepository {
  constructor(private readonly records: IssuerRecord[] = [ISSUER_RECORD]) {}
  async findByRuc(ruc: string) {
    return this.records.find((r) => r.issuer.ruc === ruc) ?? null;
  }
}

export class InMemoryBuyers implements BuyerRepository {
  constructor(private readonly buyers: Array<Buyer & { recordId: string }> = []) {}
  async findByIdentification(id: string) {
    return this.buyers.find((b) => b.id === id) ?? null;
  }
}

export class InMemoryProducts implements ProductRepository {
  constructor(private readonly products: ProductRecord[] = []) {}
  async findByCodes(codes: string[]) {
    return new Map(this.products.filter((p) => codes.includes(p.code)).map((p) => [p.code, p]));
  }
}

export class InMemorySequences implements SequenceGenerator {
  private counters = new Map<string, number>();
  calls = 0;
  async next(key: { ruc: string; establishment: string; emissionPoint: string; documentType: string }) {
    this.calls++;
    const id = Object.values(key).join('-');
    const value = (this.counters.get(id) ?? 0) + 1;
    this.counters.set(id, value);
    return String(value).padStart(9, '0');
  }
}

export class InMemoryInvoices implements InvoiceRepository {
  readonly records = new Map<string, InvoiceRecord>();
  readonly history: InvoiceUpdate[] = [];
  private nextId = 1;

  async create(record: NewInvoiceRecord) {
    const created = { ...record, id: `inv-${this.nextId++}` };
    this.records.set(created.id, created);
    return created;
  }
  async findById(id: string) {
    return this.records.get(id) ?? null;
  }
  async update(id: string, changes: InvoiceUpdate) {
    const current = this.records.get(id);
    if (!current) throw new Error(`invoice ${id} not found`);
    this.history.push(changes);
    const updated = { ...current, ...changes };
    this.records.set(id, updated);
    return updated;
  }
}

export class FakeCertificates implements CertificateStore {
  constructor(private readonly certificate: SigningCertificate | Error = { p12: Buffer.from('p12'), password: 'x' }) {}
  async forIssuer() {
    if (this.certificate instanceof Error) throw this.certificate;
    return this.certificate;
  }
}

export class FakeSigner implements DocumentSigner {
  calls = 0;
  constructor(private readonly failWith?: Error) {}
  async sign(xml: string) {
    this.calls++;
    if (this.failWith) throw this.failWith;
    return xml.replace('</factura>', '<ds:Signature>fake</ds:Signature></factura>');
  }
}

/** SRI scriptable: cada llamada consume la siguiente respuesta (o error) de la cola. */
export class ScriptedSri implements SriGateway {
  readonly sent: Array<{ xml: string; environment: SriEnvironment }> = [];
  readonly authorizations: string[] = [];
  constructor(
    public receptions: Array<ReceptionResult | Error> = [{ status: 'RECIBIDA', messages: [] }],
    public authorizationResults: Array<AuthorizationResult | Error> = [authorized()],
  ) {}
  async send(xml: string, environment: SriEnvironment) {
    this.sent.push({ xml, environment });
    const next = this.receptions.length > 1 ? this.receptions.shift()! : this.receptions[0];
    if (next instanceof Error) throw next;
    return next;
  }
  async authorize(accessKey: string) {
    this.authorizations.push(accessKey);
    const next =
      this.authorizationResults.length > 1 ? this.authorizationResults.shift()! : this.authorizationResults[0];
    if (next instanceof Error) throw next;
    return next;
  }
}

export function authorized(overrides: Partial<AuthorizationResult> = {}): AuthorizationResult {
  return {
    status: 'AUTORIZADO',
    authorizationNumber: '1'.repeat(49),
    authorizationDate: new Date('2026-10-13T20:00:00Z'),
    authorizedXml: '<factura id="comprobante"/>',
    messages: [],
    ...overrides,
  };
}

export class RecordingRide implements RidePublisher {
  readonly published: InvoiceRecord[] = [];
  constructor(private readonly failWith?: Error) {}
  async publish(invoice: InvoiceRecord) {
    if (this.failWith) throw this.failWith;
    this.published.push(invoice);
  }
}

export const fixedClock = (iso = '2026-10-13T17:00:00Z') => ({ now: () => new Date(iso) });
