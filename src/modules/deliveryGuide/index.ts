import { SubmitDocumentToSri } from '../../application/use-cases/SubmitDocumentToSri';
import { createSriDocumentRouter, sriDocumentSummary } from '../../http/sriDocumentRouter';
import { DocumentModuleFactory } from '../types';
import { DeliveryGuideRecord } from './application/ports';
import { IssueDeliveryGuide } from './application/IssueDeliveryGuide';
import { DOCUMENT_TYPE_GUIA_REMISION } from './domain/DeliveryGuide';
import { DeliveryGuideXmlRenderer } from './infrastructure/DeliveryGuideXmlRenderer';
import { DeliveryNoteModel, MongoDeliveryGuideRepository } from './infrastructure/MongoDeliveryGuideRepository';
import { deliveryGuideRidePublisher } from './infrastructure/deliveryGuideRide';
import { toIssueDeliveryGuideCommand } from './http/deliveryGuideRequestMapper';
import { deliveryGuideSwaggerPaths } from './http/swagger';

/** Guía de remisión (codDoc 06), montada en `/api/v1/delivery-note`. */
export const createDeliveryGuideModule: DocumentModuleFactory = (deps) => {
  const guides = new MongoDeliveryGuideRepository();
  const issue = new IssueDeliveryGuide({
    issuers: deps.issuers,
    sequences: deps.sequences,
    guides,
    xml: new DeliveryGuideXmlRenderer(),
    clock: deps.clock,
    random: deps.random,
  });
  const ride = deps.ride ? deliveryGuideRidePublisher(deps.ride) : undefined;
  const submit = new SubmitDocumentToSri<DeliveryGuideRecord>({
    documents: guides,
    certificates: deps.certificates,
    signer: deps.signer,
    sri: deps.sri,
    ride,
    clock: deps.clock,
    logger: deps.logger,
    options: deps.submitOptions,
  });

  const router = createSriDocumentRouter<DeliveryGuideRecord>({
    label: 'Guía de remisión',
    model: DeliveryNoteModel,
    documents: guides,
    issue: (body, actor) =>
      issue.execute({ ...toIssueDeliveryGuideCommand(body?.guia_remision), rawRequest: body }, actor),
    submit,
    summary: (g) => ({
      ...sriDocumentSummary(g),
      placa: g.plate,
      transportista: {
        tipo_identificacion: g.carrier.idType,
        identificacion: g.carrier.id,
        razon_social: g.carrier.name,
      },
      destinatarios: g.recipients.length,
    }),
    ride,
    logger: deps.logger,
  });

  return {
    documentType: DOCUMENT_TYPE_GUIA_REMISION,
    path: 'delivery-note',
    router,
    swaggerPaths: deliveryGuideSwaggerPaths,
  };
};
