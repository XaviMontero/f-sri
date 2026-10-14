import { Router } from 'express';
import {
  BuyerRepository,
  IssuerRepository,
  ProductRepository,
  SequenceGenerator,
} from '../application/ports/repositories';
import { Clock, Logger } from '../application/ports/runtime';
import { CertificateStore, DocumentSigner } from '../application/ports/signing';
import { SriGateway } from '../application/ports/sri';
import { SubmitOptions } from '../application/use-cases/SubmitDocumentToSri';
import { IPDFStorageProvider } from '../interfaces/pdf-storage.interface';

/** Infraestructura compartida que recibe cada módulo de comprobante. */
export interface DocumentModuleDeps {
  issuers: IssuerRepository;
  buyers: BuyerRepository;
  products: ProductRepository;
  sequences: SequenceGenerator;
  signer: DocumentSigner;
  sri: SriGateway;
  certificates: CertificateStore;
  logger: Logger;
  clock?: Clock;
  random?: () => number;
  submitOptions?: Partial<SubmitOptions>;
  /** null = RIDE deshabilitado (tests). */
  ride: null | {
    storage: () => IPDFStorageProvider;
    htmlToPdf: (html: string) => Promise<Buffer>;
  };
}

/**
 * Un tipo de comprobante (nota de crédito, guía, retención…) como módulo autocontenido:
 * dominio + caso de uso + XML + persistencia + RIDE + rutas. Se monta en `/api/v1/{path}`.
 */
export interface DocumentModule {
  /** codDoc (tabla 3). */
  documentType: string;
  path: string;
  router: Router;
  /** Fragmento OpenAPI `paths` del módulo. */
  swaggerPaths?: Record<string, unknown>;
}

export type DocumentModuleFactory = (deps: DocumentModuleDeps) => DocumentModule;
