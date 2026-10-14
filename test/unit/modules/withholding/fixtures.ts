import { EmissionDate } from '../../../../src/domain/invoice/EmissionDate';
import { SriDocumentUpdate } from '../../../../src/application/ports/repositories';
import {
  NewWithholdingRecord,
  WithholdingRecord,
  WithholdingRepository,
} from '../../../../src/modules/withholding/application/ports';
import {
  SupportDocumentInput,
  Withholding,
  WithholdingProps,
} from '../../../../src/modules/withholding/domain/Withholding';
import { ISSUER } from '../../../helpers/fakes';

/** Documento de sustento del payload que el SRI de pruebas autorizó (factura 10.00 + IVA 15%, renta 303 10%). */
export function supportDoc(overrides: Partial<SupportDocumentInput> = {}): SupportDocumentInput {
  return {
    supportCode: '01',
    documentType: '01',
    number: '001009000000001',
    emissionDate: '13/10/2026',
    authorizationNumber: '1310202601010607978300110010090000000019093224818',
    paymentLocation: '01',
    subtotal: 10,
    total: 11.5,
    taxes: [{ taxCode: '2', rateCode: '4', base: 10, rate: 15, value: 1.5 }],
    retentions: [{ taxCode: '1', retentionCode: '303', base: 10, percentage: 10, value: 1 }],
    payments: [{ method: '01', amount: 11.5 }],
    ...overrides,
  };
}

export function withholdingProps(overrides: Partial<WithholdingProps> = {}): WithholdingProps {
  return {
    issuer: ISSUER,
    emissionDate: EmissionDate.of(13, 10, 2026),
    fiscalPeriod: '10/2026',
    subject: { idType: '05', id: '0106079783', name: 'MONTERO CAMPOVERDE OSCAR XAVIER', relatedParty: 'NO' },
    supportDocuments: [supportDoc()],
    ...overrides,
  };
}

export const buildWithholding = (overrides: Partial<WithholdingProps> = {}) =>
  Withholding.create(withholdingProps(overrides));

/** Payload público `{ retencion }` idéntico al que autorizó el SRI de pruebas. */
export function retencionPayload(ruc = '0106079783001') {
  return {
    retencion: {
      infoTributaria: { ruc, claveAcceso: '', secuencial: '' },
      infoCompRetencion: {
        fechaEmision: '13/10/2026',
        tipoIdentificacionSujetoRetenido: '05',
        parteRel: 'NO',
        razonSocialSujetoRetenido: 'MONTERO CAMPOVERDE OSCAR XAVIER',
        identificacionSujetoRetenido: '0106079783',
        periodoFiscal: '10/2026',
      },
      docsSustento: [
        {
          docSustento: {
            codSustento: '01',
            codDocSustento: '01',
            numDocSustento: '001009000000001',
            fechaEmisionDocSustento: '13/10/2026',
            numAutDocSustento: '1310202601010607978300110010090000000019093224818',
            pagoLocExt: '01',
            totalSinImpuestos: '10.00',
            importeTotal: '11.50',
            impuestosDocSustento: [
              {
                impuestoDocSustento: {
                  codImpuestoDocSustento: '2',
                  codigoPorcentaje: '4',
                  baseImponible: '10.00',
                  tarifa: '15',
                  valorImpuesto: '1.50',
                },
              },
            ],
            retenciones: [
              {
                retencion: {
                  codigo: '1',
                  codigoRetencion: '303',
                  baseImponible: '10.00',
                  porcentajeRetener: '10',
                  valorRetenido: '1.00',
                },
              },
            ],
            pagos: [{ pago: { formaPago: '01', total: '11.50' } }],
          },
        },
      ],
    },
  };
}

export class InMemoryWithholdings implements WithholdingRepository {
  readonly records = new Map<string, WithholdingRecord>();
  private nextId = 1;

  async create(record: NewWithholdingRecord) {
    const created = { ...record, id: `ret-${this.nextId++}` };
    this.records.set(created.id, created);
    return created;
  }
  async findById(id: string) {
    return this.records.get(id) ?? null;
  }
  async update(id: string, changes: SriDocumentUpdate) {
    const current = this.records.get(id);
    if (!current) throw new Error(`withholding ${id} not found`);
    const updated = { ...current, ...changes };
    this.records.set(id, updated);
    return updated;
  }
}
