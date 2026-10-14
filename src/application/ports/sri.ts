export type SriEnvironment = '1' | '2';

export interface SriMessage {
  identifier: string;
  message: string;
  additionalInfo?: string;
  type: string;
}

export interface ReceptionResult {
  status: 'RECIBIDA' | 'DEVUELTA';
  messages: SriMessage[];
}

export interface AuthorizationResult {
  /** SIN_RESPUESTA = el SRI aún no tiene el comprobante en la cola de autorización. */
  status: 'AUTORIZADO' | 'NO AUTORIZADO' | 'EN PROCESO' | 'SIN_RESPUESTA';
  authorizationNumber?: string;
  authorizationDate?: Date;
  /** Comprobante tal como lo devuelve el SRI (XML firmado). */
  authorizedXml?: string;
  messages: SriMessage[];
}

/** Web services offline del SRI: recepción y autorización de comprobantes. */
export interface SriGateway {
  send(signedXml: string, environment: SriEnvironment): Promise<ReceptionResult>;
  authorize(accessKey: string, environment: SriEnvironment): Promise<AuthorizationResult>;
}

/** Falla de red, timeout o SOAP fault: el envío puede reintentarse. */
export class SriCommunicationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SriCommunicationError';
  }
}
