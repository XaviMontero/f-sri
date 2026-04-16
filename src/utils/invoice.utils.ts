import { AccessKeyDTO } from '../interfaces/invoice.interface';

/**
 * Calcula el dígito verificador utilizando el algoritmo Módulo 11
 * @param clave Cadena para calcular el dígito verificador
 * @returns Dígito verificador como string
 */
export function obtenerDigitoVerificador(clave: string): string {
  const coef = [2, 3, 4, 5, 6, 7];
  let suma = 0;
  for (let i = clave.length - 1, j = 0; i >= 0; i--, j++) {
    suma += parseInt(clave[i]) * coef[j % coef.length];
  }
  const mod = 11 - (suma % 11);
  return (mod === 11 ? 0 : mod === 10 ? 1 : mod).toString();
}

/**
 * Genera la clave de acceso para una factura según las especificaciones del SRI
 * @param params Parámetros necesarios para generar la clave
 * @returns Clave de acceso con dígito verificador
 */
export function generarClaveAcceso(params: AccessKeyDTO): string {
  const { fecha, tipoComprobante, ruc, ambiente, serie, secuencial, codigoNumerico, tipoEmision } = params;

  const dd = String(fecha.getUTCDate()).padStart(2, '0');
  const mm = String(fecha.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = fecha.getUTCFullYear();

  const base = `${dd}${mm}${yyyy}${tipoComprobante}${ruc}${ambiente}${serie}${secuencial}${codigoNumerico}${tipoEmision}`;

  const verificador = obtenerDigitoVerificador(base);
  return `${base}${verificador}`;
}

/**
 * Convierte una fecha en formato DD/MM/YYYY a un objeto Date válido
 * @param fechaStr Fecha en formato string
 * @returns Objeto Date
 */
export function convertirFecha(fechaStr: string): Date {
  let fecha: Date;

  if (fechaStr && fechaStr.includes('/')) {
    const partesFecha = fechaStr.split('/');
    if (partesFecha.length === 3) {
      // Formato esperado: DD/MM/YYYY
      const dia = partesFecha[0];
      const mes = partesFecha[1];
      const anio = partesFecha[2];
      // Reordenar a YYYY-MM-DD
      const fechaFormateada = `${anio}-${mes}-${dia}`;
      console.log('Formatted date:', fechaFormateada);
      fecha = new Date(fechaFormateada);
    } else {
      fecha = new Date(fechaStr);
    }
  } else {
    fecha = new Date(fechaStr);
  }

  return fecha;
}

