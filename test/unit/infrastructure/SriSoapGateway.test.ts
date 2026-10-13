import { describe, expect, it, vi } from 'vitest';
import { SriCommunicationError } from '../../../src/application/ports/sri';
import {
  DEFAULT_SRI_ENDPOINTS,
  endpointsFromEnv,
  SriSoapGateway,
} from '../../../src/infrastructure/sri/SriSoapGateway';

const KEY = '1310202601010607978300110010010000001231234567810';

const soap = (body: string) =>
  `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;

const RECIBIDA = soap(
  '<ns2:validarComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.recepcion"><RespuestaRecepcionComprobante><estado>RECIBIDA</estado><comprobantes/></RespuestaRecepcionComprobante></ns2:validarComprobanteResponse>',
);

const reception = (estado: string, comprobantes: string) =>
  soap(
    `<ns2:validarComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.recepcion"><RespuestaRecepcionComprobante><estado>${estado}</estado><comprobantes>${comprobantes}</comprobantes></RespuestaRecepcionComprobante></ns2:validarComprobanteResponse>`,
  );

const mensaje = (id: string, text: string, extra?: string, tipo = 'ERROR') =>
  `<mensaje><identificador>${id}</identificador><mensaje>${text}</mensaje>${extra ? `<informacionAdicional>${extra}</informacionAdicional>` : ''}<tipo>${tipo}</tipo></mensaje>`;

const DEVUELTA = reception(
  'DEVUELTA',
  `<comprobante><claveAcceso>${KEY}</claveAcceso><mensajes>${mensaje(
    '35',
    'ARCHIVO NO CUMPLE ESTRUCTURA XML',
    'Se encontró el siguiente error en la estructura del comprobante: cvc-complex-type.2.4.a',
  )}${mensaje('43', 'CLAVE ACCESO REGISTRADA', undefined, 'ADVERTENCIA')}</mensajes></comprobante>`,
);

const autorizacion = (estado: string, extra = '', mensajes = '<mensajes/>') =>
  `<autorizacion><estado>${estado}</estado>${extra}${mensajes}</autorizacion>`;

const authorizationResponse = (autorizaciones: string, count = 1) =>
  soap(
    `<ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion"><RespuestaAutorizacionComprobante><claveAccesoConsultada>${KEY}</claveAccesoConsultada><numeroComprobantes>${count}</numeroComprobantes><autorizaciones>${autorizaciones}</autorizaciones></RespuestaAutorizacionComprobante></ns2:autorizacionComprobanteResponse>`,
  );

const AUTORIZADO_EXTRA = `<numeroAutorizacion>${KEY}</numeroAutorizacion><fechaAutorizacion>2026-10-13T15:06:18-05:00</fechaAutorizacion><ambiente>PRUEBAS</ambiente><comprobante><![CDATA[<?xml version="1.0"?><factura id="comprobante"><infoTributaria><ambiente>1</ambiente></infoTributaria></factura>]]></comprobante>`;
const AUTORIZADO = authorizationResponse(autorizacion('AUTORIZADO', AUTORIZADO_EXTRA));

const NO_AUTORIZADO = authorizationResponse(
  autorizacion(
    'NO AUTORIZADO',
    '<fechaAutorizacion>2026-10-13T15:06:18-05:00</fechaAutorizacion><ambiente>PRUEBAS</ambiente><comprobante><![CDATA[<factura/>]]></comprobante>',
    `<mensajes>${mensaje('39', 'FIRMA INVALIDA', 'La firma es invalida [Firma inválida (firma y/o certificados alterados)]')}</mensajes>`,
  ),
);

const FAULT = soap(
  '<soap:Fault><faultcode>soap:Server</faultcode><faultstring>java.lang.NullPointerException</faultstring></soap:Fault>',
);

function fakeFetch(text: string, status = 200) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(text, { status }));
}

const gateway = (fetchImpl: ReturnType<typeof vi.fn>, extra: object = {}) =>
  new SriSoapGateway({ fetch: fetchImpl as unknown as typeof fetch, ...extra });

describe('SriSoapGateway', () => {
  describe('send (validarComprobante)', () => {
    it('RECIBIDA sin mensajes', async () => {
      const f = fakeFetch(RECIBIDA);
      await expect(gateway(f).send('<factura/>', '1')).resolves.toEqual({ status: 'RECIBIDA', messages: [] });
    });

    it('envía el XML en base64 dentro del sobre SOAP al endpoint de pruebas', async () => {
      const f = fakeFetch(RECIBIDA);
      const xml = '<?xml version="1.0"?><factura id="comprobante">ñandú & co</factura>';
      await gateway(f).send(xml, '1');
      expect(f).toHaveBeenCalledTimes(1);
      const [url, init] = f.mock.calls[0];
      expect(url).toBe(DEFAULT_SRI_ENDPOINTS['1'].reception);
      expect(url).toBe('https://celcer.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline');
      expect(init?.method).toBe('POST');
      expect((init?.headers as Record<string, string>)['Content-Type']).toBe('text/xml; charset=utf-8');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const body = String(init?.body);
      expect(body).toContain('xmlns:ec="http://ec.gob.sri.ws.recepcion"');
      expect(body).toContain('<ec:validarComprobante>');
      const b64 = /<xml>([^<]+)<\/xml>/.exec(body)![1];
      expect(Buffer.from(b64, 'base64').toString('utf8')).toBe(xml);
    });

    it('usa el endpoint de producción con ambiente 2', async () => {
      const f = fakeFetch(RECIBIDA);
      await gateway(f).send('<factura/>', '2');
      expect(f.mock.calls[0][0]).toBe(
        'https://cel.sri.gob.ec/comprobantes-electronicos-ws/RecepcionComprobantesOffline',
      );
    });

    it('DEVUELTA con mensajes (mensaje anidado dentro de mensaje)', async () => {
      const result = await gateway(fakeFetch(DEVUELTA)).send('<factura/>', '1');
      expect(result.status).toBe('DEVUELTA');
      expect(result.messages).toEqual([
        {
          identifier: '35',
          message: 'ARCHIVO NO CUMPLE ESTRUCTURA XML',
          additionalInfo: 'Se encontró el siguiente error en la estructura del comprobante: cvc-complex-type.2.4.a',
          type: 'ERROR',
        },
        { identifier: '43', message: 'CLAVE ACCESO REGISTRADA', additionalInfo: undefined, type: 'ADVERTENCIA' },
      ]);
    });

    it('mensaje sin campos usa valores por defecto', async () => {
      const xml = reception('DEVUELTA', '<comprobante><mensajes><mensaje></mensaje></mensajes></comprobante>');
      const result = await gateway(fakeFetch(xml)).send('<f/>', '1');
      expect(result.messages).toEqual([{ identifier: '', message: '', additionalInfo: undefined, type: 'ERROR' }]);
    });

    it('estado inesperado → SriCommunicationError', async () => {
      await expect(gateway(fakeFetch(reception('PROCESANDO', ''))).send('<f/>', '1')).rejects.toThrow(
        /Respuesta de recepción inesperada: estado "PROCESANDO"/,
      );
      await expect(gateway(fakeFetch(soap('<otra/>'))).send('<f/>', '1')).rejects.toThrow(SriCommunicationError);
    });

    it('SOAP Fault (HTTP 500) → SriCommunicationError con faultstring', async () => {
      const err = await gateway(fakeFetch(FAULT, 500))
        .send('<f/>', '1')
        .catch((e) => e);
      expect(err).toBeInstanceOf(SriCommunicationError);
      expect(err.message).toBe('SOAP Fault del SRI: java.lang.NullPointerException');
    });

    it('SOAP Fault sin faultstring', async () => {
      await expect(gateway(fakeFetch(soap('<soap:Fault/>'))).send('<f/>', '1')).rejects.toThrow(
        'SOAP Fault del SRI: desconocido',
      );
    });

    it('HTTP 500 sin Fault → SriCommunicationError', async () => {
      await expect(gateway(fakeFetch('Internal Server Error', 500)).send('<f/>', '1')).rejects.toThrow(
        'SRI respondió HTTP 500',
      );
      await expect(gateway(fakeFetch('<html>Bad gateway</html>', 502)).send('<f/>', '1')).rejects.toBeInstanceOf(
        SriCommunicationError,
      );
    });

    it('error de red → SriCommunicationError con cause', async () => {
      const network = new TypeError('fetch failed');
      const f = vi.fn(async () => {
        throw network;
      });
      const err = await gateway(f)
        .send('<f/>', '1')
        .catch((e) => e);
      expect(err).toBeInstanceOf(SriCommunicationError);
      expect(err.message).toBe('Error de comunicación con el SRI: fetch failed');
      expect(err.cause).toBe(network);
      expect(err.name).toBe('SriCommunicationError');
    });

    it('timeout real del AbortSignal → SriCommunicationError', async () => {
      const f = vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
          }),
      );
      const err = await gateway(f, { timeoutMs: 10 })
        .send('<f/>', '1')
        .catch((e) => e);
      expect(err).toBeInstanceOf(SriCommunicationError);
      expect(err.message).toMatch(/Error de comunicación con el SRI: .*(timed out|timeout|aborted)/i);
    });

    it('error leyendo el cuerpo → SriCommunicationError', async () => {
      const f = vi.fn(async () => ({
        ok: true,
        status: 200,
        text: async () => Promise.reject(new Error('socket hang up')),
      }));
      await expect(gateway(f).send('<f/>', '1')).rejects.toThrow(/socket hang up/);
    });
  });

  describe('authorize (autorizacionComprobante)', () => {
    it('AUTORIZADO con comprobante en CDATA', async () => {
      const f = fakeFetch(AUTORIZADO);
      const result = await gateway(f).authorize(KEY, '1');
      expect(result.status).toBe('AUTORIZADO');
      expect(result.authorizationNumber).toBe(KEY);
      expect(result.authorizationDate?.toISOString()).toBe('2026-10-13T20:06:18.000Z');
      expect(result.authorizedXml).toBe(
        '<?xml version="1.0"?><factura id="comprobante"><infoTributaria><ambiente>1</ambiente></infoTributaria></factura>',
      );
      expect(result.messages).toEqual([]);
    });

    it('envía la clave de acceso al endpoint de autorización según ambiente', async () => {
      const f = fakeFetch(AUTORIZADO);
      await gateway(f).authorize(KEY, '1');
      await gateway(f).authorize(KEY, '2');
      expect(f.mock.calls[0][0]).toBe(
        'https://celcer.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline',
      );
      expect(f.mock.calls[1][0]).toBe(
        'https://cel.sri.gob.ec/comprobantes-electronicos-ws/AutorizacionComprobantesOffline',
      );
      const body = String(f.mock.calls[0][1]?.body);
      expect(body).toContain('xmlns:ec="http://ec.gob.sri.ws.autorizacion"');
      expect(body).toContain(
        `<ec:autorizacionComprobante><claveAccesoComprobante>${KEY}</claveAccesoComprobante></ec:autorizacionComprobante>`,
      );
    });

    it('NO AUTORIZADO con mensajes', async () => {
      const result = await gateway(fakeFetch(NO_AUTORIZADO)).authorize(KEY, '1');
      expect(result.status).toBe('NO AUTORIZADO');
      expect(result.authorizationNumber).toBeUndefined();
      expect(result.messages).toEqual([
        {
          identifier: '39',
          message: 'FIRMA INVALIDA',
          additionalInfo: 'La firma es invalida [Firma inválida (firma y/o certificados alterados)]',
          type: 'ERROR',
        },
      ]);
    });

    it('sin autorizaciones → SIN_RESPUESTA', async () => {
      const result = await gateway(fakeFetch(authorizationResponse('', 0))).authorize(KEY, '1');
      expect(result).toEqual({ status: 'SIN_RESPUESTA', messages: [] });
    });

    it('con varias autorizaciones prima la AUTORIZADA', async () => {
      const xml = authorizationResponse(
        autorizacion('NO AUTORIZADO', '', `<mensajes>${mensaje('43', 'CLAVE ACCESO REGISTRADA')}</mensajes>`) +
          autorizacion('AUTORIZADO', AUTORIZADO_EXTRA),
        2,
      );
      const result = await gateway(fakeFetch(xml)).authorize(KEY, '1');
      expect(result.status).toBe('AUTORIZADO');
      expect(result.authorizationNumber).toBe(KEY);
      expect(result.messages).toEqual([]);
    });

    it('con varias autorizaciones sin AUTORIZADO toma la primera', async () => {
      const xml = authorizationResponse(autorizacion('EN PROCESO') + autorizacion('NO AUTORIZADO'), 2);
      const result = await gateway(fakeFetch(xml)).authorize(KEY, '1');
      expect(result.status).toBe('EN PROCESO');
      expect(result.authorizationDate).toBeUndefined();
      expect(result.authorizedXml).toBeUndefined();
    });

    it('estado desconocido se normaliza a SIN_RESPUESTA', async () => {
      const result = await gateway(fakeFetch(authorizationResponse(autorizacion('RARO')))).authorize(KEY, '1');
      expect(result.status).toBe('SIN_RESPUESTA');
    });

    it('SOAP Fault → SriCommunicationError', async () => {
      await expect(gateway(fakeFetch(FAULT, 500)).authorize(KEY, '1')).rejects.toBeInstanceOf(SriCommunicationError);
    });

    it('error de red → SriCommunicationError', async () => {
      const f = vi.fn(async () => {
        throw new Error('ECONNRESET');
      });
      await expect(gateway(f).authorize(KEY, '2')).rejects.toThrow(/ECONNRESET/);
    });
  });

  describe('configuración', () => {
    it('usa fetch global y timeout por defecto si no se inyectan', async () => {
      const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(RECIBIDA));
      try {
        await new SriSoapGateway().send('<f/>', '1');
        expect(spy).toHaveBeenCalledOnce();
      } finally {
        spy.mockRestore();
      }
    });

    it('acepta endpoints personalizados', async () => {
      const f = fakeFetch(RECIBIDA);
      const endpoints = {
        '1': { reception: 'http://local/rec', authorization: 'http://local/aut' },
        '2': { reception: 'http://prod/rec', authorization: 'http://prod/aut' },
      };
      await gateway(f, { endpoints }).send('<f/>', '2');
      expect(f.mock.calls[0][0]).toBe('http://prod/rec');
    });

    it('endpointsFromEnv quita ?wsdl y usa defaults si faltan variables', () => {
      const endpoints = endpointsFromEnv({
        SRI_RECEPCION_URL_PRUEBAS: 'https://celcer.example/RecepcionComprobantesOffline?wsdl',
        SRI_AUTORIZACION_URL_PRUEBAS: 'https://celcer.example/AutorizacionComprobantesOffline?WSDL',
        SRI_RECEPCION_URL_PRODUCCION: 'https://cel.example/Recepcion',
      });
      expect(endpoints).toEqual({
        '1': {
          reception: 'https://celcer.example/RecepcionComprobantesOffline',
          authorization: 'https://celcer.example/AutorizacionComprobantesOffline',
        },
        '2': {
          reception: 'https://cel.example/Recepcion',
          authorization: DEFAULT_SRI_ENDPOINTS['2'].authorization,
        },
      });
    });

    it('endpointsFromEnv sin variables devuelve los endpoints oficiales', () => {
      expect(endpointsFromEnv({})).toEqual(DEFAULT_SRI_ENDPOINTS);
    });
  });
});
