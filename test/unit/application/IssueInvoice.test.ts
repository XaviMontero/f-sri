import { describe, expect, it } from 'vitest';
import { IssueInvoice, IssueInvoiceCommand, IssueInvoiceDeps } from '../../../src/application/use-cases/IssueInvoice';
import { AccessKey } from '../../../src/domain/invoice/AccessKey';
import { InvoiceStatus } from '../../../src/domain/invoice/InvoiceStatus';
import { ForbiddenError, NotFoundError, ValidationError } from '../../../src/domain/shared/errors';
import { FacturaXmlRenderer } from '../../../src/infrastructure/sri/FacturaXmlRenderer';
import {
  fixedClock,
  InMemoryBuyers,
  InMemoryInvoices,
  InMemoryIssuers,
  InMemoryProducts,
  InMemorySequences,
  ISSUER,
} from '../../helpers/fakes';

const STORED_BUYER = {
  recordId: 'client-1',
  idType: '05',
  id: '0102030405',
  name: 'JUAN PEREZ',
  address: 'Av. Solano',
  email: 'juan@example.com',
  phone: '0999999999',
};

const PRODUCTS = [
  { id: 'prod-1', code: 'P001', description: 'Servicio de hosting', unitPrice: 10, chargesIva: true },
  { id: 'prod-2', code: 'P002', description: 'Libro', unitPrice: 20, chargesIva: false },
];

function setup(overrides: Partial<IssueInvoiceDeps> = {}) {
  const deps = {
    issuers: new InMemoryIssuers(),
    buyers: new InMemoryBuyers([STORED_BUYER]),
    products: new InMemoryProducts(PRODUCTS),
    sequences: new InMemorySequences(),
    invoices: new InMemoryInvoices(),
    xml: new FacturaXmlRenderer(),
    clock: fixedClock(),
    random: () => 0.12345678,
    ...overrides,
  };
  return { deps, useCase: new IssueInvoice(deps) };
}

const command = (overrides: Partial<IssueInvoiceCommand> = {}): IssueInvoiceCommand => ({
  issuerRuc: ISSUER.ruc,
  emissionDate: '13/10/2026',
  buyer: { idType: '05', id: '0102030405' },
  lines: [{ code: 'P001', quantity: 2 }],
  ...overrides,
});

describe('IssueInvoice', () => {
  it('emite una factura PENDIENTE con XML, clave y secuencial', async () => {
    const { deps, useCase } = setup();
    const record = await useCase.execute(command({ rawRequest: { raw: true } }), { companyId: 'issuer-1' });

    expect(record).toMatchObject({
      id: 'inv-1',
      issuerId: 'issuer-1',
      buyerRecordId: 'client-1',
      sequential: '000000001',
      number: '001-001-000000001',
      environment: '1',
      subtotal: 20,
      totalTax: 3,
      total: 23,
      status: InvoiceStatus.PENDING,
      request: { raw: true },
    });
    expect(record.emissionDate.toISOString()).toBe('2026-10-13T00:00:00.000Z');
    expect(AccessKey.from(record.accessKey).value.slice(39, 47)).toBe('12345678');
    expect(record.xml).toContain(`<claveAcceso>${record.accessKey}</claveAcceso>`);
    expect(record.lines).toEqual([
      {
        productId: 'prod-1',
        code: 'P001',
        description: 'Servicio de hosting',
        quantity: 2,
        unitPrice: 10,
        discount: 0,
        subtotal: 20,
        ivaCode: '4',
        ivaRate: 15,
        taxValue: 3,
      },
    ]);
    expect(deps.sequences.calls).toBe(1);
    expect(deps.invoices.records.size).toBe(1);
  });

  it('agrega info adicional del comprador (email/teléfono/dirección) y respeta la enviada', async () => {
    const { useCase } = setup();
    const record = await useCase.execute(command({ additionalInfo: { Email: 'otro@x.com', Vendedor: 'Ana' } }));
    expect(record.xml).toContain('<campoAdicional nombre="Email">otro@x.com</campoAdicional>');
    expect(record.xml).toContain('<campoAdicional nombre="Teléfono">0999999999</campoAdicional>');
    expect(record.xml).toContain('<campoAdicional nombre="Dirección">Av. Solano</campoAdicional>');
    expect(record.xml).toContain('<campoAdicional nombre="Vendedor">Ana</campoAdicional>');
    expect(record.additionalInfo).toEqual({
      Email: 'otro@x.com',
      Teléfono: '0999999999',
      Dirección: 'Av. Solano',
      Vendedor: 'Ana',
    });
    expect(record.payments).toEqual([{ method: '01', amount: 23 }]);
  });

  it('secuenciales consecutivos', async () => {
    const { useCase } = setup();
    await useCase.execute(command());
    const second = await useCase.execute(command());
    expect(second.sequential).toBe('000000002');
  });

  it('actor de otra empresa → ForbiddenError', async () => {
    const { deps, useCase } = setup();
    await expect(useCase.execute(command(), { companyId: 'otra' })).rejects.toBeInstanceOf(ForbiddenError);
    expect(deps.sequences.calls).toBe(0);
  });

  it('emisor inexistente → NotFoundError 400', async () => {
    const { useCase } = setup();
    const err = await useCase.execute(command({ issuerRuc: '1790000000001' })).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.httpStatus).toBe(400);
    expect(err.message).toBe('Empresa emisora no encontrada');
  });

  it('sin detalles → ValidationError', async () => {
    const { useCase } = setup();
    await expect(useCase.execute(command({ lines: [] }))).rejects.toThrow(/al menos un detalle/);
  });

  it('consumidor final no consulta la base de clientes', async () => {
    const buyers = {
      findByIdentification: async () => {
        throw new Error('no debería consultarse');
      },
    };
    const { useCase } = setup({ buyers });
    const record = await useCase.execute(command({ buyer: { idType: '07', id: '' } }));
    expect(record.buyer).toEqual({
      idType: '07',
      id: '9999999999999',
      name: 'CONSUMIDOR FINAL',
      address: undefined,
      email: undefined,
      phone: undefined,
    });
    expect(record.buyerRecordId).toBeUndefined();
  });

  it('consumidor final con total > 50 → ValidationError sin consumir secuencial', async () => {
    const { deps, useCase } = setup();
    await expect(
      useCase.execute(
        command({ buyer: { idType: '07', id: '9999999999999' }, lines: [{ code: 'P001', quantity: 5 }] }),
      ),
    ).rejects.toThrow(/consumidor final no puede superar/);
    expect(deps.sequences.calls).toBe(0);
  });

  it('comprador ad-hoc con nombre (no registrado)', async () => {
    const { useCase } = setup();
    const record = await useCase.execute(
      command({
        buyer: { idType: '06', id: 'P123456', name: 'John Doe', email: 'john@x.com', address: 'NY', phone: '1' },
      }),
    );
    expect(record.buyer).toEqual({
      idType: '06',
      id: 'P123456',
      name: 'John Doe',
      email: 'john@x.com',
      address: 'NY',
      phone: '1',
    });
    expect(record.buyerRecordId).toBeUndefined();
  });

  it('cliente inexistente sin nombre → NotFoundError 400', async () => {
    const { useCase } = setup();
    const err = await useCase
      .execute(command({ buyer: { idType: '05', id: '1111111111', name: '  ' } }))
      .catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.httpStatus).toBe(400);
    expect(err.message).toBe('Client not found');
  });

  it('producto con tiene_iva=false usa IVA 0%', async () => {
    const { useCase } = setup();
    const record = await useCase.execute(command({ lines: [{ code: 'P002', quantity: 1 }] }));
    expect(record.lines[0]).toMatchObject({
      ivaCode: '0',
      ivaRate: 0,
      taxValue: 0,
      unitPrice: 20,
      productId: 'prod-2',
    });
    expect(record.total).toBe(20);
  });

  it('la línea puede sobrescribir descripción, precio, descuento e IVA del producto', async () => {
    const { useCase } = setup();
    const record = await useCase.execute(
      command({
        lines: [
          { code: 'P001', quantity: 1, description: 'Hosting anual', unitPrice: 100, discount: 10, ivaCode: '0' },
        ],
      }),
    );
    expect(record.lines[0]).toMatchObject({
      description: 'Hosting anual',
      unitPrice: 100,
      discount: 10,
      subtotal: 90,
      ivaCode: '0',
    });
  });

  it('línea ad-hoc sin producto registrado (con descripción y precio) usa IVA 15% por defecto', async () => {
    const { useCase } = setup();
    const record = await useCase.execute(
      command({ lines: [{ code: 'SERV-X', description: 'Consultoría', unitPrice: 50, quantity: 1 }] }),
    );
    expect(record.lines[0]).toMatchObject({ productId: undefined, ivaCode: '4', taxValue: 7.5 });
    expect(record.total).toBe(57.5);
  });

  it.each([
    [{ code: 'NOEXISTE', quantity: 1 }],
    [{ code: 'NOEXISTE', quantity: 1, unitPrice: 5 }],
    [{ code: 'NOEXISTE', quantity: 1, description: 'x' }],
  ])('producto inexistente sin datos suficientes → NotFoundError (%o)', async (l) => {
    const { useCase } = setup();
    const err = await useCase.execute(command({ lines: [l] })).catch((e) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect(err.message).toBe('Product not found: NOEXISTE');
  });

  it('totales esperados que no coinciden → ValidationError y NO consume secuencial', async () => {
    const { deps, useCase } = setup();
    await expect(useCase.execute(command({ expectedTotals: { total: 22.99 } }))).rejects.toThrow(ValidationError);
    await expect(useCase.execute(command({ expectedTotals: { subtotal: 21 } }))).rejects.toThrow(
      /subtotal 20.00, IVA 3.00, total 23.00/,
    );
    expect(deps.sequences.calls).toBe(0);
    expect(deps.invoices.records.size).toBe(0);
  });

  it('totales esperados que coinciden (tolerancia de redondeo) se aceptan', async () => {
    const { useCase } = setup();
    await expect(useCase.execute(command({ expectedTotals: { subtotal: 20.004, total: 23 } }))).resolves.toBeDefined();
  });

  it('pagos inválidos no consumen secuencial', async () => {
    const { deps, useCase } = setup();
    await expect(useCase.execute(command({ payments: [{ method: '01', amount: 1 }] }))).rejects.toThrow(
      /suma de pagos/,
    );
    expect(deps.sequences.calls).toBe(0);
  });

  it('sin fecha usa el día actual en Ecuador según el reloj', async () => {
    const { useCase } = setup({ clock: fixedClock('2026-10-14T03:00:00Z') });
    const record = await useCase.execute(command({ emissionDate: undefined }));
    expect(record.emissionDate.toISOString()).toBe('2026-10-13T00:00:00.000Z');
    expect(record.accessKey.slice(0, 8)).toBe('13102026');
  });

  it('acepta fecha ISO y rechaza fechas inválidas', async () => {
    const { useCase } = setup();
    expect((await useCase.execute(command({ emissionDate: '2026-10-01' }))).accessKey.slice(0, 8)).toBe('01102026');
    await expect(useCase.execute(command({ emissionDate: '31/02/2026' }))).rejects.toBeInstanceOf(ValidationError);
  });

  it('usa reloj del sistema y Math.random por defecto', async () => {
    const { useCase } = setup({ clock: undefined, random: undefined });
    const record = await useCase.execute(command({ emissionDate: undefined }));
    expect(record.accessKey).toMatch(/^\d{49}$/);
  });

  // BUG: el borrador valida solo `command.additionalInfo`, pero la factura final agrega Email/Teléfono/Dirección
  // del comprador. Con 13–15 campos enviados + datos del cliente, la final supera 15 y lanza DESPUÉS de consumir el secuencial.
  it('información adicional que excede 15 tras agregar datos del cliente no consume secuencial', async () => {
    const { deps, useCase } = setup();
    const info = Object.fromEntries(Array.from({ length: 15 }, (_, i) => [`k${i}`, 'v']));
    await expect(useCase.execute(command({ additionalInfo: info }))).rejects.toThrow(/Máximo 15/);
    expect(deps.sequences.calls).toBe(0);
  });
});
