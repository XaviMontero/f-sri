import { InvoiceRepository, RidePublisher } from './application/ports/repositories';
import { consoleLogger, Logger } from './application/ports/runtime';
import { CertificateStore, DocumentSigner } from './application/ports/signing';
import { SriGateway } from './application/ports/sri';
import { IssueInvoice, IssueInvoiceDeps } from './application/use-cases/IssueInvoice';
import { SubmitInvoiceToSri, SubmitOptions } from './application/use-cases/SubmitInvoiceToSri';
import { MongoCertificateStore } from './infrastructure/certificates/MongoCertificateStore';
import { MongoBuyerRepository } from './infrastructure/persistence/MongoBuyerRepository';
import { MongoInvoiceRepository } from './infrastructure/persistence/MongoInvoiceRepository';
import { MongoIssuerRepository } from './infrastructure/persistence/MongoIssuerRepository';
import { MongoProductRepository } from './infrastructure/persistence/MongoProductRepository';
import { MongoSequenceGenerator } from './infrastructure/persistence/MongoSequenceGenerator';
import { StorageRidePublisher } from './infrastructure/ride/StorageRidePublisher';
import { FirmaEcXadesSigner } from './infrastructure/signing/FirmaEcXadesSigner';
import { FacturaXmlRenderer } from './infrastructure/sri/FacturaXmlRenderer';
import { endpointsFromEnv, SriSoapGateway } from './infrastructure/sri/SriSoapGateway';
import { PDFStorageFactory } from './services/storage';
import { generateInvoicePDF } from './utils/pdf.utils';

export interface Container {
  issueInvoice: IssueInvoice;
  submitInvoice: SubmitInvoiceToSri;
  invoices: InvoiceRepository;
  ride?: RidePublisher;
  logger: Logger;
}

export interface ContainerOverrides extends Partial<Omit<IssueInvoiceDeps, 'invoices'>> {
  invoices?: InvoiceRepository;
  signer?: DocumentSigner;
  sri?: SriGateway;
  certificates?: CertificateStore;
  ride?: RidePublisher | null;
  logger?: Logger;
  submitOptions?: Partial<SubmitOptions>;
}

/** Composition root: el único lugar que conoce las implementaciones concretas. */
export function createContainer(overrides: ContainerOverrides = {}): Container {
  const logger = overrides.logger ?? consoleLogger;
  const invoices = overrides.invoices ?? new MongoInvoiceRepository();

  const issueInvoice = new IssueInvoice({
    issuers: overrides.issuers ?? new MongoIssuerRepository(),
    buyers: overrides.buyers ?? new MongoBuyerRepository(),
    products: overrides.products ?? new MongoProductRepository(),
    sequences: overrides.sequences ?? new MongoSequenceGenerator(),
    xml: overrides.xml ?? new FacturaXmlRenderer(),
    clock: overrides.clock,
    random: overrides.random,
    invoices,
  });

  const ride =
    overrides.ride === null
      ? undefined
      : (overrides.ride ??
        new StorageRidePublisher({ storage: () => PDFStorageFactory.create(), renderPdf: generateInvoicePDF }));

  const submitInvoice = new SubmitInvoiceToSri({
    invoices,
    certificates: overrides.certificates ?? new MongoCertificateStore(),
    signer: overrides.signer ?? new FirmaEcXadesSigner(),
    sri: overrides.sri ?? new SriSoapGateway({ endpoints: endpointsFromEnv() }),
    ride,
    clock: overrides.clock,
    logger,
    options: overrides.submitOptions,
  });

  return { issueInvoice, submitInvoice, invoices, ride, logger };
}
