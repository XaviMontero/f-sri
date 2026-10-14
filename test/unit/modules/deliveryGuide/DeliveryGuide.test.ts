import { describe, expect, it } from 'vitest';
import { EmissionDate } from '../../../../src/domain/invoice/EmissionDate';
import { ValidationError } from '../../../../src/domain/shared/errors';
import { DeliveryGuide } from '../../../../src/modules/deliveryGuide/domain/DeliveryGuide';
import { guideProps, numberedGuide, recipient } from './builders';

const build = (overrides: Parameters<typeof guideProps>[0] = {}) => DeliveryGuide.create(guideProps(overrides));

describe('DeliveryGuide', () => {
  it('se crea válida con codDoc 06 y numeración asignada después', () => {
    const guide = numberedGuide();
    expect(guide.documentType).toBe('06');
    expect(guide.number).toBe('001-001-000000007');
    expect(guide.accessKey).toHaveLength(49);
    expect(guide.recipients[0].items[0].quantity).toBe(1);
  });

  it('sin numeración no expone secuencial ni clave', () => {
    const draft = build();
    expect(() => draft.sequential).toThrow(/secuencial/);
    expect(() => draft.accessKey).toThrow();
  });

  it('withNumbering valida formato de secuencial y clave', () => {
    expect(() => build().withNumbering({ sequential: '7', accessKey: '1'.repeat(49) })).toThrow(ValidationError);
    expect(() => build().withNumbering({ sequential: '000000007', accessKey: '123' })).toThrow(ValidationError);
  });

  it('fechaIniTransporte no puede ser posterior a fechaFinTransporte', () => {
    expect(() =>
      build({ transportStart: EmissionDate.parse('15/10/2026'), transportEnd: EmissionDate.parse('14/10/2026') }),
    ).toThrow(/fechaIniTransporte/);
    expect(() =>
      build({ transportStart: EmissionDate.parse('14/10/2026'), transportEnd: EmissionDate.parse('14/10/2026') }),
    ).not.toThrow();
  });

  it.each(['', '   ', 'ABC 123', 'ABC_123', 'A'.repeat(21)])('rechaza placa inválida %j', (plate) => {
    expect(() => build({ plate })).toThrow(ValidationError);
  });

  it('acepta placa con guion y la recorta', () => {
    expect(build({ plate: ' PBA-1234 ' }).plate).toBe('PBA-1234');
  });

  it('valida el tipo de identificación del transportista contra el catálogo', () => {
    expect(() => build({ carrier: { idType: '99', id: '0106079783', name: 'X' } })).toThrow(
      /tipoIdentificacionTransportista/,
    );
    expect(() => build({ carrier: { idType: '07', id: '9999999999999', name: 'X' } })).toThrow(/consumidor final/);
    expect(() => build({ carrier: { idType: '05', id: '123', name: 'X' } })).toThrow(/cédula/);
    expect(() => build({ carrier: { idType: '04', id: '0106079783', name: 'X' } })).toThrow(/RUC/);
    expect(() => build({ carrier: { idType: '05', id: '0106079783', name: ' ' } })).toThrow(/razonSocialTransportista/);
    expect(build({ carrier: { idType: '06', id: 'AB123456', name: 'X' } }).carrier.id).toBe('AB123456');
  });

  it('requiere dirPartida', () => {
    expect(() => build({ departureAddress: '' })).toThrow(/dirPartida/);
  });

  it('requiere al menos un destinatario con al menos un detalle', () => {
    expect(() => build({ recipients: [] })).toThrow(/al menos un destinatario/);
    expect(() => build({ recipients: [recipient({ items: [] })] })).toThrow(/al menos un detalle/);
  });

  it.each([0, -1, Number.NaN, 1.1234567])('rechaza cantidad %s', (quantity) => {
    expect(() => build({ recipients: [recipient({ items: [{ description: 'X', quantity }] })] })).toThrow(
      ValidationError,
    );
  });

  it('acepta cantidades con hasta 6 decimales', () => {
    const guide = build({ recipients: [recipient({ items: [{ description: 'X', quantity: 0.123456 }] })] });
    expect(guide.recipients[0].items[0].quantity).toBe(0.123456);
  });

  it('valida campos obligatorios y formatos del destinatario', () => {
    expect(() => build({ recipients: [recipient({ transferReason: '' })] })).toThrow(/motivoTraslado/);
    expect(() => build({ recipients: [recipient({ id: '' })] })).toThrow(/identificacionDestinatario/);
    expect(() => build({ recipients: [recipient({ destinationEstablishment: '1' })] })).toThrow(/codEstabDestino/);
    expect(() => build({ recipients: [recipient({ supportingDocument: { number: '1-1-1' } })] })).toThrow(
      /numDocSustento/,
    );
    expect(() => build({ recipients: [recipient({ supportingDocument: { authorizationNumber: '123' } })] })).toThrow(
      /numAutDocSustento/,
    );
    expect(() => build({ recipients: [recipient({ supportingDocument: { type: '1' } })] })).toThrow(/codDocSustento/);
    expect(() => build({ recipients: [recipient({ supportingDocument: { emissionDate: '32/13/2026' } })] })).toThrow(
      ValidationError,
    );
    expect(() => build({ recipients: [recipient({ items: [{ description: '', quantity: 1 }] })] })).toThrow(
      /descripcion/,
    );
  });

  it('normaliza el documento de sustento (fecha ISO → dd/mm/aaaa, vacío → undefined)', () => {
    const guide = build({
      recipients: [
        recipient({ supportingDocument: { type: '01', emissionDate: '2026-10-13' } }),
        recipient({ supportingDocument: { type: ' ', number: '' } }),
      ],
    });
    expect(guide.recipients[0].supportingDocument).toEqual({
      type: '01',
      number: undefined,
      authorizationNumber: undefined,
      emissionDate: '13/10/2026',
    });
    expect(guide.recipients[1].supportingDocument).toBeUndefined();
  });

  it('limpia la información adicional y limita a 15 campos', () => {
    expect(build({ additionalInfo: { Email: ' a@b.ec ', Vacio: ' ' } }).additionalInfo).toEqual({ Email: 'a@b.ec' });
    const many = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`k${i}`, 'v']));
    expect(() => build({ additionalInfo: many })).toThrow(/15/);
  });
});
