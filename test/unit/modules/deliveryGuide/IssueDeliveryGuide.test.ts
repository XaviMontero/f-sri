import { describe, expect, it } from 'vitest';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../../src/domain/shared/errors';
import {
  IssueDeliveryGuide,
  IssueDeliveryGuideCommand,
} from '../../../../src/modules/deliveryGuide/application/IssueDeliveryGuide';
import {
  DeliveryGuideRecord,
  DeliveryGuideRepository,
  NewDeliveryGuideRecord,
} from '../../../../src/modules/deliveryGuide/application/ports';
import { DeliveryGuideXmlRenderer } from '../../../../src/modules/deliveryGuide/infrastructure/DeliveryGuideXmlRenderer';
import { SriDocumentUpdate } from '../../../../src/application/ports/repositories';
import { fixedClock, InMemoryIssuers, InMemorySequences, ISSUER } from '../../../helpers/fakes';
import { recipient } from './builders';

class InMemoryGuides implements DeliveryGuideRepository {
  readonly records = new Map<string, DeliveryGuideRecord>();
  private nextId = 1;
  async create(record: NewDeliveryGuideRecord) {
    const created = { ...record, id: `gr-${this.nextId++}` };
    this.records.set(created.id, created);
    return created;
  }
  async findById(id: string) {
    return this.records.get(id) ?? null;
  }
  async update(id: string, changes: SriDocumentUpdate) {
    const updated = { ...this.records.get(id)!, ...changes };
    this.records.set(id, updated);
    return updated;
  }
}

function setup() {
  const sequences = new InMemorySequences();
  const guides = new InMemoryGuides();
  const useCase = new IssueDeliveryGuide({
    issuers: new InMemoryIssuers(),
    sequences,
    guides,
    xml: new DeliveryGuideXmlRenderer(),
    clock: fixedClock('2026-10-13T17:00:00Z'),
    random: () => 0.5,
  });
  return { sequences, guides, useCase };
}

function command(overrides: Partial<IssueDeliveryGuideCommand> = {}): IssueDeliveryGuideCommand {
  return {
    issuerRuc: ISSUER.ruc,
    departureAddress: 'CUENCA',
    carrier: { idType: '05', id: '0106079783', name: 'MONTERO CAMPOVERDE OSCAR XAVIER' },
    transportStart: '13/10/2026',
    transportEnd: '14/10/2026',
    plate: 'ABC1234',
    recipients: [recipient()],
    ...overrides,
  };
}

describe('IssueDeliveryGuide', () => {
  it('emite la guía PENDIENTE con secuencial, clave de acceso codDoc 06 y XML', async () => {
    const { useCase, sequences } = setup();
    const record = await useCase.execute(command({ rawRequest: { a: 1 } }), { companyId: 'issuer-1' });

    expect(sequences.calls).toBe(1);
    expect(record).toMatchObject({
      issuerId: 'issuer-1',
      documentType: '06',
      sequential: '000000001',
      number: '001-001-000000001',
      environment: '1',
      status: 'PENDIENTE',
      plate: 'ABC1234',
      departureAddress: 'CUENCA',
      request: { a: 1 },
    });
    // fecha de emisión por defecto: hoy en Ecuador (no la de transporte).
    expect(record.accessKey).toMatch(/^1310202606/);
    expect(record.accessKey.slice(24, 39)).toBe('001001000000001');
    expect(record.emissionDate.toISOString()).toBe('2026-10-13T00:00:00.000Z');
    expect(record.transportStart.toISOString()).toBe('2026-10-13T00:00:00.000Z');
    expect(record.transportEnd.toISOString()).toBe('2026-10-14T00:00:00.000Z');
    expect(record.xml).toContain(`<claveAcceso>${record.accessKey}</claveAcceso>`);
    expect(record.xml).toContain('<codDoc>06</codDoc>');
  });

  it('usa la fechaEmision recibida para la clave de acceso', async () => {
    const { useCase } = setup();
    const record = await useCase.execute(command({ emissionDate: '12/10/2026' }));
    expect(record.accessKey).toMatch(/^1210202606/);
  });

  it('errores de validación no consumen secuencial', async () => {
    const { useCase, sequences } = setup();
    const invalid: Array<Partial<IssueDeliveryGuideCommand>> = [
      { transportStart: '15/10/2026', transportEnd: '14/10/2026' },
      { plate: 'ABC 123' },
      { carrier: { idType: '99', id: '1', name: 'X' } },
      { recipients: [] },
      { recipients: [recipient({ items: [{ description: 'X', quantity: 0 }] })] },
      { transportStart: 'mañana' },
      { emissionDate: '31/02/2026' },
    ];
    for (const overrides of invalid) {
      await expect(useCase.execute(command(overrides))).rejects.toBeInstanceOf(ValidationError);
    }
    expect(sequences.calls).toBe(0);
  });

  it('el usuario de otra empresa no puede emitir (ForbiddenError) y no consume secuencial', async () => {
    const { useCase, sequences } = setup();
    await expect(useCase.execute(command(), { companyId: 'otra-empresa' })).rejects.toBeInstanceOf(ForbiddenError);
    expect(sequences.calls).toBe(0);
  });

  it('emisor inexistente → NotFoundError 400', async () => {
    const { useCase } = setup();
    const error = await useCase.execute(command({ issuerRuc: '1790000000001' })).catch((e) => e);
    expect(error).toBeInstanceOf(NotFoundError);
    expect(error.httpStatus).toBe(400);
  });
});
