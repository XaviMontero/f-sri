const TAG_CRUD = 'Withholding CRUD';
const TAG_PROCESSING = 'Withholding Processing';
const security = [{ bearerAuth: [] }];
const idParam = [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }];

const item = (key: string, properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties: { [key]: { type: 'object', properties, required } },
  required: [key],
});

/** Esquema del payload `{ retencion: {...} }` (nombres de la ficha técnica, ATS 2.0.0). */
const retencionSchema = {
  type: 'object',
  required: ['retencion'],
  properties: {
    retencion: {
      type: 'object',
      required: ['infoTributaria', 'infoCompRetencion', 'docsSustento'],
      properties: {
        infoTributaria: {
          type: 'object',
          required: ['ruc'],
          properties: { ruc: { type: 'string', example: '0106079783001' } },
        },
        infoCompRetencion: {
          type: 'object',
          required: ['tipoIdentificacionSujetoRetenido', 'razonSocialSujetoRetenido', 'identificacionSujetoRetenido'],
          properties: {
            fechaEmision: { type: 'string', example: '13/10/2026', description: 'dd/mm/aaaa; por defecto hoy' },
            tipoIdentificacionSujetoRetenido: {
              type: 'string',
              example: '05',
              description: 'Tabla 6: 04 RUC, 05 cédula, 06 pasaporte, 08 exterior',
            },
            tipoSujetoRetenido: {
              type: 'string',
              example: '01',
              description: 'Tabla 14 ATS (01 persona natural, 02 sociedad). Obligatorio con identificación 08',
            },
            parteRel: { type: 'string', example: 'NO', description: 'Parte relacionada SI/NO (por defecto NO)' },
            razonSocialSujetoRetenido: { type: 'string', example: 'MONTERO CAMPOVERDE OSCAR XAVIER' },
            identificacionSujetoRetenido: { type: 'string', example: '0106079783' },
            periodoFiscal: {
              type: 'string',
              example: '10/2026',
              description: 'mm/aaaa; por defecto el mes de emisión',
            },
          },
        },
        docsSustento: {
          type: 'array',
          items: item(
            'docSustento',
            {
              codSustento: { type: 'string', example: '01', description: 'Tabla 5 ATS' },
              codDocSustento: { type: 'string', example: '01', description: 'Tabla 4 ATS (01 factura)' },
              numDocSustento: { type: 'string', example: '001009000000001', description: '15 dígitos' },
              fechaEmisionDocSustento: { type: 'string', example: '13/10/2026' },
              fechaRegistroContable: { type: 'string', example: '13/10/2026' },
              numAutDocSustento: { type: 'string', description: '10, 37 o 49 dígitos' },
              pagoLocExt: { type: 'string', example: '01', description: 'Tabla 15 ATS; solo 01 (pago local)' },
              totalSinImpuestos: { type: 'string', example: '10.00' },
              importeTotal: {
                type: 'string',
                example: '11.50',
                description: 'Debe ser totalSinImpuestos + Σ valorImpuesto y coincidir con Σ pagos',
              },
              impuestosDocSustento: {
                type: 'array',
                items: item(
                  'impuestoDocSustento',
                  {
                    codImpuestoDocSustento: { type: 'string', example: '2', description: 'Tabla 16 (2 = IVA)' },
                    codigoPorcentaje: { type: 'string', example: '4', description: 'Tabla 17/18' },
                    baseImponible: { type: 'string', example: '10.00' },
                    tarifa: { type: 'string', example: '15', description: 'Opcional para IVA (sale del código)' },
                    valorImpuesto: { type: 'string', example: '1.50', description: 'Se calcula; si viene se valida' },
                  },
                  ['codImpuestoDocSustento', 'codigoPorcentaje', 'baseImponible'],
                ),
              },
              retenciones: {
                type: 'array',
                items: item(
                  'retencion',
                  {
                    codigo: { type: 'string', example: '1', description: 'Tabla 19: 1 renta, 2 IVA, 6 ISD' },
                    codigoRetencion: { type: 'string', example: '303', description: 'Tablas 20/21' },
                    baseImponible: { type: 'string', example: '10.00' },
                    porcentajeRetener: { type: 'string', example: '10' },
                    valorRetenido: {
                      type: 'string',
                      example: '1.00',
                      description: 'Se calcula como base × porcentaje / 100; si viene se valida',
                    },
                  },
                  ['codigo', 'codigoRetencion', 'baseImponible', 'porcentajeRetener'],
                ),
              },
              pagos: {
                type: 'array',
                items: item(
                  'pago',
                  {
                    formaPago: { type: 'string', example: '01', description: 'Tabla 13 ATS' },
                    total: { type: 'string', example: '11.50' },
                  },
                  ['formaPago', 'total'],
                ),
              },
            },
            [
              'codSustento',
              'codDocSustento',
              'fechaEmisionDocSustento',
              'totalSinImpuestos',
              'importeTotal',
              'impuestosDocSustento',
              'retenciones',
              'pagos',
            ],
          ),
        },
        infoAdicional: { type: 'object', additionalProperties: { type: 'string' }, description: 'Máximo 15 campos' },
      },
    },
  },
};

/** Fragmento OpenAPI `paths` del módulo de retenciones. */
export const withholdingSwaggerPaths: Record<string, unknown> = {
  '/api/v1/withholding': {
    get: {
      tags: [TAG_CRUD],
      summary: 'Listar comprobantes de retención de la empresa del token (sin XML)',
      security,
      responses: { '200': { description: 'OK' } },
    },
  },
  '/api/v1/withholding/complete': {
    post: {
      tags: [TAG_PROCESSING],
      summary: 'Emitir comprobante de retención ATS 2.0.0 (codDoc 07): XML, firma, recepción y autorización SRI',
      security,
      parameters: [
        {
          name: 'esperar',
          in: 'query',
          required: false,
          schema: { type: 'boolean' },
          description: 'Si es true, responde cuando el SRI autoriza o rechaza; si no, el envío sigue en segundo plano',
        },
      ],
      requestBody: { required: true, content: { 'application/json': { schema: retencionSchema } } },
      responses: {
        '201': { description: 'Retención creada (data.estado: PENDIENTE, AUTORIZADO, DEVUELTA…)' },
        '400': { description: 'Datos inválidos o valores que no coinciden con los calculados' },
        '403': { description: 'El RUC no pertenece a la empresa del token' },
      },
    },
  },
  '/api/v1/withholding/{id}/enviar': {
    post: {
      tags: [TAG_PROCESSING],
      summary: 'Reintentar firma/envío/autorización (idempotente)',
      security,
      parameters: idParam,
      responses: { '200': { description: 'Estado actualizado' }, '404': { description: 'No encontrada' } },
    },
  },
  '/api/v1/withholding/{id}/estado': {
    get: {
      tags: [TAG_PROCESSING],
      summary: 'Estado SRI, número/fecha de autorización y mensajes',
      security,
      parameters: idParam,
      responses: { '200': { description: 'OK' } },
    },
  },
  '/api/v1/withholding/{id}/xml': {
    get: {
      tags: [TAG_PROCESSING],
      summary: 'Descargar el XML autorizado (o firmado si aún no se autoriza)',
      security,
      parameters: idParam,
      responses: { '200': { description: 'application/xml' } },
    },
  },
  '/api/v1/withholding/{id}/pdf': {
    get: {
      tags: [TAG_PROCESSING],
      summary: 'Metadatos y URL del RIDE',
      security,
      parameters: idParam,
      responses: { '200': { description: 'OK' }, '404': { description: 'PDF not found' } },
    },
    post: {
      tags: [TAG_PROCESSING],
      summary: '(Re)generar el RIDE de una retención autorizada',
      security,
      parameters: idParam,
      responses: { '200': { description: 'OK' }, '409': { description: 'No autorizada' } },
    },
  },
  '/api/v1/withholding/{id}': {
    get: {
      tags: [TAG_CRUD],
      summary: 'Obtener comprobante de retención',
      security,
      parameters: idParam,
      responses: { '200': { description: 'OK' }, '404': { description: 'No encontrada' } },
    },
    delete: {
      tags: [TAG_CRUD],
      summary: 'Eliminar un borrador (una retención autorizada no se elimina)',
      security,
      parameters: idParam,
      responses: { '200': { description: 'Deleted' }, '409': { description: 'Autorizada' } },
    },
  },
};
