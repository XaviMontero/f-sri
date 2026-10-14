import { SriDocumentRecord, SriDocumentRepository } from '../../../application/ports/repositories';
import { Carrier, DeliveryGuide, DeliveryGuideRecipient } from '../domain/DeliveryGuide';

/** Guía de remisión persistida: estado SRI común + datos del traslado. */
export interface DeliveryGuideRecord extends SriDocumentRecord {
  departureAddress: string;
  carrier: Carrier;
  /** Medianoche UTC del día civil (como `emissionDate`). */
  transportStart: Date;
  transportEnd: Date;
  plate: string;
  recipients: DeliveryGuideRecipient[];
  additionalInfo?: Record<string, string>;
  request?: unknown;
}

export type NewDeliveryGuideRecord = Omit<DeliveryGuideRecord, 'id'>;

export interface DeliveryGuideRepository extends SriDocumentRepository<DeliveryGuideRecord> {
  create(record: NewDeliveryGuideRecord): Promise<DeliveryGuideRecord>;
}

export interface DeliveryGuideXml {
  render(guide: DeliveryGuide): string;
}
