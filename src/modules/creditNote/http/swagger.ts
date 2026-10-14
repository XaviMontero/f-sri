const TAG = 'Credit Note';
const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'string' } };

const detalle = {
  type: 'object',
  properties: {
    detalle: {
      type: 'object',
      properties: {
        codigoInterno: { type: 'string', example: 'PRD001', maxLength: 25 },
        codigoAdicional: { type: 'string', example: 'AUX001' },
        descripcion: {
          type: 'string',
          example: 'Servicio de prueba',
          description: 'Opcional si el producto existe en el catálogo',
        },
        cantidad: { type: 'string', example: '1' },
        precioUnitario: { type: 'string', example: '10.00', description: 'Opcional si el producto existe' },
        descuento: { type: 'string', example: '0.00' },
        precioTotalSinImpuesto: {
          type: 'string',
          example: '10.00',
          description: 'Opcional: si se envía debe coincidir con cantidad × precio − descuento',
        },
        impuestos: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              impuesto: {
                type: 'object',
                properties: {
                  codigo: { type: 'string', example: '2', description: 'Tabla 16: solo IVA (2)' },
                  codigoPorcentaje: { type: 'string', example: '4', description: 'Tabla 17 (4 = 15%, 0 = 0%)' },
                  tarifa: { type: 'string', example: '15', description: 'Ignorado: se deriva de codigoPorcentaje' },
                  baseImponible: { type: 'string', example: '10.00', description: 'Ignorado: se calcula' },
                  valor: { type: 'string', example: '1.50', description: 'Ignorado: se calcula' },
                },
              },
            },
          },
        },
      },
      required: ['codigoInterno', 'cantidad'],
    },
  },
  required: ['detalle'],
};

const notaCreditoComplete = {
  type: 'object',
  required: ['nota_credito'],
  properties: {
    nota_credito: {
      type: 'object',
      required: ['infoTributaria', 'infoNotaCredito', 'detalles'],
      properties: {
        infoTributaria: {
          type: 'object',
          required: ['ruc'],
          properties: { ruc: { type: 'string', example: '0106079783001' } },
        },
        infoNotaCredito: {
          type: 'object',
          required: [
            'tipoIdentificacionComprador',
            'identificacionComprador',
            'codDocModificado',
            'numDocModificado',
            'fechaEmisionDocSustento',
            'motivo',
          ],
          properties: {
            fechaEmision: { type: 'string', example: '13/10/2026', description: 'dd/mm/aaaa; por defecto hoy' },
            tipoIdentificacionComprador: { type: 'string', example: '05', description: 'Tabla 6 (no 07)' },
            identificacionComprador: { type: 'string', example: '0106079783' },
            razonSocialComprador: { type: 'string', example: 'MONTERO CAMPOVERDE OSCAR XAVIER' },
            codDocModificado: { type: 'string', example: '01', description: '01 factura, 03 liquidación, 05 ND' },
            numDocModificado: { type: 'string', example: '001-001-000000001' },
            fechaEmisionDocSustento: { type: 'string', example: '13/10/2026' },
            totalSinImpuestos: { type: 'string', example: '10.00', description: 'Opcional: se valida' },
            valorModificacion: { type: 'string', example: '11.50', description: 'Opcional: se valida' },
            moneda: { type: 'string', example: 'DOLAR' },
            motivo: { type: 'string', example: 'DEVOLUCION DE MERCADERIA' },
          },
        },
        detalles: { type: 'array', items: detalle },
        infoAdicional: { type: 'object', additionalProperties: { type: 'string' }, example: { Email: 'a@b.com' } },
      },
    },
  },
};

/** Rutas OpenAPI del módulo de notas de crédito (montado en `/api/v1/credit-note`). */
export const creditNoteSwaggerPaths: Record<string, unknown> = {
  '/api/v1/credit-note': {
    get: { tags: [TAG], summary: 'Listar notas de crédito de la empresa', responses: { '200': { description: 'OK' } } },
  },
  '/api/v1/credit-note/complete': {
    post: {
      tags: [TAG],
      summary: 'Emitir nota de crédito (codDoc 04): totales, XML 1.1.0, firma, recepción y autorización SRI',
      parameters: [
        {
          name: 'esperar',
          in: 'query',
          required: false,
          schema: { type: 'boolean' },
          description: 'Si es true, responde cuando el SRI autoriza o rechaza',
        },
      ],
      requestBody: { required: true, content: { 'application/json': { schema: notaCreditoComplete } } },
      responses: {
        '201': { description: 'Nota de crédito creada (data.estado: PENDIENTE, AUTORIZADO, DEVUELTA…)' },
        '400': { description: 'Datos inválidos o totales que no coinciden con los calculados' },
        '403': { description: 'El RUC no pertenece a la empresa del token' },
      },
    },
  },
  '/api/v1/credit-note/{id}': {
    get: {
      tags: [TAG],
      summary: 'Obtener nota de crédito',
      parameters: [idParam],
      responses: { '200': { description: 'OK' } },
    },
    delete: {
      tags: [TAG],
      summary: 'Eliminar borrador (no autorizada)',
      parameters: [idParam],
      responses: { '200': { description: 'Eliminada' }, '409': { description: 'Autorizada: no se elimina' } },
    },
  },
  '/api/v1/credit-note/{id}/enviar': {
    post: {
      tags: [TAG],
      summary: 'Reintentar firma/envío/autorización (idempotente)',
      parameters: [idParam],
      responses: { '200': { description: 'Estado actualizado' } },
    },
  },
  '/api/v1/credit-note/{id}/estado': {
    get: { tags: [TAG], summary: 'Estado SRI', parameters: [idParam], responses: { '200': { description: 'OK' } } },
  },
  '/api/v1/credit-note/{id}/xml': {
    get: {
      tags: [TAG],
      summary: 'XML (autorizado, firmado o sin firmar)',
      parameters: [idParam],
      responses: { '200': { description: 'application/xml' } },
    },
  },
  '/api/v1/credit-note/{id}/pdf': {
    get: {
      tags: [TAG],
      summary: 'Metadatos y URL del RIDE',
      parameters: [idParam],
      responses: { '200': { description: 'OK' } },
    },
    post: {
      tags: [TAG],
      summary: '(Re)generar el RIDE de una nota autorizada',
      parameters: [idParam],
      responses: { '200': { description: 'OK' }, '409': { description: 'No autorizada' } },
    },
  },
};
