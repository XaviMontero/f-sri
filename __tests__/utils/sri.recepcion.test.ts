import axios from 'axios';
import { enviarComprobanteSRI } from '../../src/utils/sri.utils';

jest.mock('axios');
const axiosMock = axios as jest.Mocked<typeof axios>;

const XML_FIRMADO = '<factura id="comprobante">firmada</factura>';

const respuestaRecibida = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns2:validarComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.recepcion">
      <RespuestaRecepcionComprobante>
        <estado>RECIBIDA</estado>
        <comprobantes/>
      </RespuestaRecepcionComprobante>
    </ns2:validarComprobanteResponse>
  </soap:Body>
</soap:Envelope>`;

const respuestaDevuelta = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <ns2:validarComprobanteResponse xmlns:ns2="http://ec.gob.sri.ws.recepcion">
      <RespuestaRecepcionComprobante>
        <estado>DEVUELTA</estado>
        <comprobantes>
          <comprobante>
            <claveAcceso>1705202501179001234500110010010000000011234567810</claveAcceso>
            <mensajes>
              <mensaje>
                <identificador>35</identificador>
                <mensaje>ARCHIVO NO CUMPLE ESTRUCTURA XML</mensaje>
                <informacionAdicional>detalle del error</informacionAdicional>
                <tipo>ERROR</tipo>
              </mensaje>
            </mensajes>
          </comprobante>
        </comprobantes>
      </RespuestaRecepcionComprobante>
    </ns2:validarComprobanteResponse>
  </soap:Body>
</soap:Envelope>`;

const respuestaSoapFault = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>soap:Client</faultcode>
      <faultstring>Cannot process request</faultstring>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>`;

describe('enviarComprobanteSRI', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses a RECIBIDA response', async () => {
    axiosMock.post.mockResolvedValueOnce({ data: respuestaRecibida } as any);

    const resultado = await enviarComprobanteSRI(XML_FIRMADO);

    expect(resultado.estado).toBe('RECIBIDA');
  });

  it('sends the signed XML as base64 to the recepción service', async () => {
    axiosMock.post.mockResolvedValueOnce({ data: respuestaRecibida } as any);

    await enviarComprobanteSRI(XML_FIRMADO);

    const [url, body] = axiosMock.post.mock.calls[0];
    expect(url).toContain('RecepcionComprobantesOffline');
    expect(body).toContain(Buffer.from(XML_FIRMADO).toString('base64'));
    expect(body).toContain('validarComprobante');
  });

  it('parses a DEVUELTA response with mensajes and comprobantes', async () => {
    axiosMock.post.mockResolvedValueOnce({ data: respuestaDevuelta } as any);

    const resultado = await enviarComprobanteSRI(XML_FIRMADO);

    expect(resultado.estado).toBe('DEVUELTA');
    expect(resultado.mensajes).toBeDefined();
    expect((resultado.mensajes as any).mensaje.identificador).toBe('35');
    expect((resultado.mensajes as any).mensaje.informacionAdicional).toBe('detalle del error');
    expect(resultado.comprobantes?.comprobante?.[0].claveAcceso).toContain('1705202501');
  });

  it('tries the next SOAPAction when the first returns a SOAP fault', async () => {
    axiosMock.post
      .mockResolvedValueOnce({ data: respuestaSoapFault } as any)
      .mockResolvedValueOnce({ data: respuestaRecibida } as any);

    const resultado = await enviarComprobanteSRI(XML_FIRMADO);

    expect(resultado.estado).toBe('RECIBIDA');
    expect(axiosMock.post).toHaveBeenCalledTimes(2);
  });

  it('returns ERROR_COMUNICACION when every SOAPAction fails', async () => {
    axiosMock.post.mockRejectedValue(new Error('ECONNREFUSED'));

    const resultado = await enviarComprobanteSRI(XML_FIRMADO);

    expect(resultado.estado).toBe('ERROR_COMUNICACION');
  });

  it('returns ERROR_COMUNICACION when the response is not a string', async () => {
    axiosMock.post.mockResolvedValue({ data: { unexpected: true } } as any);

    const resultado = await enviarComprobanteSRI(XML_FIRMADO);

    expect(resultado.estado).toBe('ERROR_COMUNICACION');
  });
});
