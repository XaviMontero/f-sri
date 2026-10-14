import { SubmitDocumentToSri } from '../../application/use-cases/SubmitDocumentToSri';
import { createSriDocumentRouter, sriDocumentSummary } from '../../http/sriDocumentRouter';
import { DocumentModuleFactory } from '../types';
import { DebitNoteRecord } from './application/DebitNoteRecord';
import { IssueDebitNote } from './application/IssueDebitNote';
import { DOCUMENT_TYPE_DEBIT_NOTE } from './domain/DebitNote';
import { toIssueDebitNoteCommand } from './http/debitNoteRequestMapper';
import { debitNoteSwaggerPaths } from './http/swagger';
import { createDebitNoteRidePublisher } from './infrastructure/debitNoteRide';
import { DebitNoteXmlRenderer } from './infrastructure/DebitNoteXmlRenderer';
import { DebitNoteModel, MongoDebitNoteRepository } from './infrastructure/MongoDebitNoteRepository';

/** Vista pública: estado SRI + documento modificado y totales. */
export function debitNoteSummary(note: DebitNoteRecord): Record<string, unknown> {
  return {
    ...sriDocumentSummary(note),
    cod_doc_modificado: note.modifiedDocument.type,
    num_doc_modificado: note.modifiedDocument.number,
    total_sin_impuestos: note.subtotal,
    total_impuestos: note.totalTax,
    valor_total: note.total,
  };
}

/** Nota de débito (codDoc 05) montada en `/api/v1/debit-note`. */
export const createDebitNoteModule: DocumentModuleFactory = (deps) => {
  const debitNotes = new MongoDebitNoteRepository();
  const issue = new IssueDebitNote({
    issuers: deps.issuers,
    buyers: deps.buyers,
    sequences: deps.sequences,
    debitNotes,
    xml: new DebitNoteXmlRenderer(),
    clock: deps.clock,
    random: deps.random,
  });
  const ride = createDebitNoteRidePublisher(deps.ride);
  const submit = new SubmitDocumentToSri<DebitNoteRecord>({
    documents: debitNotes,
    certificates: deps.certificates,
    signer: deps.signer,
    sri: deps.sri,
    ride,
    clock: deps.clock,
    logger: deps.logger,
    options: deps.submitOptions,
  });

  const router = createSriDocumentRouter<DebitNoteRecord>({
    label: 'Nota de débito',
    model: DebitNoteModel,
    documents: debitNotes,
    issue: (body, actor) => issue.execute(toIssueDebitNoteCommand(body), actor),
    submit,
    summary: debitNoteSummary,
    ride,
    logger: deps.logger,
  });

  return { documentType: DOCUMENT_TYPE_DEBIT_NOTE, path: 'debit-note', router, swaggerPaths: debitNoteSwaggerPaths };
};
