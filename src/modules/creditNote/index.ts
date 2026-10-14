import { SubmitDocumentToSri } from '../../application/use-cases/SubmitDocumentToSri';
import { sriDocumentSummary, createSriDocumentRouter } from '../../http/sriDocumentRouter';
import { DocumentRidePublisher } from '../../infrastructure/ride/DocumentRidePublisher';
import { DocumentModuleFactory } from '../types';
import { CreditNoteRecord, IssueCreditNote } from './application/IssueCreditNote';
import { DOCUMENT_TYPE_CREDIT_NOTE } from './domain/CreditNote';
import { toIssueCreditNoteCommand } from './http/creditNoteRequestMapper';
import { creditNoteSwaggerPaths } from './http/swagger';
import { CreditNoteModel } from './infrastructure/CreditNoteModel';
import { CreditNoteXmlRenderer } from './infrastructure/CreditNoteXmlRenderer';
import { renderCreditNoteRideHtml } from './infrastructure/creditNoteRide';
import { MongoCreditNoteRepository } from './infrastructure/MongoCreditNoteRepository';

export { CreditNote } from './domain/CreditNote';
export { IssueCreditNote } from './application/IssueCreditNote';
export type { CreditNoteRecord } from './application/IssueCreditNote';

/** Vista pública de una nota de crédito: estado SRI + documento modificado y valor. */
export function creditNoteSummary(note: CreditNoteRecord): Record<string, unknown> {
  return {
    ...sriDocumentSummary(note),
    cod_doc_modificado: note.modifiedDocument.type,
    num_doc_modificado: note.modifiedDocument.number,
    motivo: note.reason,
    total_sin_impuestos: note.subtotal,
    total_iva: note.totalTax,
    valor_modificacion: note.total,
  };
}

/** Nota de crédito (codDoc 04) montada en `/api/v1/credit-note`. */
export const createCreditNoteModule: DocumentModuleFactory = (deps) => {
  const creditNotes = new MongoCreditNoteRepository();
  const issue = new IssueCreditNote({
    issuers: deps.issuers,
    buyers: deps.buyers,
    products: deps.products,
    sequences: deps.sequences,
    creditNotes,
    xml: new CreditNoteXmlRenderer(),
    clock: deps.clock,
    random: deps.random,
  });
  const rideDeps = deps.ride;
  const ride = rideDeps
    ? new DocumentRidePublisher<CreditNoteRecord>({
        storage: rideDeps.storage,
        renderPdf: (data) => rideDeps.htmlToPdf(renderCreditNoteRideHtml(data)),
        filePrefix: 'nota_credito',
      })
    : undefined;
  const submit = new SubmitDocumentToSri<CreditNoteRecord>({
    documents: creditNotes,
    certificates: deps.certificates,
    signer: deps.signer,
    sri: deps.sri,
    ride,
    clock: deps.clock,
    logger: deps.logger,
    options: deps.submitOptions,
  });

  const router = createSriDocumentRouter<CreditNoteRecord>({
    label: 'Nota de crédito',
    model: CreditNoteModel,
    documents: creditNotes,
    issue: (body, actor) => issue.execute(toIssueCreditNoteCommand(body?.nota_credito), actor),
    submit,
    summary: creditNoteSummary,
    ride,
    logger: deps.logger,
  });

  return {
    documentType: DOCUMENT_TYPE_CREDIT_NOTE,
    path: 'credit-note',
    router,
    swaggerPaths: creditNoteSwaggerPaths,
  };
};
