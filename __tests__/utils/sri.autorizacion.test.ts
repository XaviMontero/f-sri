import axios from 'axios';
import { autorizarComprobanteSRI } from '../../src/utils/sri.utils';

jest.mock('axios');
const axiosMock = axios as jest.Mocked<typeof axios>;

const CLAVE_ACCESO = '1705202504179001234500110010010000000011234567810';

const respuestaAutorizado = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion">
      <RespuestaAutorizacionComprobante>
        <claveAccesoConsultada>${CLAVE_ACCESO}</claveAccesoConsultada>
        <numeroComprobantes>1</numeroComprobantes>
        <autorizaciones>
          <autorizacion>
            <estado>AUTORIZADO</estado>
            <numeroAutorizacion>${CLAVE_ACCESO}</numeroAutorizacion>
            <fechaAutorizacion>2025-05-17T12:00:00-05:00</fechaAutorizacion>
            <ambiente>PRUEBAS</ambiente>
            <comprobante><![CDATA[<notaCredito/>]]></comprobante>
          </autorizacion>
        </autorizaciones>
      </RespuestaAutorizacionComprobante>
    </ns2:autorizacionComprobanteResponse>
  </soap:Body>
</soap:Envelope>`;

const respuestaNoAutorizado = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion">
      <RespuestaAutorizacionComprobante>
        <autorizaciones>
          <autorizacion>
            <estado>NO AUTORIZADO</estado>
            <fechaAutorizacion>2025-05-17T12:00:00-05:00</fechaAutorizacion>
            <ambiente>PRUEBAS</ambiente>
            <mensajes>
              <mensaje>
                <identificador>58</identificador>
                <mensaje>CLAVE ACCESO REGISTRADA</mensaje>
                <tipo>ERROR</tipo>
              </mensaje>
            </mensajes>
          </autorizacion>
        </autorizaciones>
      </RespuestaAutorizacionComprobante>
    </ns2:autorizacionComprobanteResponse>
  </soap:Body>
</soap:Envelope>`;

const respuestaEnProceso = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns2:autorizacionComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.autorizacion">
      <RespuestaAutorizacionComprobante>
        <claveAccesoConsultada>${CLAVE_ACCESO}</claveAccesoConsultada>
        <numeroComprobantes>0</numeroComprobantes>
        <autorizaciones/>
      </RespuestaAutorizacionComprobante>
    </ns2:autorizacionComprobanteResponse>
  </soap:Body>
</soap:Envelope>`;

describe('autorizarComprobanteSRI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses an AUTORIZADO response', async () => {
    axiosMock.post.mockResolvedValueOnce({ data: respuestaAutorizado } as any);

    const resultado = await autorizarComprobanteSRI(CLAVE_ACCESO);

    expect(resultado.estado).toBe('AUTORIZADO');
    expect(resultado.numeroAutorizacion).toBe(CLAVE_ACCESO);
    expect(resultado.fechaAutorizacion).toBe('2025-05-17T12:00:00-05:00');
    expect(resultado.ambiente).toBe('PRUEBAS');
  });

  it('sends the claveAcceso to the authorization SOAP service', async () => {
    axiosMock.post.mockResolvedValueOnce({ data: respuestaAutorizado } as any);

    await autorizarComprobanteSRI(CLAVE_ACCESO);

    const [url, body] = axiosMock.post.mock.calls[0];
    expect(url).toContain('AutorizacionComprobantesOffline');
    expect(body).toContain(`<claveAccesoComprobante>${CLAVE_ACCESO}</claveAccesoComprobante>`);
    expect(body).toContain('http://ec.gob.sri.ws.autorizacion');
  });

  it('parses a NO AUTORIZADO response with its mensajes', async () => {
    axiosMock.post.mockResolvedValueOnce({ data: respuestaNoAutorizado } as any);

    const resultado = await autorizarComprobanteSRI(CLAVE_ACCESO);

    expect(resultado.estado).toBe('NO AUTORIZADO');
    expect(resultado.mensajes).toBeDefined();
    expect((resultado.mensajes as any).mensaje.identificador).toBe('58');
  });

  it('returns EN PROCESO when the SRI has not resolved the receipt yet', async () => {
    axiosMock.post.mockResolvedValueOnce({ data: respuestaEnProceso } as any);

    const resultado = await autorizarComprobanteSRI(CLAVE_ACCESO);

    expect(resultado.estado).toBe('EN PROCESO');
  });

  it('returns ERROR_COMUNICACION when the service is unreachable', async () => {
    axiosMock.post.mockRejectedValue(new Error('ECONNREFUSED'));

    const resultado = await autorizarComprobanteSRI(CLAVE_ACCESO);

    expect(resultado.estado).toBe('ERROR_COMUNICACION');
  });
});
