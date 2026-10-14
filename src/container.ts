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
import { generateInvoicePDF, htmlToPdf } from './utils/pdf.utils';
import { documentModules } from './modules';
import { DocumentModule, DocumentModuleDeps } from './modules/types';

export interface Container {
  issueInvoice: IssueInvoice;
  submitInvoice: SubmitInvoiceToSri;
  invoices: InvoiceRepository;
  ride?: RidePublisher;
  /** Comprobantes adicionales (notas de crédito/débito, guías, retenciones). */
  modules: DocumentModule[];
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
  const issuers = overrides.issuers ?? new MongoIssuerRepository();
  const buyers = overrides.buyers ?? new MongoBuyerRepository();
  const products = overrides.products ?? new MongoProductRepository();
  const sequences = overrides.sequences ?? new MongoSequenceGenerator();
  const certificates = overrides.certificates ?? new MongoCertificateStore();
  const signer = overrides.signer ?? new FirmaEcXadesSigner();
  const sri = overrides.sri ?? new SriSoapGateway({ endpoints: endpointsFromEnv() });

  const issueInvoice = new IssueInvoice({
    issuers,
    buyers,
    products,
    sequences,
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
    certificates,
    signer,
    sri,
    ride,
    clock: overrides.clock,
    logger,
    options: overrides.submitOptions,
  });

  const moduleDeps: DocumentModuleDeps = {
    issuers,
    buyers,
    products,
    sequences,
    signer,
    sri,
    certificates,
    logger,
    clock: overrides.clock,
    random: overrides.random,
    submitOptions: overrides.submitOptions,
    ride: overrides.ride === null ? null : { storage: () => PDFStorageFactory.create(), htmlToPdf },
  };
  const modules = documentModules.map((factory) => factory(moduleDeps));

  return { issueInvoice, submitInvoice, invoices, ride, modules, logger };
}
