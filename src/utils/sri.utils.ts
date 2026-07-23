import axios from 'axios';
import { Buffer } from 'buffer'; // For base64 conversion
import { DOMParser } from '@xmldom/xmldom';

// Interface for SRI response
export interface RespuestaSRI {
  estado: string; // EX: RECIBIDA, DEVUELTA
  comprobantes?: {
    // May not exist if the state is DEVUELTA directly for a general error
    comprobante?: {
      claveAcceso: string;
      mensajes?: {
        mensaje:
          | Array<{
              identificador: string;
              mensaje: string;
              informacionAdicional?: string;
              tipo: string;
            }>
          | {
              identificador: string;
              mensaje: string;
              informacionAdicional?: string;
              tipo: string;
            };
      };
    }[];
  };
  // For general errors at the request level, not specific to a receipt
  mensajes?: {
    mensaje:
      | Array<{
          identificador: string;
          mensaje: string;
          informacionAdicional?: string;
          tipo: string;
        }>
      | {
          identificador: string;
          mensaje: string;
          informacionAdicional?: string;
          tipo: string;
        };
  };
}

// Interface for SRI authorization response
export interface AutorizacionSRI {
  estado: string; // EX: AUTORIZADO, NO AUTORIZADO, EN PROCESO
  numeroAutorizacion?: string;
  fechaAutorizacion?: string;
  ambiente?: string;
  mensajes?: RespuestaSRI['mensajes'];
}

// WSDL URLs for SRI - now configurable via environment variables
const WSDL_PRUEBAS_RECEPCION =
  process.env.SRI_RECEPCION_URL_PRUEBAS ||
  'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl';

const WSDL_PRODUCCION_RECEPCION =
  process.env.SRI_RECEPCION_URL_PRODUCCION ||
  'https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl';

const WSDL_PRUEBAS_AUTORIZACION =
  process.env.SRI_AUTORIZACION_URL_PRUEBAS ||
  'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl';

const WSDL_PRODUCCION_AUTORIZACION =
  process.env.SRI_AUTORIZACION_URL_PRODUCCION ||
  'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline?wsdl';

/**
 * Get the appropriate WSDL URL based on environment
 */
function getWsdlUrl(): string {
  const environment = process.env.SRI_ENVIRONMENT || '1';
  return environment === '2' ? WSDL_PRODUCCION_RECEPCION : WSDL_PRUEBAS_RECEPCION;
}

/**
 * Get the appropriate authorization WSDL URL based on environment
 */
function getAutorizacionWsdlUrl(): string {
  const environment = process.env.SRI_ENVIRONMENT || '1';
  return environment === '2' ? WSDL_PRODUCCION_AUTORIZACION : WSDL_PRUEBAS_AUTORIZACION;
}

/**
 * Parse XML response from SRI to RespuestaSRI interface
 */
function parseXmlResponse(xmlString: string): RespuestaSRI {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

    // Check for SOAP fault first
    const faultElements = xmlDoc.getElementsByTagName('soap:Fault');
    if (faultElements.length > 0) {
      const faultString =
        faultElements[0].getElementsByTagName('faultstring')[0]?.textContent || 'Error SOAP desconocido';
      return {
        estado: 'ERROR_SOAP',
        mensajes: {
          mensaje: {
            identificador: '001',
            mensaje: `Error SOAP: ${faultString}`,
            tipo: 'ERROR',
          },
        },
      };
    }

    // Look for the response in different possible locations
    let estadoElement = xmlDoc.getElementsByTagName('estado')[0];

    // If not found, try with namespace prefixes
    if (!estadoElement) {
      const responseElements = xmlDoc.getElementsByTagName('RespuestaRecepcionComprobante');
      if (responseElements.length > 0) {
        estadoElement = responseElements[0].getElementsByTagName('estado')[0];
      }
    }

    const estado = estadoElement ? estadoElement.textContent || 'DESCONOCIDO' : 'DESCONOCIDO';
    const respuesta: RespuestaSRI = { estado };

    // Extract mensajes if they exist
    const mensajesExtraidos = extraerMensajes(xmlDoc);
    if (mensajesExtraidos) {
      respuesta.mensajes = mensajesExtraidos;
    }

    // Extract comprobantes if they exist
    const comprobantesElements = xmlDoc.getElementsByTagName('comprobante');
    if (comprobantesElements.length > 0) {
      const comprobantes = [];
      for (let i = 0; i < comprobantesElements.length; i++) {
        const comprobanteElement = comprobantesElements[i];
        const claveAcceso = comprobanteElement.getElementsByTagName('claveAcceso')[0]?.textContent || '';

        comprobantes.push({ claveAcceso });
      }
      respuesta.comprobantes = { comprobante: comprobantes };
    }

    return respuesta;
  } catch (error) {
    return {
      estado: 'ERROR_PARSING',
      mensajes: {
        mensaje: {
          identificador: '001',
          mensaje: 'Error al procesar respuesta del SRI',
          tipo: 'ERROR',
        },
      },
    };
  }
}

/**
 * Sends a signed XML receipt to SRI.
 * @param xmlFirmado String of the signed XML.
 * @returns Promise<RespuestaSRI> The parsed response from SRI.
 */
export async function enviarComprobanteSRI(xmlFirmado: string): Promise<RespuestaSRI> {
  try {
    const xmlBase64 = Buffer.from(xmlFirmado).toString('base64');

    const soapRequestBody =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="http://ec.gob.sri.ws.recepcion">' +
      '<soap:Header/>' +
      '<soap:Body>' +
      '<ec:validarComprobante>' +
      '<xml>' +
      xmlBase64 +
      '</xml>' +
      '</ec:validarComprobante>' +
      '</soap:Body>' +
      '</soap:Envelope>';

    const possibleActions = ['"http://ec.gob.sri.ws.recepcion/validarComprobante"', '"validarComprobante"', '""'];

    for (const soapAction of possibleActions) {
      try {
        const headers: any = {
          'Content-Type': 'text/xml; charset=utf-8',
        };

        if (soapAction && soapAction !== '""') {
          headers['SOAPAction'] = soapAction;
        }

        const response = await axios.post(getWsdlUrl(), soapRequestBody, {
          headers,
          timeout: 30000,
        });

        if (typeof response.data === 'string') {
          const result = parseXmlResponse(response.data);
          if (result.estado !== 'ERROR_SOAP') {
            return result;
          }
        }
      } catch (error: any) {
        continue;
      }
    }

    return {
      estado: 'ERROR_COMUNICACION',
      mensajes: {
        mensaje: {
          identificador: '000',
          mensaje: 'No se pudo determinar el SOAPAction correcto para el servicio del SRI',
          tipo: 'ERROR',
        },
      },
    };
  } catch (error: any) {
    return {
      estado: 'ERROR_COMUNICACION',
      mensajes: {
        mensaje: {
          identificador: '000',
          mensaje: `Error de comunicación con SRI: ${error.message}`,
          tipo: 'ERROR',
        },
      },
    };
  }
}

/**
 * Extracts the mensajes block from an XML element, if present
 */
function extraerMensajes(parent: Element | Document): RespuestaSRI['mensajes'] | undefined {
  const mensajesElements = parent.getElementsByTagName('mensaje');
  if (mensajesElements.length === 0) return undefined;

  const mensajes = [];
  for (let i = 0; i < mensajesElements.length; i++) {
    const mensajeElement = mensajesElements[i];

    // Skip the inner <mensaje> text element nested inside a <mensaje> entry
    if (mensajeElement.parentNode?.nodeName === 'mensaje') {
      continue;
    }

    const identificador = mensajeElement.getElementsByTagName('identificador')[0]?.textContent || '';
    const mensaje = mensajeElement.getElementsByTagName('mensaje')[0]?.textContent || '';
    const tipo = mensajeElement.getElementsByTagName('tipo')[0]?.textContent || 'INFO';
    const informacionAdicional = mensajeElement.getElementsByTagName('informacionAdicional')[0]?.textContent;

    mensajes.push({
      identificador,
      mensaje,
      tipo,
      ...(informacionAdicional && { informacionAdicional }),
    });
  }

  if (mensajes.length === 0) return undefined;

  return mensajes.length === 1 ? { mensaje: mensajes[0] } : { mensaje: mensajes };
}

/**
 * Parse the SRI authorization XML response into an AutorizacionSRI object
 */
function parseAutorizacionResponse(xmlString: string): AutorizacionSRI {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'text/xml');

    const faultElements = xmlDoc.getElementsByTagName('soap:Fault');
    if (faultElements.length > 0) {
      const faultString =
        faultElements[0].getElementsByTagName('faultstring')[0]?.textContent || 'Error SOAP desconocido';
      return {
        estado: 'ERROR_SOAP',
        mensajes: {
          mensaje: { identificador: '001', mensaje: `Error SOAP: ${faultString}`, tipo: 'ERROR' },
        },
      };
    }

    const autorizacionElement = xmlDoc.getElementsByTagName('autorizacion')[0];
    if (!autorizacionElement) {
      // The SRI may respond without an autorizacion node while the receipt is still in process
      return { estado: 'EN PROCESO' };
    }

    const estado = autorizacionElement.getElementsByTagName('estado')[0]?.textContent || 'DESCONOCIDO';
    const numeroAutorizacion = autorizacionElement.getElementsByTagName('numeroAutorizacion')[0]?.textContent;
    const fechaAutorizacion = autorizacionElement.getElementsByTagName('fechaAutorizacion')[0]?.textContent;
    const ambiente = autorizacionElement.getElementsByTagName('ambiente')[0]?.textContent;

    return {
      estado,
      ...(numeroAutorizacion && { numeroAutorizacion }),
      ...(fechaAutorizacion && { fechaAutorizacion }),
      ...(ambiente && { ambiente }),
      ...(extraerMensajes(autorizacionElement) && { mensajes: extraerMensajes(autorizacionElement) }),
    };
  } catch (error) {
    return {
      estado: 'ERROR_PARSING',
      mensajes: {
        mensaje: {
          identificador: '001',
          mensaje: 'Error al procesar respuesta de autorización del SRI',
          tipo: 'ERROR',
        },
      },
    };
  }
}

/**
 * Queries the SRI authorization web service for a receipt by its access key.
 * In the offline scheme the authorization number equals the access key.
 * @param claveAcceso 49-digit access key of the receipt.
 * @returns Promise<AutorizacionSRI> The parsed authorization response.
 */
export async function autorizarComprobanteSRI(claveAcceso: string): Promise<AutorizacionSRI> {
  try {
    const soapRequestBody =
      '<?xml version="1.0" encoding="UTF-8"?>' +
      '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ec="http://ec.gob.sri.ws.autorizacion">' +
      '<soap:Header/>' +
      '<soap:Body>' +
      '<ec:autorizacionComprobante>' +
      '<claveAccesoComprobante>' +
      claveAcceso +
      '</claveAccesoComprobante>' +
      '</ec:autorizacionComprobante>' +
      '</soap:Body>' +
      '</soap:Envelope>';

    const possibleActions = [
      '"http://ec.gob.sri.ws.autorizacion/autorizacionComprobante"',
      '"autorizacionComprobante"',
      '""',
    ];

    for (const soapAction of possibleActions) {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'text/xml; charset=utf-8',
        };

        if (soapAction && soapAction !== '""') {
          headers['SOAPAction'] = soapAction;
        }

        const response = await axios.post(getAutorizacionWsdlUrl(), soapRequestBody, {
          headers,
          timeout: 30000,
        });

        if (typeof response.data === 'string') {
          const result = parseAutorizacionResponse(response.data);
          if (result.estado !== 'ERROR_SOAP') {
            return result;
          }
        }
      } catch (error: any) {
        continue;
      }
    }

    return {
      estado: 'ERROR_COMUNICACION',
      mensajes: {
        mensaje: {
          identificador: '000',
          mensaje: 'No se pudo determinar el SOAPAction correcto para el servicio de autorización del SRI',
          tipo: 'ERROR',
        },
      },
    };
  } catch (error: any) {
    return {
      estado: 'ERROR_COMUNICACION',
      mensajes: {
        mensaje: {
          identificador: '000',
          mensaje: `Error de comunicación con SRI: ${error.message}`,
          tipo: 'ERROR',
        },
      },
    };
  }
}
