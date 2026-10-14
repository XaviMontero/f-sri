const idParam = [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }];
const tags = ['Delivery Note (Guía de Remisión)'];

const detalle = {
  type: 'object',
  required: ['descripcion', 'cantidad'],
  properties: {
    codigoInterno: { type: 'string', maxLength: 25, example: 'PRD001' },
    codigoAdicional: { type: 'string', maxLength: 25 },
    descripcion: { type: 'string', example: 'Servicio de prueba' },
    cantidad: { oneOf: [{ type: 'string' }, { type: 'number' }], description: '> 0, hasta 6 decimales', example: '1' },
  },
};

const destinatario = {
  type: 'object',
  required: ['identificacionDestinatario', 'razonSocialDestinatario', 'dirDestinatario', 'motivoTraslado', 'detalles'],
  properties: {
    identificacionDestinatario: { type: 'string', example: '0106079783' },
    razonSocialDestinatario: { type: 'string' },
    dirDestinatario: { type: 'string' },
    motivoTraslado: { type: 'string', example: 'VENTA' },
    docAduaneroUnico: { type: 'string', maxLength: 20 },
    codEstabDestino: { type: 'string', pattern: '^\\d{3}$' },
    ruta: { type: 'string', example: 'CUENCA - QUITO' },
    codDocSustento: { type: 'string', description: 'Tabla 3 (01 = factura)', example: '01' },
    numDocSustento: { type: 'string', pattern: '^\\d{3}-\\d{3}-\\d{9}$', example: '001-001-000000001' },
    numAutDocSustento: { type: 'string', description: '10, 37 o 49 dígitos' },
    fechaEmisionDocSustento: { type: 'string', example: '13/10/2026' },
    detalles: { type: 'array', minItems: 1, items: { type: 'object', properties: { detalle } } },
  },
};

const requestBody = {
  required: true,
  content: {
    'application/json': {
      schema: {
        type: 'object',
        required: ['guia_remision'],
        properties: {
          guia_remision: {
            type: 'object',
            required: ['infoTributaria', 'infoGuiaRemision', 'destinatarios'],
            properties: {
              infoTributaria: {
                type: 'object',
                required: ['ruc'],
                properties: { ruc: { type: 'string', example: '0106079783001' } },
              },
              infoGuiaRemision: {
                type: 'object',
                required: [
                  'dirPartida',
                  'razonSocialTransportista',
                  'tipoIdentificacionTransportista',
                  'rucTransportista',
                  'fechaIniTransporte',
                  'fechaFinTransporte',
                  'placa',
                ],
                properties: {
                  fechaEmision: {
                    type: 'string',
                    description: 'dd/mm/aaaa; por defecto hoy (Ecuador). Solo entra en la clave de acceso.',
                  },
                  dirPartida: { type: 'string' },
                  razonSocialTransportista: { type: 'string' },
                  tipoIdentificacionTransportista: { type: 'string', enum: ['04', '05', '06', '08'] },
                  rucTransportista: { type: 'string' },
                  fechaIniTransporte: { type: 'string', example: '13/10/2026' },
                  fechaFinTransporte: { type: 'string', example: '13/10/2026', description: '>= fechaIniTransporte' },
                  placa: { type: 'string', example: 'ABC1234' },
                },
              },
              destinatarios: {
                type: 'array',
                minItems: 1,
                items: { type: 'object', properties: { destinatario } },
              },
              infoAdicional: { type: 'object', additionalProperties: { type: 'string' } },
            },
          },
        },
      },
    },
  },
};

/** Fragmento OpenAPI de `/api/v1/delivery-note`. */
export const deliveryGuideSwaggerPaths: Record<string, unknown> = {
  '/api/v1/delivery-note': {
    get: { tags, summary: 'Listar guías de remisión de la empresa', responses: { '200': { description: 'OK' } } },
  },
  '/api/v1/delivery-note/complete': {
    post: {
      tags,
      summary: 'Emitir guía de remisión (codDoc 06): XML 1.1.0, firma, envío y autorización SRI',
      parameters: [
        {
          name: 'esperar',
          in: 'query',
          required: false,
          schema: { type: 'boolean' },
          description: 'true = espera la respuesta del SRI antes de responder',
        },
      ],
      requestBody,
      responses: {
        '201': { description: 'Creada (y procesada si esperar=true)' },
        '400': { description: 'Error de validación' },
        '403': { description: 'Emisor de otra empresa' },
      },
    },
  },
  '/api/v1/delivery-note/{id}': {
    get: {
      tags,
      summary: 'Obtener guía de remisión',
      parameters: idParam,
      responses: { '200': { description: 'OK' }, '404': { description: 'No encontrada' } },
    },
    delete: {
      tags,
      summary: 'Eliminar guía no autorizada',
      parameters: idParam,
      responses: { '200': { description: 'Eliminada' }, '409': { description: 'Autorizada: no se elimina' } },
    },
  },
  '/api/v1/delivery-note/{id}/enviar': {
    post: {
      tags,
      summary: 'Reintentar envío al SRI',
      parameters: idParam,
      responses: { '200': { description: 'OK' } },
    },
  },
  '/api/v1/delivery-note/{id}/estado': {
    get: { tags, summary: 'Estado SRI de la guía', parameters: idParam, responses: { '200': { description: 'OK' } } },
  },
  '/api/v1/delivery-note/{id}/xml': {
    get: {
      tags,
      summary: 'XML (autorizado, firmado o generado)',
      parameters: idParam,
      responses: { '200': { description: 'XML' } },
    },
  },
  '/api/v1/delivery-note/{id}/pdf': {
    get: {
      tags,
      summary: 'RIDE (PDF) de la guía',
      parameters: idParam,
      responses: { '200': { description: 'OK' }, '404': { description: 'Sin PDF' } },
    },
    post: {
      tags,
      summary: 'Regenerar el RIDE (solo autorizadas)',
      parameters: idParam,
      responses: { '200': { description: 'OK' }, '409': { description: 'No autorizada' } },
    },
  },
};
