import { describe, expect, it, vi } from 'vitest';
import { InvoiceRecord } from '../../../src/application/ports/repositories';
import { Logger } from '../../../src/application/ports/runtime';
import { SriCommunicationError } from '../../../src/application/ports/sri';
import { SubmitInvoiceDeps, SubmitInvoiceToSri } from '../../../src/application/use-cases/SubmitInvoiceToSri';
import { InvoiceStatus } from '../../../src/domain/invoice/InvoiceStatus';
import { NotFoundError } from '../../../src/domain/shared/errors';
import {
  authorized,
  FakeCertificates,
  FakeSigner,
  fixedClock,
  InMemoryInvoices,
  RecordingRide,
  ScriptedSri,
} from '../../helpers/fakes';

const KEY = '1310202601010607978300110010010000001231234567819';

async function seed(invoices: InMemoryInvoices, overrides: Partial<InvoiceRecord> = {}) {
  return invoices.create({
    issuerId: 'issuer-1',
    buyer: { idType: '05', id: '0102030405', name: 'JUAN' },
    accessKey: KEY,
    sequential: '000000123',
    number: '001-001-000000123',
    environment: '1',
    emissionDate: new Date('2026-10-13T00:00:00Z'),
    subtotal: 10,
    totalTax: 1.5,
    total: 11.5,
    status: InvoiceStatus.PENDING,
    xml: '<factura id="comprobante"></factura>',
    lines: [],
    ...overrides,
  });
}

function setup(overrides: Partial<SubmitInvoiceDeps> = {}) {
  const invoices = new InMemoryInvoices();
  const sleeps: number[] = [];
  const logger: Logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const deps = {
    invoices,
    certificates: new FakeCertificates(),
    signer: new FakeSigner(),
    sri: new ScriptedSri(),
    ride: new RecordingRide(),
    clock: fixedClock(),
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
    logger,
    options: { authorizationAttempts: 3, authorizationDelayMs: 100 },
    ...overrides,
  };
  return { deps, invoices, sleeps, logger, useCase: new SubmitInvoiceToSri(deps) };
}

const devuelta = (identifier: string, message = 'X') => ({
  status: 'DEVUELTA' as const,
  messages: [{ identifier, message, type: 'ERROR' }],
});

describe('SubmitInvoiceToSri', () => {
  it('firma, envía y autoriza; publica el RIDE', async () => {
    const { useCase, invoices, deps } = setup();
    const inv = await seed(invoices);
    const result = await useCase.execute(inv.id);

    expect(result.status).toBe(InvoiceStatus.AUTHORIZED);
    expect(result.signedXml).toContain('<ds:Signature>fake</ds:Signature>');
    expect(result.authorizationNumber).toBe('1'.repeat(49));
    expect(result.authorizationDate).toEqual(new Date('2026-10-13T20:00:00Z'));
    expect(result.authorizedXml).toBe('<factura id="comprobante"/>');
    expect(result.sentAt).toEqual(new Date('2026-10-13T17:00:00Z'));
    expect(result.respondedAt).toEqual(new Date('2026-10-13T17:00:00Z'));
    const sri = deps.sri as ScriptedSri;
    expect(sri.sent).toEqual([{ xml: result.signedXml, environment: '1' }]);
    expect(sri.authorizations).toEqual([KEY]);
    expect((deps.ride as RecordingRide).published.map((i) => i.status)).toEqual([InvoiceStatus.AUTHORIZED]);
    expect(invoices.history.map((h) => h.status)).toEqual([
      InvoiceStatus.SIGNED,
      InvoiceStatus.RECEIVED,
      InvoiceStatus.AUTHORIZED,
    ]);
  });

  it('AUTORIZADO sin número ni fecha usa clave de acceso y reloj', async () => {
    const sri = new ScriptedSri(undefined, [
      authorized({ authorizationNumber: undefined, authorizationDate: undefined }),
    ]);
    const { useCase, invoices } = setup({ sri });
    const result = await useCase.execute((await seed(invoices)).id);
    expect(result.authorizationNumber).toBe(KEY);
    expect(result.authorizationDate).toEqual(new Date('2026-10-13T17:00:00Z'));
  });

  it('sin RidePublisher autoriza igual', async () => {
    const { useCase, invoices } = setup({ ride: undefined });
    expect((await useCase.execute((await seed(invoices)).id)).status).toBe(InvoiceStatus.AUTHORIZED);
  });

  it('DEVUELTA: guarda mensajes y no consulta autorización', async () => {
    const sri = new ScriptedSri([devuelta('35', 'ARCHIVO NO CUMPLE ESTRUCTURA XML')]);
    const { useCase, invoices } = setup({ sri });
    const result = await useCase.execute((await seed(invoices)).id);
    expect(result.status).toBe(InvoiceStatus.RETURNED);
    expect(result.messages).toEqual([{ identifier: '35', message: 'ARCHIVO NO CUMPLE ESTRUCTURA XML', type: 'ERROR' }]);
    expect(sri.authorizations).toEqual([]);
  });

  it('DEVUELTA por secuencial registrado (45) agrega cómo resolverlo', async () => {
    const sri = new ScriptedSri([devuelta('45', 'ERROR SECUENCIAL REGISTRADO')]);
    const { useCase, invoices } = setup({ sri });
    const result = await useCase.execute((await seed(invoices)).id);
    expect(result.status).toBe(InvoiceStatus.RETURNED);
    expect(result.messages![0].additionalInfo).toMatch(/ultimo_secuencial/);
  });

  it.each(['43', '70'])('DEVUELTA con código %s (ya está en el SRI) continúa con la autorización', async (code) => {
    const sri = new ScriptedSri([devuelta(code)]);
    const { useCase, invoices } = setup({ sri });
    const result = await useCase.execute((await seed(invoices)).id);
    expect(result.status).toBe(InvoiceStatus.AUTHORIZED);
    expect(sri.authorizations).toHaveLength(1);
  });

  it('polling: SIN_RESPUESTA y EN PROCESO, luego AUTORIZADO, con esperas entre consultas', async () => {
    const sri = new ScriptedSri(undefined, [
      { status: 'SIN_RESPUESTA', messages: [] },
      { status: 'EN PROCESO', messages: [] },
      authorized(),
    ]);
    const { useCase, invoices, sleeps } = setup({ sri });
    const result = await useCase.execute((await seed(invoices)).id);
    expect(result.status).toBe(InvoiceStatus.AUTHORIZED);
    expect(sri.authorizations).toHaveLength(3);
    expect(sleeps).toEqual([100, 100]);
  });

  it('agotados los intentos queda EN PROCESO (sin esperar tras el último)', async () => {
    const sri = new ScriptedSri(undefined, [{ status: 'EN PROCESO', messages: [] }]);
    const { useCase, invoices, sleeps, deps } = setup({ sri });
    const result = await useCase.execute((await seed(invoices)).id);
    expect(result.status).toBe(InvoiceStatus.IN_PROCESS);
    expect(sri.authorizations).toHaveLength(3);
    expect(sleeps).toEqual([100, 100]);
    expect((deps.ride as RecordingRide).published).toHaveLength(0);
  });

  it('reintento de una factura EN PROCESO solo consulta autorización (no reenvía)', async () => {
    const sri = new ScriptedSri();
    const { useCase, invoices } = setup({ sri });
    const inv = await seed(invoices, { status: InvoiceStatus.IN_PROCESS, signedXml: '<signed/>' });
    const result = await useCase.execute(inv.id);
    expect(result.status).toBe(InvoiceStatus.AUTHORIZED);
    expect(sri.sent).toHaveLength(0);
  });

  it('NO AUTORIZADO guarda mensajes y no publica RIDE', async () => {
    const messages = [{ identifier: '39', message: 'FIRMA INVALIDA', type: 'ERROR' }];
    const sri = new ScriptedSri(undefined, [{ status: 'NO AUTORIZADO', messages }]);
    const { useCase, invoices, deps } = setup({ sri });
    const result = await useCase.execute((await seed(invoices)).id);
    expect(result.status).toBe(InvoiceStatus.NOT_AUTHORIZED);
    expect(result.messages).toEqual(messages);
    expect(sri.authorizations).toHaveLength(1);
    expect((deps.ride as RecordingRide).published).toHaveLength(0);
  });

  it('error del firmador → ERROR_FIRMA sin contactar al SRI', async () => {
    const sri = new ScriptedSri();
    const { useCase, invoices, logger } = setup({
      sri,
      signer: new FakeSigner(new Error('Error al firmar XML: contraseña')),
    });
    const result = await useCase.execute((await seed(invoices)).id);
    expect(result.status).toBe(InvoiceStatus.SIGNING_ERROR);
    expect(result.signedXml).toBeUndefined();
    expect(result.messages).toEqual([
      { identifier: 'LOCAL', message: 'Error al firmar XML: contraseña', type: 'ERROR' },
    ]);
    expect(sri.sent).toHaveLength(0);
    expect(logger.error).toHaveBeenCalled();
  });

  it('error del almacén de certificados → ERROR_FIRMA', async () => {
    const signer = new FakeSigner();
    const { useCase, invoices } = setup({
      signer,
      certificates: new FakeCertificates(new Error('Certificado no configurado')),
    });
    const result = await useCase.execute((await seed(invoices)).id);
    expect(result.status).toBe(InvoiceStatus.SIGNING_ERROR);
    expect(result.messages?.[0].message).toBe('Certificado no configurado');
    expect(signer.calls).toBe(0);
  });

  it('SriCommunicationError en recepción → ERROR_COMUNICACION; el reintento reanuda sin volver a firmar', async () => {
    const sri = new ScriptedSri([new SriCommunicationError('timeout'), { status: 'RECIBIDA', messages: [] }]);
    const signer = new FakeSigner();
    const { useCase, invoices, logger } = setup({ sri, signer });
    const inv = await seed(invoices);

    const first = await useCase.execute(inv.id);
    expect(first.status).toBe(InvoiceStatus.COMMUNICATION_ERROR);
    expect(first.messages).toEqual([{ identifier: 'LOCAL', message: 'timeout', type: 'ERROR' }]);
    expect(first.signedXml).toBeDefined();
    expect(logger.warn).toHaveBeenCalled();

    const second = await useCase.execute(inv.id);
    expect(second.status).toBe(InvoiceStatus.AUTHORIZED);
    expect(signer.calls).toBe(1);
    expect(sri.sent).toHaveLength(2);
    expect(sri.sent[1].xml).toBe(first.signedXml);
  });

  it('SriCommunicationError en autorización → ERROR_COMUNICACION', async () => {
    const sri = new ScriptedSri(undefined, [new SriCommunicationError('SOAP Fault del SRI: x')]);
    const { useCase, invoices } = setup({ sri });
    const result = await useCase.execute((await seed(invoices)).id);
    expect(result.status).toBe(InvoiceStatus.COMMUNICATION_ERROR);
    expect(result.messages?.[0].message).toBe('SOAP Fault del SRI: x');
  });

  it('factura ya AUTORIZADA es un no-op', async () => {
    const sri = new ScriptedSri();
    const signer = new FakeSigner();
    const { useCase, invoices } = setup({ sri, signer });
    const inv = await seed(invoices, { status: InvoiceStatus.AUTHORIZED, signedXml: '<s/>' });
    const result = await useCase.execute(inv.id);
    expect(result).toEqual(inv);
    expect(signer.calls).toBe(0);
    expect(sri.sent).toHaveLength(0);
    expect(sri.authorizations).toHaveLength(0);
    expect(invoices.history).toHaveLength(0);
  });

  it('si el RIDE falla la factura queda AUTORIZADA y se registra el error', async () => {
    const { useCase, invoices, logger } = setup({ ride: new RecordingRide(new Error('puppeteer murió')) });
    const result = await useCase.execute((await seed(invoices)).id);
    expect(result.status).toBe(InvoiceStatus.AUTHORIZED);
    expect(logger.error).toHaveBeenCalledWith(
      'No se pudo generar el RIDE',
      expect.objectContaining({ error: 'puppeteer murió' }),
    );
  });

  it('factura inexistente → NotFoundError', async () => {
    const { useCase } = setup();
    await expect(useCase.execute('nope')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('errores que no son del SRI se propagan', async () => {
    const sri = new ScriptedSri([new Error('bug inesperado')]);
    const { useCase, invoices } = setup({ sri });
    const inv = await seed(invoices);
    await expect(useCase.execute(inv.id)).rejects.toThrow('bug inesperado');
    expect((await invoices.findById(inv.id))!.status).toBe(InvoiceStatus.SIGNED);
  });

  it('usa opciones, reloj, sleep y logger por defecto', async () => {
    vi.useFakeTimers();
    try {
      const invoices = new InMemoryInvoices();
      const sri = new ScriptedSri(undefined, [{ status: 'SIN_RESPUESTA', messages: [] }, authorized()]);
      const useCase = new SubmitInvoiceToSri({
        invoices,
        certificates: new FakeCertificates(),
        signer: new FakeSigner(),
        sri,
      });
      const inv = await seed(invoices);
      const promise = useCase.execute(inv.id);
      await vi.advanceTimersByTimeAsync(3000);
      expect((await promise).status).toBe(InvoiceStatus.AUTHORIZED);
      expect(sri.authorizations).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
