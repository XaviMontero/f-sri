/**
 * Ciclo de vida de una factura frente al SRI:
 *
 *   PENDIENTE → FIRMADA → RECIBIDA → AUTORIZADO
 *                 │          │
 *                 │          └→ NO AUTORIZADO / EN PROCESO (se reintenta)
 *                 └→ DEVUELTA (rechazo en recepción)
 *
 * ERROR_FIRMA y ERROR_COMUNICACION son estados técnicos reintentables.
 */
export enum InvoiceStatus {
  PENDING = 'PENDIENTE',
  SIGNED = 'FIRMADA',
  RECEIVED = 'RECIBIDA',
  RETURNED = 'DEVUELTA',
  IN_PROCESS = 'EN PROCESO',
  AUTHORIZED = 'AUTORIZADO',
  NOT_AUTHORIZED = 'NO AUTORIZADO',
  SIGNING_ERROR = 'ERROR_FIRMA',
  COMMUNICATION_ERROR = 'ERROR_COMUNICACION',
}

/** Estados finales: no tiene sentido volver a enviar el mismo comprobante. */
export function isFinalStatus(status: string): boolean {
  return status === InvoiceStatus.AUTHORIZED;
}
