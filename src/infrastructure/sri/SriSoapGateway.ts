import { DOMParser } from '@xmldom/xmldom';
import {
  AuthorizationResult,
  ReceptionResult,
  SriCommunicationError,
  SriEnvironment,
  SriGateway,
  SriMessage,
} from '../../application/ports/sri';

export interface SriEndpoints {
  reception: string;
  authorization: string;
}

const BASE = {
  '1': 'https://celcer.sri.gob.ec/comprobantes-electronicos-ws',
  '2': 'https://cel.sri.gob.ec/comprobantes-electronicos-ws',
} as const;

export const DEFAULT_SRI_ENDPOINTS: Record<SriEnvironment, SriEndpoints> = {
  '1': {
    reception: `${BASE['1']}/RecepcionComprobantesOffline`,
    authorization: `${BASE['1']}/AutorizacionComprobantesOffline`,
  },
  '2': {
    reception: `${BASE['2']}/RecepcionComprobantesOffline`,
    authorization: `${BASE['2']}/AutorizacionComprobantesOffline`,
  },
};

/** Permite sobreescribir endpoints por variables de entorno (se acepta el sufijo `?wsdl`). */
export function endpointsFromEnv(env: NodeJS.ProcessEnv = process.env): Record<SriEnvironment, SriEndpoints> {
  const clean = (url: string | undefined, fallback: string) => (url ? url.replace(/\?wsdl$/i, '') : fallback);
  return {
    '1': {
      reception: clean(env.SRI_RECEPCION_URL_PRUEBAS, DEFAULT_SRI_ENDPOINTS['1'].reception),
      authorization: clean(env.SRI_AUTORIZACION_URL_PRUEBAS, DEFAULT_SRI_ENDPOINTS['1'].authorization),
    },
    '2': {
      reception: clean(env.SRI_RECEPCION_URL_PRODUCCION, DEFAULT_SRI_ENDPOINTS['2'].reception),
      authorization: clean(env.SRI_AUTORIZACION_URL_PRODUCCION, DEFAULT_SRI_ENDPOINTS['2'].authorization),
    },
  };
}

export interface SriSoapGatewayOptions {
  endpoints?: Record<SriEnvironment, SriEndpoints>;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

/**
 * Cliente SOAP de los web services offline del SRI
 * (`validarComprobante` y `autorizacionComprobante`).
 */
export class SriSoapGateway implements SriGateway {
  private readonly endpoints: Record<SriEnvironment, SriEndpoints>;
  private readonly timeoutMs: number;
  private readonly fetch: typeof fetch;

  constructor(options: SriSoapGatewayOptions = {}) {
    this.endpoints = options.endpoints ?? DEFAULT_SRI_ENDPOINTS;
    this.timeoutMs = options.timeoutMs ?? 30000;
    this.fetch = options.fetch ?? fetch;
  }

  async send(signedXml: string, environment: SriEnvironment): Promise<ReceptionResult> {
    const body = envelope(
      'http://ec.gob.sri.ws.recepcion',
      'validarComprobante',
      `<xml>${Buffer.from(signedXml, 'utf8').toString('base64')}</xml>`,
    );
    const doc = await this.call(this.endpoints[environment].reception, body);
    const response = first(doc, 'RespuestaRecepcionComprobante');
    const status = childText(response, 'estado');
    if (status !== 'RECIBIDA' && status !== 'DEVUELTA') {
      throw new SriCommunicationError(`Respuesta de recepción inesperada: estado "${status ?? ''}"`);
    }
    const messages: SriMessage[] = [];
    for (const comprobante of elements(response, 'comprobante')) {
      messages.push(...parseMessages(comprobante));
    }
    return { status, messages };
  }

  async authorize(accessKey: string, environment: SriEnvironment): Promise<AuthorizationResult> {
    const body = envelope(
      'http://ec.gob.sri.ws.autorizacion',
      'autorizacionComprobante',
      `<claveAccesoComprobante>${accessKey}</claveAccesoComprobante>`,
    );
    const doc = await this.call(this.endpoints[environment].authorization, body);
    const authorizations = elements(doc, 'autorizacion');
    if (!authorizations.length) return { status: 'SIN_RESPUESTA', messages: [] };

    // Si el comprobante se envió varias veces puede haber varias respuestas: prima la autorizada.
    const chosen = authorizations.find((a) => childText(a, 'estado') === 'AUTORIZADO') ?? authorizations[0];
    const status = childText(chosen, 'estado') as AuthorizationResult['status'];
    const date = childText(chosen, 'fechaAutorizacion');
    return {
      status: ['AUTORIZADO', 'NO AUTORIZADO', 'EN PROCESO'].includes(status) ? status : 'SIN_RESPUESTA',
      authorizationNumber: childText(chosen, 'numeroAutorizacion') || undefined,
      authorizationDate: date ? new Date(date) : undefined,
      authorizedXml: childText(chosen, 'comprobante') || undefined,
      messages: parseMessages(chosen),
    };
  }

  private async call(url: string, body: string): Promise<Document> {
    let text: string;
    try {
      const response = await this.fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: '' },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      text = await response.text();
      if (!response.ok && !text.includes('Fault')) {
        throw new SriCommunicationError(`SRI respondió HTTP ${response.status}`);
      }
    } catch (error) {
      if (error instanceof SriCommunicationError) throw error;
      throw new SriCommunicationError(`Error de comunicación con el SRI: ${(error as Error).message}`, {
        cause: error,
      });
    }

    const doc = new DOMParser().parseFromString(text, 'text/xml') as unknown as Document;
    const fault = first(doc, 'Fault');
    if (fault) {
      throw new SriCommunicationError(`SOAP Fault del SRI: ${childText(fault, 'faultstring') ?? 'desconocido'}`);
    }
    return doc;
  }
}

function envelope(namespace: string, operation: string, content: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="${namespace}">` +
    `<soapenv:Header/><soapenv:Body><ec:${operation}>${content}</ec:${operation}></soapenv:Body></soapenv:Envelope>`
  );
}

/** Descendientes por nombre local, ignorando prefijos de namespace. */
function elements(node: Node | null | undefined, localName: string): Element[] {
  if (!node) return [];
  const all = (node as Element).getElementsByTagNameNS?.('*', localName);
  return all ? Array.from(all as unknown as ArrayLike<Element>) : [];
}

function first(node: Node | null | undefined, localName: string): Element | undefined {
  return elements(node, localName)[0];
}

/** Texto de un hijo directo (evita confundir <mensaje> contenedor con <mensaje> texto). */
function childText(node: Element | undefined, localName: string): string | undefined {
  if (!node) return undefined;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && ((child as Element).localName ?? child.nodeName) === localName) {
      return child.textContent?.trim() ?? '';
    }
  }
  return undefined;
}

function directChildren(node: Element | undefined, localName: string): Element[] {
  const result: Element[] = [];
  if (!node) return result;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1 && ((child as Element).localName ?? child.nodeName) === localName)
      result.push(child as Element);
  }
  return result;
}

function parseMessages(container: Element): SriMessage[] {
  const mensajes = directChildren(container, 'mensajes')[0];
  return directChildren(mensajes, 'mensaje').map((m) => ({
    identifier: childText(m, 'identificador') ?? '',
    message: childText(m, 'mensaje') ?? '',
    additionalInfo: childText(m, 'informacionAdicional') || undefined,
    type: childText(m, 'tipo') ?? 'ERROR',
  }));
}
