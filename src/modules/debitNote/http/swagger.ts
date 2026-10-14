/** Fragmento OpenAPI (`paths`) del módulo de notas de débito; los esquemas van en línea. */
const idParam = [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }];
const security = [{ bearerAuth: [] }];
const tags = ['Nota de Débito'];

const notaDebitoBody = {
  type: 'object',
  required: ['nota_debito'],
  properties: {
    nota_debito: {
      type: 'object',
      required: ['infoTributaria', 'infoNotaDebito', 'motivos'],
      properties: {
        infoTributaria: {
          type: 'object',
          required: ['ruc'],
          properties: { ruc: { type: 'string', example: '0106079783001' } },
        },
        infoNotaDebito: {
          type: 'object',
          required: [
            'tipoIdentificacionComprador',
            'identificacionComprador',
            'codDocModificado',
            'numDocModificado',
            'fechaEmisionDocSustento',
          ],
          properties: {
            fechaEmision: { type: 'string', example: '13/10/2026', description: 'dd/mm/aaaa; por defecto hoy' },
            tipoIdentificacionComprador: { type: 'string', example: '05' },
            identificacionComprador: { type: 'string', example: '0106079783' },
            razonSocialComprador: {
              type: 'string',
              description: 'Requerida si el comprador no está registrado como cliente',
            },
            direccionComprador: { type: 'string' },
            emailComprador: { type: 'string' },
            telefonoComprador: { type: 'string' },
            codDocModificado: { type: 'string', example: '01', description: 'Tabla 3 (01 = factura)' },
            numDocModificado: { type: 'string', example: '001-001-000000123' },
            fechaEmisionDocSustento: { type: 'string', example: '01/10/2026' },
            totalSinImpuestos: { type: 'string', description: 'Opcional; si se envía, debe coincidir con el cálculo' },
            impuestos: {
              type: 'array',
              description:
                'Opcional. Define la tarifa de IVA de los motivos (si hay varias, con baseImponible) y valida los importes',
              items: {
                type: 'object',
                properties: {
                  impuesto: {
                    type: 'object',
                    required: ['codigoPorcentaje'],
                    properties: {
                      codigo: { type: 'string', example: '2' },
                      codigoPorcentaje: { type: 'string', example: '4' },
                      tarifa: { type: 'string', example: '15' },
                      baseImponible: { type: 'string', example: '2.00' },
                      valor: { type: 'string', example: '0.30' },
                    },
                  },
                },
              },
            },
            valorTotal: { type: 'string', description: 'Opcional; si se envía, debe coincidir con el cálculo' },
            pagos: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  pago: {
                    type: 'object',
                    required: ['formaPago', 'total'],
                    properties: {
                      formaPago: { type: 'string', example: '01' },
                      total: { type: 'string', example: '2.30' },
                      plazo: { type: 'string', example: '0' },
                      unidadTiempo: { type: 'string', example: 'dias' },
                    },
                  },
                },
              },
            },
          },
        },
        motivos: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              motivo: {
                type: 'object',
                required: ['razon', 'valor'],
                properties: {
                  razon: { type: 'string', example: 'Interés por mora' },
                  valor: { type: 'string', example: '2.00' },
                  codigoPorcentaje: { type: 'string', description: 'Opcional: tarifa de IVA de este motivo' },
                },
              },
            },
          },
        },
        infoAdicional: { type: 'object', additionalProperties: { type: 'string' } },
      },
    },
  },
};

export const debitNoteSwaggerPaths: Record<string, unknown> = {
  '/api/v1/debit-note': {
    get: {
      tags,
      security,
      summary: 'Listar notas de débito de la empresa',
      responses: { '200': { description: 'OK' } },
    },
  },
  '/api/v1/debit-note/complete': {
    post: {
      tags,
      security,
      summary: 'Emitir nota de débito (codDoc 05): XML, firma, envío y autorización SRI',
      description:
        'Totales calculados en el servidor a partir de los motivos. Con `?esperar=true` responde tras la autorización; si no, el envío es asíncrono.',
      parameters: [{ name: 'esperar', in: 'query', required: false, schema: { type: 'boolean' } }],
      requestBody: { required: true, content: { 'application/json': { schema: notaDebitoBody } } },
      responses: {
        '201': { description: 'Creada (y procesada si esperar=true)' },
        '400': { description: 'Error de validación' },
        '403': { description: 'Emisor de otra empresa' },
      },
    },
  },
  '/api/v1/debit-note/{id}': {
    get: {
      tags,
      security,
      summary: 'Obtener nota de débito',
      parameters: idParam,
      responses: { '200': { description: 'OK' }, '404': { description: 'No encontrada' } },
    },
    delete: {
      tags,
      security,
      summary: 'Eliminar borrador de nota de débito (no autorizada)',
      parameters: idParam,
      responses: { '200': { description: 'Eliminada' }, '409': { description: 'Autorizada: no se elimina' } },
    },
  },
  '/api/v1/debit-note/{id}/enviar': {
    post: {
      tags,
      security,
      summary: 'Reintentar firma/envío/autorización',
      parameters: idParam,
      responses: { '200': { description: 'OK' } },
    },
  },
  '/api/v1/debit-note/{id}/estado': {
    get: {
      tags,
      security,
      summary: 'Estado SRI de la nota de débito',
      parameters: idParam,
      responses: { '200': { description: 'OK' } },
    },
  },
  '/api/v1/debit-note/{id}/xml': {
    get: {
      tags,
      security,
      summary: 'XML (autorizado, firmado o generado)',
      parameters: idParam,
      responses: { '200': { description: 'XML' } },
    },
  },
  '/api/v1/debit-note/{id}/pdf': {
    get: {
      tags,
      security,
      summary: 'RIDE (metadatos y URL)',
      parameters: idParam,
      responses: { '200': { description: 'OK' }, '404': { description: 'Sin PDF' } },
    },
    post: {
      tags,
      security,
      summary: 'Regenerar RIDE (solo autorizadas)',
      parameters: idParam,
      responses: { '200': { description: 'OK' }, '409': { description: 'No autorizada' } },
    },
  },
};
