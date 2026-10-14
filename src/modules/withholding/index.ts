import { SubmitDocumentToSri } from '../../application/use-cases/SubmitDocumentToSri';
import { createSriDocumentRouter, sriDocumentSummary } from '../../http/sriDocumentRouter';
import { DocumentModuleFactory } from '../types';
import { IssueWithholding } from './application/IssueWithholding';
import { WithholdingRecord } from './application/ports';
import { DOCUMENT_TYPE_RETENCION } from './domain/Withholding';
import { MongoWithholdingRepository, WithholdingModel } from './infrastructure/MongoWithholdingRepository';
import { withholdingRidePublisher } from './infrastructure/withholdingRide';
import { WithholdingXmlRenderer } from './infrastructure/WithholdingXmlRenderer';
import { withholdingSwaggerPaths } from './http/swagger';
import { toIssueWithholdingCommand } from './http/withholdingRequestMapper';

/** Vista pública: estado SRI + datos propios de la retención. */
export function withholdingSummary(document: WithholdingRecord): Record<string, unknown> {
  return {
    ...sriDocumentSummary(document),
    periodo_fiscal: document.fiscalPeriod,
    sujeto_retenido: { identificacion: document.subject.id, razon_social: document.subject.name },
    total_retenido: document.totalWithheld,
  };
}

/** Comprobante de retención ATS 2.0.0 (codDoc 07), montado en `/api/v1/withholding`. */
export const createWithholdingModule: DocumentModuleFactory = (deps) => {
  const documents = new MongoWithholdingRepository();
  const issue = new IssueWithholding({
    issuers: deps.issuers,
    sequences: deps.sequences,
    clock: deps.clock,
    random: deps.random,
    withholdings: documents,
    xml: new WithholdingXmlRenderer(),
  });
  const ride = deps.ride ? withholdingRidePublisher(deps.ride) : undefined;
  const submit = new SubmitDocumentToSri<WithholdingRecord>({
    documents,
    certificates: deps.certificates,
    signer: deps.signer,
    sri: deps.sri,
    ride,
    clock: deps.clock,
    logger: deps.logger,
    options: deps.submitOptions,
  });

  const router = createSriDocumentRouter<WithholdingRecord>({
    label: 'Retención',
    model: WithholdingModel,
    documents,
    issue: (body, actor) => issue.execute(toIssueWithholdingCommand(body), actor),
    submit,
    summary: withholdingSummary,
    ride,
    logger: deps.logger,
  });

  return { documentType: DOCUMENT_TYPE_RETENCION, path: 'withholding', router, swaggerPaths: withholdingSwaggerPaths };
};
