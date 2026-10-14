import { describe, expect, it } from 'vitest';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../../src/domain/shared/errors';
import { IssueDebitNote } from '../../../../src/modules/debitNote/application/IssueDebitNote';
import { toIssueDebitNoteCommand } from '../../../../src/modules/debitNote/http/debitNoteRequestMapper';
import { DebitNoteXmlRenderer } from '../../../../src/modules/debitNote/infrastructure/DebitNoteXmlRenderer';
import { AccessKey } from '../../../../src/domain/invoice/AccessKey';
import { fixedClock, InMemoryBuyers, InMemoryIssuers, InMemorySequences } from '../../../helpers/fakes';
import { InMemoryDebitNotes, ndPayload } from './support';

function setup(buyers = new InMemoryBuyers()) {
  const sequences = new InMemorySequences();
  const debitNotes = new InMemoryDebitNotes();
  const useCase = new IssueDebitNote({
    issuers: new InMemoryIssuers(),
    buyers,
    sequences,
    debitNotes,
    xml: new DebitNoteXmlRenderer(),
    clock: fixedClock(),
    random: () => 0.5,
  });
  return { useCase, sequences, debitNotes };
}

const command = (overrides: Parameters<typeof ndPayload>[0] = {}) => toIssueDebitNoteCommand(ndPayload(overrides));

describe('IssueDebitNote', () => {
  it('emite PENDIENTE con secuencial, clave de acceso codDoc 05, totales y XML', async () => {
    const { useCase, sequences } = setup();
    const nd = await useCase.execute(command(), { companyId: 'issuer-1' });
    expect(sequences.calls).toBe(1);
    expect(nd).toMatchObject({
      issuerId: 'issuer-1',
      documentType: '05',
      sequential: '000000001',
      number: '001-001-000000001',
      status: 'PENDIENTE',
      environment: '1',
      subtotal: 2,
      totalTax: 0.3,
      total: 2.3,
      modifiedDocument: { type: '01', number: '001-009-000000001' },
      taxes: [{ taxCode: '2', ivaCode: '4', rate: 15, base: 2, value: 0.3 }],
      payments: [{ method: '01', amount: 2.3, term: 0, timeUnit: 'dias' }],
    });
    const key = AccessKey.from(nd.accessKey);
    expect(key.value.slice(0, 8)).toBe('13102026');
    expect(key.value.slice(8, 10)).toBe('05');
    expect(nd.xml).toContain(`<claveAcceso>${nd.accessKey}</claveAcceso>`);
    expect(nd.xml).toContain('<codDoc>05</codDoc>');
    expect(nd.emissionDate.toISOString()).toBe('2026-10-13T00:00:00.000Z');
  });

  it('fecha de emisión por defecto: hoy en Ecuador', async () => {
    const { useCase } = setup();
    const nd = await useCase.execute(
      command({ info: { fechaEmision: undefined, fechaEmisionDocSustento: '01/10/2026' } }),
    );
    expect(nd.xml).toContain('<fechaEmision>13/10/2026</fechaEmision>');
  });

  it('los errores de validación no consumen secuencial', async () => {
    const { useCase, sequences, debitNotes } = setup();
    await expect(useCase.execute(command({ info: { valorTotal: '9.99' } }))).rejects.toThrow(/totales enviados/);
    await expect(useCase.execute(command({ info: { numDocModificado: '1-1-1' } }))).rejects.toThrow(ValidationError);
    await expect(
      useCase.execute(command({ info: { impuestos: [{ impuesto: { codigoPorcentaje: '4', valor: '0.24' } }] } })),
    ).rejects.toThrow(/valor del IVA/);
    await expect(useCase.execute(command({ info: { fechaEmisionDocSustento: '14/10/2026' } }))).rejects.toThrow(
      /posterior/,
    );
    expect(sequences.calls).toBe(0);
    expect(debitNotes.records.size).toBe(0);
  });

  it('emisor de otra empresa → ForbiddenError sin consumir secuencial', async () => {
    const { useCase, sequences } = setup();
    await expect(useCase.execute(command(), { companyId: 'other' })).rejects.toBeInstanceOf(ForbiddenError);
    expect(sequences.calls).toBe(0);
  });

  it('emisor inexistente → NotFoundError (400)', async () => {
    const { useCase } = setup();
    const err = await useCase.execute(command({ ruc: '1790000000001' })).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.httpStatus).toBe(400);
  });

  it('comprador registrado: usa sus datos e infoAdicional por defecto', async () => {
    const buyers = new InMemoryBuyers([
      { idType: '05', id: '0102030405', name: 'CLIENTE GUARDADO', email: 'c@x.ec', phone: '099', recordId: 'b-1' },
    ]);
    const { useCase } = setup(buyers);
    const nd = await useCase.execute(
      command({ info: { identificacionComprador: '0102030405', razonSocialComprador: undefined } }),
    );
    expect(nd.buyer.name).toBe('CLIENTE GUARDADO');
    expect(nd.buyerRecordId).toBe('b-1');
    expect(nd.additionalInfo).toEqual({ Email: 'c@x.ec', Teléfono: '099' });
  });

  it('comprador desconocido sin razón social → 400', async () => {
    const { useCase, sequences } = setup();
    await expect(
      useCase.execute(command({ info: { identificacionComprador: '0102030405', razonSocialComprador: '' } })),
    ).rejects.toThrow(/Client not found/);
    expect(sequences.calls).toBe(0);
  });

  it('consumidor final normaliza nombre', async () => {
    const { useCase } = setup();
    const nd = await useCase.execute(
      command({
        info: {
          tipoIdentificacionComprador: '07',
          identificacionComprador: '9999999999999',
          razonSocialComprador: 'x',
        },
      }),
    );
    expect(nd.buyer).toMatchObject({ idType: '07', id: '9999999999999', name: 'CONSUMIDOR FINAL' });
  });
});
