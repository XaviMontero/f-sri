import { describe, expect, it } from 'vitest';
import { EmissionDate } from '../../../../src/domain/invoice/EmissionDate';
import { ValidationError } from '../../../../src/domain/shared/errors';
import { parseFiscalPeriod, retentionValue } from '../../../../src/modules/withholding/domain/Withholding';
import { buildWithholding, supportDoc } from './fixtures';

const fails = (fn: () => unknown, message: RegExp) => {
  expect(fn).toThrow(ValidationError);
  expect(fn).toThrow(message);
};

describe('Withholding (codDoc 07)', () => {
  it('se construye con el payload autorizado por el SRI y calcula el total retenido', () => {
    const w = buildWithholding();
    expect(w.documentType).toBe('07');
    expect(w.fiscalPeriod).toBe('10/2026');
    expect(w.subject).toEqual({
      idType: '05',
      id: '0106079783',
      name: 'MONTERO CAMPOVERDE OSCAR XAVIER',
      subjectType: undefined,
      relatedParty: 'NO',
    });
    const [doc] = w.supportDocuments;
    expect(doc.retentions[0].value).toBe(1);
    expect(doc.taxes[0]).toMatchObject({ rate: 15, value: 1.5 });
    expect(w.totalWithheld).toBe(1);
  });

  describe('valorRetenido = round2(base × porcentaje / 100)', () => {
    it.each([
      [10, 10, 1],
      [100, 1.75, 1.75],
      [33.33, 2.75, 0.92], // 0.916575
      [1.15, 30, 0.35], // 0.345 → half-up
      [10.05, 10, 1.01], // 1.005 con coma flotante
      [1234.56, 100, 1234.56],
      [50, 0, 0],
    ])('base %d × %d%% = %d', (base, pct, expected) => {
      expect(retentionValue(base, pct)).toBe(expected);
    });

    it('calcula el valor si el cliente no lo envía y suma varias retenciones', () => {
      const w = buildWithholding({
        supportDocuments: [
          supportDoc({
            retentions: [
              { taxCode: '1', retentionCode: '303', base: 10, percentage: 10 },
              { taxCode: '2', retentionCode: '725', base: 1.5, percentage: 30 },
            ],
          }),
        ],
      });
      expect(w.supportDocuments[0].retentions.map((r) => r.value)).toEqual([1, 0.45]);
      expect(w.totalWithheld).toBe(1.45);
    });

    it('rechaza un valorRetenido del cliente que no coincide', () => {
      fails(
        () =>
          buildWithholding({
            supportDocuments: [
              supportDoc({
                retentions: [{ taxCode: '1', retentionCode: '303', base: 10, percentage: 10, value: 1.1 }],
              }),
            ],
          }),
        /valorRetenido 1.1 no coincide .* 1.00/,
      );
    });

    it('rechaza porcentajes fuera de rango o con más de 2 decimales', () => {
      const ret = (percentage: number) =>
        buildWithholding({
          supportDocuments: [
            supportDoc({ retentions: [{ taxCode: '1', retentionCode: '303', base: 10, percentage }] }),
          ],
        });
      fails(() => ret(101), /porcentajeRetener debe estar entre 0 y 100/);
      fails(() => ret(-1), /porcentajeRetener/);
      fails(() => ret(1.755), /máximo 2 decimales/);
    });
  });

  describe('periodoFiscal', () => {
    it('acepta mm/aaaa y, si falta, usa el mes de emisión', () => {
      expect(parseFiscalPeriod(' 01/2026 ')).toBe('01/2026');
      expect(
        buildWithholding({ fiscalPeriod: undefined, emissionDate: EmissionDate.of(5, 11, 2026) }).fiscalPeriod,
      ).toBe('11/2026');
    });

    it.each(['13/2026', '00/2026', '1/2026', '2026-10', '10/26', 'abc'])('rechaza "%s"', (value) => {
      fails(() => buildWithholding({ fiscalPeriod: value }), /periodoFiscal inválido/);
    });
  });

  describe('sujeto retenido', () => {
    const subject = (s: Record<string, unknown>) =>
      buildWithholding({
        subject: { idType: '05', id: '0106079783', name: 'X', ...s } as never,
      });

    it('parteRel por defecto NO; acepta si en minúsculas', () => {
      expect(subject({ relatedParty: undefined }).subject.relatedParty).toBe('NO');
      expect(subject({ relatedParty: 'si' }).subject.relatedParty).toBe('SI');
      fails(() => subject({ relatedParty: 'TAL VEZ' }), /parteRel debe ser SI o NO/);
    });

    it('valida tipo de identificación, cédula y RUC', () => {
      fails(() => subject({ idType: '07' }), /tipoIdentificacionSujetoRetenido inválido/);
      fails(() => subject({ id: '123' }), /cédula .* 10 dígitos/);
      fails(() => subject({ idType: '04', id: '0106079783' }), /RUC .* 13 dígitos/);
      fails(() => subject({ id: '  ' }), /identificacionSujetoRetenido es requerida/);
      fails(() => subject({ name: '' }), /razonSocialSujetoRetenido es requerida/);
      expect(subject({ idType: '06', id: 'AB123' }).subject.id).toBe('AB123');
    });

    it('identificación del exterior exige tipoSujetoRetenido válido', () => {
      fails(() => subject({ idType: '08', id: 'X1' }), /tipoSujetoRetenido es obligatorio/);
      fails(() => subject({ idType: '08', id: 'X1', subjectType: '03' }), /tipoSujetoRetenido inválido/);
      expect(subject({ idType: '08', id: 'X1', subjectType: '02' }).subject.subjectType).toBe('02');
    });
  });

  describe('documento de sustento', () => {
    const doc = (overrides: Parameters<typeof supportDoc>[0]) =>
      buildWithholding({ supportDocuments: [supportDoc(overrides)] });

    it('requiere al menos un documento con impuestos, retenciones y pagos', () => {
      fails(() => buildWithholding({ supportDocuments: [] }), /al menos un documento de sustento/);
      fails(() => doc({ taxes: [] }), /al menos un impuestoDocSustento/);
      fails(() => doc({ retentions: [] }), /al menos una retención/);
      fails(() => doc({ payments: [] }), /al menos un pago/);
    });

    it('los códigos deben ser numéricos', () => {
      fails(() => doc({ supportCode: '1' }), /codSustento debe ser numérico de 2 dígitos/);
      fails(() => doc({ documentType: 'FA' }), /codDocSustento/);
      fails(() => doc({ number: '001-009-000000001' }), /numDocSustento debe tener 15 dígitos/);
      fails(() => doc({ authorizationNumber: '123' }), /numAutDocSustento debe tener 10, 37 o 49 dígitos/);
      fails(() => doc({ payments: [{ method: '1', amount: 11.5 }] }), /formaPago/);
      fails(
        () => doc({ taxes: [{ taxCode: 'X', rateCode: '4', base: 10 }] }),
        /codImpuestoDocSustento debe ser numérico/,
      );
      fails(
        () => doc({ retentions: [{ taxCode: '3', retentionCode: '303', base: 10, percentage: 10 }] }),
        /codigo inválido "3"/,
      );
      fails(
        () => doc({ retentions: [{ taxCode: '1', retentionCode: '30 3', base: 10, percentage: 10 }] }),
        /codigoRetencion inválido/,
      );
    });

    it('acepta códigos de retención alfanuméricos de la tabla ATS (p. ej. 332B)', () => {
      const w = doc({ retentions: [{ taxCode: '1', retentionCode: '332B', base: 10, percentage: 0 }] });
      expect(w.supportDocuments[0].retentions[0]).toMatchObject({ retentionCode: '332B', value: 0 });
    });

    it('fechas: formato válido y sustento no posterior a la emisión', () => {
      fails(() => doc({ emissionDate: '2026/10/13' }), /Formato de fecha inválido/);
      fails(() => doc({ emissionDate: '14/10/2026' }), /no puede ser posterior/);
      expect(doc({ accountingDate: '2026-10-13' }).supportDocuments[0].accountingDate).toBe('13/10/2026');
    });

    it('solo pago local (pagoLocExt 01), por defecto 01', () => {
      fails(() => doc({ paymentLocation: '02' }), /pagoLocExt "02" no soportado/);
      expect(doc({ paymentLocation: undefined }).supportDocuments[0].paymentLocation).toBe('01');
    });

    it('importeTotal = totalSinImpuestos + impuestos y = Σ pagos', () => {
      fails(() => doc({ total: 12, payments: [{ method: '01', amount: 12 }] }), /importeTotal 12.00 no coincide/);
      fails(() => doc({ payments: [{ method: '01', amount: 10 }] }), /suma de pagos \(10.00\) no coincide/);
      fails(() => doc({ subtotal: -1 }), /totalSinImpuestos debe ser un importe >= 0/);
    });

    it('IVA: la tarifa sale del codigoPorcentaje y el valorImpuesto se valida', () => {
      const w = doc({ taxes: [{ taxCode: '2', rateCode: '4', base: 10 }] });
      expect(w.supportDocuments[0].taxes[0]).toEqual({ taxCode: '2', rateCode: '4', base: 10, rate: 15, value: 1.5 });
      fails(() => doc({ taxes: [{ taxCode: '2', rateCode: '4', base: 10, rate: 12 }] }), /tarifa 12 no corresponde/);
      fails(
        () => doc({ taxes: [{ taxCode: '2', rateCode: '4', base: 10, value: 1.2 }] }),
        /valorImpuesto 1.2 no coincide/,
      );
      fails(() => doc({ taxes: [{ taxCode: '2', rateCode: '99', base: 10 }] }), /codigoPorcentaje de IVA no soportado/);
    });

    it('otros impuestos exigen tarifa', () => {
      fails(
        () =>
          doc({
            total: 10,
            payments: [{ method: '01', amount: 10 }],
            taxes: [{ taxCode: '3', rateCode: '3011', base: 10 }],
          }),
        /tarifa es requerida/,
      );
      const w = doc({
        total: 10.5,
        payments: [{ method: '01', amount: 10.5 }],
        taxes: [{ taxCode: '3', rateCode: '3011', base: 10, rate: 5 }],
      });
      expect(w.supportDocuments[0].taxes[0].value).toBe(0.5);
    });
  });

  it('infoAdicional: máximo 15 campos', () => {
    const info = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`c${i}`, 'v']));
    fails(() => buildWithholding({ additionalInfo: info }), /máximo 15 campos/);
  });
});
