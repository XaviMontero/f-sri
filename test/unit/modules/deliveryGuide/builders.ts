import { EmissionDate } from '../../../../src/domain/invoice/EmissionDate';
import {
  DeliveryGuide,
  DeliveryGuideProps,
  DeliveryGuideRecipient,
} from '../../../../src/modules/deliveryGuide/domain/DeliveryGuide';
import { ISSUER } from '../../../helpers/fakes';

export const AUTH_49 = '1310202601010607978300110010090000000019093224818';

export function recipient(overrides: Partial<DeliveryGuideRecipient> = {}): DeliveryGuideRecipient {
  return {
    id: '0106079783',
    name: 'MONTERO CAMPOVERDE OSCAR XAVIER',
    address: 'CUENCA',
    transferReason: 'VENTA',
    route: 'CUENCA - CUENCA',
    supportingDocument: {
      type: '01',
      number: '001-009-000000001',
      authorizationNumber: AUTH_49,
      emissionDate: '13/10/2026',
    },
    items: [{ internalCode: 'PRD001', description: 'Servicio de prueba', quantity: 1 }],
    ...overrides,
  };
}

export function guideProps(overrides: Partial<DeliveryGuideProps> = {}): DeliveryGuideProps {
  return {
    issuer: ISSUER,
    emissionDate: EmissionDate.parse('13/10/2026'),
    departureAddress: 'CUENCA',
    carrier: { idType: '05', id: '0106079783', name: 'MONTERO CAMPOVERDE OSCAR XAVIER' },
    transportStart: EmissionDate.parse('13/10/2026'),
    transportEnd: EmissionDate.parse('14/10/2026'),
    plate: 'ABC1234',
    recipients: [recipient()],
    ...overrides,
  };
}

export function numberedGuide(overrides: Partial<DeliveryGuideProps> = {}): DeliveryGuide {
  return DeliveryGuide.create(guideProps(overrides)).withNumbering({
    sequential: '000000007',
    accessKey: '1310202606010607978300110010010000000071234567813',
  });
}
