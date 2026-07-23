import { convertirFecha, generarClaveAcceso, obtenerDigitoVerificador } from '../../src/utils/invoice.utils';

describe('convertirFecha', () => {
  it('parses DD/MM/YYYY dates', () => {
    const fecha = convertirFecha('17/05/2025');

    expect(fecha.getFullYear()).toBe(2025);
    expect(fecha.getMonth()).toBe(4);
  });

  it('parses ISO dates without slashes', () => {
    const fecha = convertirFecha('2025-05-17');

    expect(isNaN(fecha.getTime())).toBe(false);
    expect(fecha.getUTCFullYear()).toBe(2025);
  });

  it('falls back to the native parser for slash dates with unexpected parts', () => {
    const fecha = convertirFecha('05/2025');

    expect(fecha).toBeInstanceOf(Date);
  });

  it('returns an invalid date for garbage input', () => {
    expect(isNaN(convertirFecha('no-es-fecha').getTime())).toBe(true);
  });
});

describe('obtenerDigitoVerificador', () => {
  it('applies módulo 11 with the 2-7 coefficient cycle', () => {
    expect(obtenerDigitoVerificador('41261533')).toBe('6');
  });

  it('maps a módulo result of 11 to 0', () => {
    // '451': 1*2 + 5*3 + 4*4 = 33 → 33 % 11 = 0 → dígito 0
    expect(obtenerDigitoVerificador('451')).toBe('0');
  });

  it('maps a módulo result of 10 to 1', () => {
    // '23': 3*2 + 2*3 = 12 → 12 % 11 = 1 → 11 - 1 = 10 → dígito 1
    expect(obtenerDigitoVerificador('23')).toBe('1');
  });
});

describe('generarClaveAcceso', () => {
  it('assembles the 49-digit key from its components in order', () => {
    const clave = generarClaveAcceso({
      fecha: new Date(Date.UTC(2025, 0, 5)),
      tipoComprobante: '01',
      ruc: '1790012345001',
      ambiente: '2',
      serie: '001002',
      secuencial: '000000042',
      codigoNumerico: '87654321',
      tipoEmision: '1',
    });

    expect(clave).toHaveLength(49);
    expect(
      clave.startsWith('05012025' + '01' + '1790012345001' + '2' + '001002' + '000000042' + '87654321' + '1'),
    ).toBe(true);
    expect(clave[48]).toBe(obtenerDigitoVerificador(clave.substring(0, 48)));
  });
});
