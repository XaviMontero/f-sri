import { describe, expect, it } from 'vitest';
import { AccessKey } from '../../../../src/domain/invoice/AccessKey';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../../src/domain/shared/errors';
import { IssueWithholding } from '../../../../src/modules/withholding/application/IssueWithholding';
import { toIssueWithholdingCommand } from '../../../../src/modules/withholding/http/withholdingRequestMapper';
import { WithholdingXmlRenderer } from '../../../../src/modules/withholding/infrastructure/WithholdingXmlRenderer';
import { ISSUER, ISSUER_RECORD, InMemoryIssuers, InMemorySequences, fixedClock } from '../../../helpers/fakes';
import { InMemoryWithholdings, retencionPayload } from './fixtures';

function setup() {
  const sequences = new InMemorySequences();
  const withholdings = new InMemoryWithholdings();
  const useCase = new IssueWithholding({
    issuers: new InMemoryIssuers(),
    sequences,
    withholdings,
    xml: new WithholdingXmlRenderer(),
    clock: fixedClock(),
    random: () => 0.5,
  });
  return { useCase, sequences, withholdings };
}

const command = (mutate?: (body: ReturnType<typeof retencionPayload>) => void) => {
  const body = retencionPayload();
  mutate?.(body);
  return toIssueWithholdingCommand(body);
};

describe('IssueWithholding', () => {
  it('emite PENDIENTE con secuencial, clave de acceso codDoc 07 y XML', async () => {
    const { useCase, withholdings } = setup();
    const record = await useCase.execute(command(), { companyId: ISSUER_RECORD.id });

    expect(record).toMatchObject({
      issuerId: 'issuer-1',
      documentType: '07',
      sequential: '000000001',
      number: '001-001-000000001',
      environment: '1',
      status: 'PENDIENTE',
      fiscalPeriod: '10/2026',
      totalWithheld: 1,
      subject: { idType: '05', id: '0106079783', relatedParty: 'NO' },
    });
    expect(record.accessKey).toHaveLength(49);
    expect(record.accessKey.slice(0, 8)).toBe('13102026');
    expect(record.accessKey.slice(8, 10)).toBe('07');
    expect(AccessKey.from(record.accessKey).value).toBe(record.accessKey);
    expect(record.emissionDate.toISOString()).toBe('2026-10-13T00:00:00.000Z');
    expect(record.xml).toContain(`<claveAcceso>${record.accessKey}</claveAcceso>`);
    expect(record.xml).toContain('<comprobanteRetencion id="comprobante" version="2.0.0">');
    expect(record.request).toEqual(retencionPayload().retencion);
    expect(withholdings.records.size).toBe(1);
  });

  it('sin fechaEmision usa hoy en Ecuador', async () => {
    const { useCase } = setup();
    const record = await useCase.execute(
      command((b) => {
        b.retencion.infoCompRetencion.fechaEmision = '';
      }),
    );
    expect(record.emissionDate.toISOString()).toBe('2026-10-13T00:00:00.000Z');
  });

  it('los errores de validación no consumen secuencial', async () => {
    const { useCase, sequences, withholdings } = setup();
    const bad = command((b) => {
      b.retencion.docsSustento[0].docSustento.retenciones[0].retencion.valorRetenido = '2.00';
    });
    await expect(useCase.execute(bad)).rejects.toBeInstanceOf(ValidationError);
    await expect(
      useCase.execute(
        command((b) => {
          b.retencion.infoCompRetencion.periodoFiscal = '13/2026';
        }),
      ),
    ).rejects.toThrow(/periodoFiscal inválido/);
    expect(sequences.calls).toBe(0);
    expect(withholdings.records.size).toBe(0);

    await useCase.execute(command());
    expect(sequences.calls).toBe(1);
  });

  it('no permite emitir con el RUC de otra empresa (ForbiddenError)', async () => {
    const { useCase, sequences } = setup();
    await expect(useCase.execute(command(), { companyId: 'otra-empresa' })).rejects.toBeInstanceOf(ForbiddenError);
    expect(sequences.calls).toBe(0);
  });

  it('emisor inexistente → NotFoundError 400', async () => {
    const { useCase } = setup();
    const error = await useCase
      .execute(command((b) => (b.retencion.infoTributaria.ruc = '1790000000001')))
      .catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.httpStatus).toBe(400);
  });

  it('secuenciales consecutivos por serie', async () => {
    const { useCase } = setup();
    const a = await useCase.execute(command());
    const b = await useCase.execute(command());
    expect([a.sequential, b.sequential]).toEqual(['000000001', '000000002']);
    expect(b.accessKey).not.toBe(a.accessKey);
    expect(a.accessKey.slice(24, 30)).toBe(ISSUER.establishment + ISSUER.emissionPoint);
  });
});
