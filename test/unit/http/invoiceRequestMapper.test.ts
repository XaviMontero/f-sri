import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../../src/domain/shared/errors';
import { toIssueInvoiceCommand } from '../../../src/http/invoiceRequestMapper';

const legacyPayload = () => ({
  infoTributaria: { ruc: '0106079783001' },
  infoFactura: {
    fechaEmision: '13/10/2026',
    tipoIdentificacionComprador: '05',
    identificacionComprador: '0102030405',
    razonSocialComprador: 'JUAN PEREZ',
    totalSinImpuestos: '10.00',
    importeTotal: '11.50',
  },
  detalles: [
    {
      detalle: {
        codigoPrincipal: 'P001',
        descripcion: 'Producto',
        cantidad: '1',
        precioUnitario: '10.00',
        impuestos: [
          { impuesto: { codigo: '2', codigoPorcentaje: '4', tarifa: '15', baseImponible: '10.00', valor: '1.50' } },
        ],
      },
    },
  ],
});

describe('toIssueInvoiceCommand', () => {
  it('traduce el payload legacy al comando', () => {
    const payload = legacyPayload();
    expect(toIssueInvoiceCommand(payload)).toEqual({
      issuerRuc: '0106079783001',
      emissionDate: '13/10/2026',
      buyer: {
        idType: '05',
        id: '0102030405',
        name: 'JUAN PEREZ',
        address: undefined,
        email: undefined,
        phone: undefined,
      },
      lines: [{ code: 'P001', description: 'Producto', quantity: 1, unitPrice: 10, discount: undefined, ivaCode: '4' }],
      payments: undefined,
      tip: undefined,
      additionalInfo: undefined,
      expectedTotals: { subtotal: 10, total: 11.5 },
      rawRequest: payload,
    });
  });

  it('acepta detalles planos, números nativos, pagos, propina, contacto e info adicional', () => {
    const cmd = toIssueInvoiceCommand({
      infoTributaria: { ruc: 1234567890001 },
      infoFactura: {
        tipoIdentificacionComprador: '04',
        identificacionComprador: 1790000000001,
        razonSocialComprador: 'ACME',
        direccionComprador: 'Quito',
        emailComprador: 'a@acme.ec',
        telefonoComprador: '022',
        propina: '1.5',
        pagos: [
          { formaPago: 19, total: '11.50', plazo: '30', unidadTiempo: 'dias' },
          { formaPago: '01', total: 0 },
        ],
      },
      infoAdicional: { Vendedor: 'Ana' },
      detalles: [
        { codigoPrincipal: 7, cantidad: 2.5, descuento: '0.50', impuestos: [{ codigoPorcentaje: 0 }] },
        { codigoPrincipal: 'X', cantidad: 1 },
      ],
    });
    expect(cmd.issuerRuc).toBe('1234567890001');
    expect(cmd.emissionDate).toBeUndefined();
    expect(cmd.buyer).toEqual({
      idType: '04',
      id: '1790000000001',
      name: 'ACME',
      address: 'Quito',
      email: 'a@acme.ec',
      phone: '022',
    });
    expect(cmd.lines).toEqual([
      { code: '7', description: undefined, quantity: 2.5, unitPrice: undefined, discount: 0.5, ivaCode: '0' },
      { code: 'X', description: undefined, quantity: 1, unitPrice: undefined, discount: undefined, ivaCode: undefined },
    ]);
    expect(cmd.payments).toEqual([
      { method: '19', amount: 11.5, term: 30, timeUnit: 'dias' },
      { method: '01', amount: 0, term: undefined, timeUnit: undefined },
    ]);
    expect(cmd.tip).toBe(1.5);
    expect(cmd.additionalInfo).toEqual({ Vendedor: 'Ana' });
    expect(cmd.expectedTotals).toEqual({ subtotal: undefined, total: undefined });
  });

  it.each([null, undefined, 'texto', 5])('payload vacío o no-objeto (%s) → ValidationError', (payload) => {
    expect(() => toIssueInvoiceCommand(payload)).toThrow('Invoice data is required');
  });

  it.each([
    ['sin ruc', (p: any) => delete p.infoTributaria.ruc],
    ['sin infoTributaria', (p: any) => delete p.infoTributaria],
    ['sin infoFactura', (p: any) => delete p.infoFactura],
    ['detalles no es arreglo', (p: any) => (p.detalles = {})],
    ['detalles vacío', (p: any) => (p.detalles = [])],
  ])('%s → ValidationError', (_name, mutate) => {
    const p = legacyPayload();
    mutate(p);
    expect(() => toIssueInvoiceCommand(p)).toThrow(/Datos de factura inválidos/);
  });

  it('exige tipo e identificación del comprador', () => {
    const p: any = legacyPayload();
    delete p.infoFactura.identificacionComprador;
    expect(() => toIssueInvoiceCommand(p)).toThrow(/tipoIdentificacionComprador e identificacionComprador/);
  });

  it('detalle sin codigoPrincipal → ValidationError con índice', () => {
    const p: any = legacyPayload();
    p.detalles.push({ detalle: { cantidad: '1' } });
    expect(() => toIssueInvoiceCommand(p)).toThrow('El detalle 2 requiere codigoPrincipal');
    p.detalles = [null];
    expect(() => toIssueInvoiceCommand(p)).toThrow('El detalle 1 requiere codigoPrincipal');
  });

  it.each([
    ['cantidad', (p: any) => (p.detalles[0].detalle.cantidad = 'uno'), /cantidad del detalle 1 no es un número válido/],
    ['cantidad faltante', (p: any) => delete p.detalles[0].detalle.cantidad, /cantidad del detalle 1/],
    ['precioUnitario', (p: any) => (p.detalles[0].detalle.precioUnitario = '10,00'), /precioUnitario del detalle 1/],
    ['descuento', (p: any) => (p.detalles[0].detalle.descuento = 'x'), /descuento del detalle 1/],
    ['totalSinImpuestos', (p: any) => (p.infoFactura.totalSinImpuestos = 'abc'), /totalSinImpuestos/],
    ['importeTotal', (p: any) => (p.infoFactura.importeTotal = ''), /importeTotal/],
    ['propina', (p: any) => (p.infoFactura.propina = 'NaN'), /propina/],
    ['total del pago', (p: any) => (p.infoFactura.pagos = [{ formaPago: '01', total: 'x' }]), /total del pago/],
    ['plazo', (p: any) => (p.infoFactura.pagos = [{ formaPago: '01', total: '1', plazo: 'mes' }]), /plazo/],
  ])('número inválido en %s → ValidationError', (_name, mutate, message) => {
    const p = legacyPayload();
    mutate(p);
    let error: unknown;
    try {
      toIssueInvoiceCommand(p);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as Error).message).toMatch(message);
  });
});
