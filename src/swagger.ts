export default {
  openapi: '3.0.0',
  info: {
    title: 'Sistema de Facturación Electrónica API',
    version: '1.0.0',
    description:
      'API completa para el Sistema de Facturación Electrónica con integración al SRI Ecuador. Incluye generación automática de PDFs cuando el SRI confirma la recepción de facturas.',
  },
  paths: {
    '/register': {
      post: {
        tags: ['Autenticación y Usuarios'],
        summary: 'Registrar usuario y empresa',
        description:
          'Crea un usuario y su empresa asociada. Requiere clave maestra para el primer registro o código de invitación para registros posteriores.',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UserRegistration' },
            },
          },
        },
        responses: {
          '201': {
            description: 'Usuario y empresa creados exitosamente',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                    token: { type: 'string' },
                    user: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        email: { type: 'string' },
                      },
                    },
                    company: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        ruc: { type: 'string' },
                        razon_social: { type: 'string' },
                        nombre_comercial: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Datos requeridos faltantes o formato de RUC inválido' },
          '403': { description: 'Clave maestra o código de invitación inválido' },
          '409': { description: 'Usuario o empresa ya existe' },
          '500': { description: 'Error del servidor' },
        },
      },
    },
    '/auth': {
      post: {
        tags: ['Autenticación y Usuarios'],
        summary: 'Autenticar usuario',
        description: 'Autentica un usuario existente y devuelve token JWT con información de usuario y empresa.',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/AuthPayload' } },
          },
        },
        responses: {
          '200': {
            description: 'Autenticación exitosa',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    token: { type: 'string' },
                    user: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        email: { type: 'string' },
                      },
                    },
                    company: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        ruc: { type: 'string' },
                        razon_social: { type: 'string' },
                        nombre_comercial: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
          '400': { description: 'Email y contraseña requeridos' },
          '401': { description: 'Credenciales inválidas' },
          '500': { description: 'Error del servidor' },
        },
      },
    },
    '/status': {
      get: {
        tags: ['Autenticación y Usuarios'],
        summary: 'Estado del sistema de registro',
        description: 'Consulta el estado actual del sistema de registro y los requisitos de seguridad.',
        responses: {
          '200': {
            description: 'Estado del sistema',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    firstRegistration: {
                      type: 'boolean',
                      description: 'true si este es el primer registro en el sistema',
                    },
                    registrationDisabled: {
                      type: 'boolean',
                      description: 'true si el registro está completamente deshabilitado',
                    },
                    requiresInvitation: {
                      type: 'boolean',
                      description: 'true si se requiere código de invitación',
                    },
                    masterKeyRequired: {
                      type: 'boolean',
                      description: 'true si se requiere clave maestra',
                    },
                  },
                },
              },
            },
          },
          '500': { description: 'Error del servidor' },
        },
      },
    },
    '/api/v1/identification-type': {
      get: {
        tags: ['Identification Type Management'],
        summary: 'List IdentificationType',
        responses: { '200': { description: 'OK' } },
      },
      post: {
        tags: ['Identification Type Management'],
        summary: 'Create TipoIdentificacion',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/TipoIdentificacionPayload' } },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/v1/identification-type/{id}': {
      get: {
        tags: ['Identification Type Management'],
        summary: 'Get TipoIdentificacion by id',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' } },
      },
      put: {
        tags: ['Identification Type Management'],
        summary: 'Update TipoIdentificacion',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/TipoIdentificacionPayload' } },
          },
        },
        responses: { '200': { description: 'Updated' } },
      },
      delete: {
        tags: ['Identification Type Management'],
        summary: 'Delete TipoIdentificacion',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/v1/issuing-company': {
      get: {
        tags: ['Issuing Company Management'],
        summary: 'List IssuingCompany',
        responses: { '200': { description: 'OK' } },
      },
    },
    '/api/v1/issuing-company/{id}': {
      get: {
        tags: ['Issuing Company Management'],
        summary: 'Get EmpresaEmisora',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' } },
      },
      put: {
        tags: ['Issuing Company Management'],
        summary: 'Update EmpresaEmisora',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/EmpresaEmisoraPayload' } },
          },
        },
        responses: { '200': { description: 'Updated' } },
      },
      delete: {
        tags: ['Issuing Company Management'],
        summary: 'Delete EmpresaEmisora',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/v1/client': {
      get: { tags: ['Client Management'], summary: 'List Clients', responses: { '200': { description: 'OK' } } },
      post: {
        tags: ['Client Management'],
        summary: 'Create Cliente',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ClientePayload' } },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/v1/client/{id}': {
      get: {
        tags: ['Client Management'],
        summary: 'Get Cliente',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' } },
      },
      put: {
        tags: ['Client Management'],
        summary: 'Update Cliente',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ClientePayload' } },
          },
        },
        responses: { '200': { description: 'Updated' } },
      },
      delete: {
        tags: ['Client Management'],
        summary: 'Delete Cliente',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/v1/product': {
      get: { tags: ['Product Management'], summary: 'List Products', responses: { '200': { description: 'OK' } } },
      post: {
        tags: ['Product Management'],
        summary: 'Create Producto',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ProductoPayload' } },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/v1/product/{id}': {
      get: {
        tags: ['Product Management'],
        summary: 'Get Producto',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' } },
      },
      put: {
        tags: ['Product Management'],
        summary: 'Update Producto',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/ProductoPayload' } },
          },
        },
        responses: { '200': { description: 'Updated' } },
      },
      delete: {
        tags: ['Product Management'],
        summary: 'Delete Producto',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/v1/invoice': {
      get: { tags: ['Invoice CRUD'], summary: 'List Invoices', responses: { '200': { description: 'OK' } } },
      post: {
        tags: ['Invoice CRUD'],
        summary: 'Create Factura',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/Factura' } },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/v1/invoice/complete': {
      post: {
        tags: ['Invoice Processing'],
        summary: 'Create Factura with details',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/FacturaComplete' } },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/v1/invoice/{id}': {
      get: {
        tags: ['Invoice CRUD'],
        summary: 'Get Factura',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' } },
      },
      put: {
        tags: ['Invoice CRUD'],
        summary: 'Update Factura',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/FacturaUpdatePayload' } },
          },
        },
        responses: { '200': { description: 'Updated' } },
      },
      delete: {
        tags: ['Invoice CRUD'],
        summary: 'Delete Factura',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/v1/credit-note': {
      get: { tags: ['Credit Note CRUD'], summary: 'List Credit Notes', responses: { '200': { description: 'OK' } } },
      post: {
        tags: ['Credit Note CRUD'],
        summary: 'Create Nota de Crédito',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/NotaCredito' } },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/v1/credit-note/complete': {
      post: {
        tags: ['Credit Note Processing'],
        summary: 'Create Nota de Crédito with details (XML, firma, envío y autorización SRI)',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/NotaCreditoComplete' } },
          },
        },
        responses: {
          '201': { description: 'Created' },
          '400': { description: 'Validation error' },
        },
      },
    },
    '/api/v1/credit-note/{id}': {
      get: {
        tags: ['Credit Note CRUD'],
        summary: 'Get Nota de Crédito',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
      },
      put: {
        tags: ['Credit Note CRUD'],
        summary: 'Update Nota de Crédito',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/NotaCredito' } },
          },
        },
        responses: { '200': { description: 'Updated' }, '404': { description: 'Not found' } },
      },
      delete: {
        tags: ['Credit Note CRUD'],
        summary: 'Delete Nota de Crédito',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' } },
      },
    },
    '/api/v1/credit-note/{id}/pdf': {
      get: {
        tags: ['Credit Note Processing'],
        summary: 'Get Nota de Crédito PDF (RIDE) info',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
      },
    },
    '/api/v1/debit-note': {
      get: { tags: ['Debit Note CRUD'], summary: 'List Debit Notes', responses: { '200': { description: 'OK' } } },
      post: {
        tags: ['Debit Note CRUD'],
        summary: 'Create Nota de Débito',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/NotaDebito' } },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/v1/debit-note/complete': {
      post: {
        tags: ['Debit Note Processing'],
        summary: 'Create Nota de Débito completa (XML, firma, envío y autorización SRI)',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/NotaDebitoComplete' } },
          },
        },
        responses: {
          '201': { description: 'Created' },
          '400': { description: 'Validation error' },
        },
      },
    },
    '/api/v1/debit-note/{id}': {
      get: {
        tags: ['Debit Note CRUD'],
        summary: 'Get Nota de Débito',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
      },
      put: {
        tags: ['Debit Note CRUD'],
        summary: 'Update Nota de Débito',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/NotaDebito' } },
          },
        },
        responses: { '200': { description: 'Updated' }, '404': { description: 'Not found' } },
      },
      delete: {
        tags: ['Debit Note CRUD'],
        summary: 'Delete Nota de Débito',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' } },
      },
    },
    '/api/v1/debit-note/{id}/pdf': {
      get: {
        tags: ['Debit Note Processing'],
        summary: 'Get Nota de Débito PDF (RIDE) info',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
      },
    },
    '/api/v1/delivery-note': {
      get: { tags: ['Delivery Note CRUD'], summary: 'List Delivery Notes', responses: { '200': { description: 'OK' } } },
      post: {
        tags: ['Delivery Note CRUD'],
        summary: 'Create Guía de Remisión',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/GuiaRemision' } },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/v1/delivery-note/complete': {
      post: {
        tags: ['Delivery Note Processing'],
        summary: 'Create Guía de Remisión completa (XML, firma, envío y autorización SRI)',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/GuiaRemisionComplete' } },
          },
        },
        responses: {
          '201': { description: 'Created' },
          '400': { description: 'Validation error' },
        },
      },
    },
    '/api/v1/delivery-note/{id}': {
      get: {
        tags: ['Delivery Note CRUD'],
        summary: 'Get Guía de Remisión',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
      },
      put: {
        tags: ['Delivery Note CRUD'],
        summary: 'Update Guía de Remisión',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/GuiaRemision' } },
          },
        },
        responses: { '200': { description: 'Updated' }, '404': { description: 'Not found' } },
      },
      delete: {
        tags: ['Delivery Note CRUD'],
        summary: 'Delete Guía de Remisión',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' } },
      },
    },
    '/api/v1/delivery-note/{id}/pdf': {
      get: {
        tags: ['Delivery Note Processing'],
        summary: 'Get Guía de Remisión PDF (RIDE) info',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
      },
    },
    '/api/v1/withholding': {
      get: { tags: ['Withholding CRUD'], summary: 'List Withholdings', responses: { '200': { description: 'OK' } } },
      post: {
        tags: ['Withholding CRUD'],
        summary: 'Create Comprobante de Retención',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/Retencion' } },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/v1/withholding/complete': {
      post: {
        tags: ['Withholding Processing'],
        summary: 'Create Comprobante de Retención ATS 2.0.0 completo (XML, firma, envío y autorización SRI)',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/RetencionComplete' } },
          },
        },
        responses: {
          '201': { description: 'Created' },
          '400': { description: 'Validation error' },
        },
      },
    },
    '/api/v1/withholding/{id}': {
      get: {
        tags: ['Withholding CRUD'],
        summary: 'Get Comprobante de Retención',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
      },
      put: {
        tags: ['Withholding CRUD'],
        summary: 'Update Comprobante de Retención',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/Retencion' } },
          },
        },
        responses: { '200': { description: 'Updated' }, '404': { description: 'Not found' } },
      },
      delete: {
        tags: ['Withholding CRUD'],
        summary: 'Delete Comprobante de Retención',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' }, '404': { description: 'Not found' } },
      },
    },
    '/api/v1/withholding/{id}/pdf': {
      get: {
        tags: ['Withholding Processing'],
        summary: 'Get Comprobante de Retención PDF (RIDE) info',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
      },
    },
    '/api/v1/invoice-detail': {
      get: {
        tags: ['Invoice Detail Management'],
        summary: 'List InvoiceDetail',
        responses: { '200': { description: 'OK' } },
      },
      post: {
        tags: ['Invoice Detail Management'],
        summary: 'Create FacturaDetalle',
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/FacturaDetallePayload' } },
          },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
    '/api/v1/invoice-detail/{id}': {
      get: {
        tags: ['Invoice Detail Management'],
        summary: 'Get FacturaDetalle',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'OK' } },
      },
      put: {
        tags: ['Invoice Detail Management'],
        summary: 'Update FacturaDetalle',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/FacturaDetallePayload' } },
          },
        },
        responses: { '200': { description: 'Updated' } },
      },
      delete: {
        tags: ['Invoice Detail Management'],
        summary: 'Delete FacturaDetalle',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/v1/invoice-pdf': {
      get: {
        tags: ['PDF Management'],
        summary: 'Listar todos los PDFs generados',
        description:
          'Obtiene una lista de todos los PDFs de facturas que han sido generados automáticamente cuando el SRI confirma la recepción (estado RECIBIDA).',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'page',
            in: 'query',
            schema: { type: 'integer', default: 1 },
            description: 'Número de página',
          },
          {
            name: 'limit',
            in: 'query',
            schema: { type: 'integer', default: 10 },
            description: 'Elementos por página',
          },
        ],
        responses: {
          '200': {
            description: 'Lista de PDFs obtenida exitosamente',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/InvoicePDF' },
                    },
                    pagination: {
                      type: 'object',
                      properties: {
                        total: { type: 'integer' },
                        page: { type: 'integer' },
                        pages: { type: 'integer' },
                        limit: { type: 'integer' },
                      },
                    },
                  },
                },
              },
            },
          },
          '401': { description: 'No autorizado' },
          '500': { description: 'Error del servidor' },
        },
      },
    },
    '/api/v1/invoice-pdf/factura/{id}': {
      get: {
        tags: ['PDF Management'],
        summary: 'Obtener PDF por ID de factura',
        description: 'Busca el PDF generado automáticamente para una factura específica usando su ID.',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'ID de la factura',
            example: '64f8a1b2c3d4e5f6a7b8c9d2',
          },
        ],
        responses: {
          '200': {
            description: 'PDF encontrado',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { $ref: '#/components/schemas/InvoicePDF' },
                  },
                },
              },
            },
          },
          '404': { description: 'PDF no encontrado - La factura aún no ha sido confirmada por el SRI o no existe' },
          '401': { description: 'No autorizado' },
          '500': { description: 'Error del servidor' },
        },
      },
    },
    '/api/v1/invoice-pdf/{id}/download': {
      get: {
        tags: ['PDF Management'],
        summary: 'Descargar archivo PDF',
        description:
          'Descarga el archivo PDF de una factura. El PDF se genera automáticamente cuando el SRI confirma la recepción.',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'ID del documento PDF',
            example: '64f8a1b2c3d4e5f6a7b8c9d8',
          },
        ],
        responses: {
          '200': {
            description: 'Archivo PDF descargado',
            content: {
              'application/pdf': {
                schema: {
                  type: 'string',
                  format: 'binary',
                },
              },
            },
            headers: {
              'Content-Disposition': {
                description: 'Attachment filename',
                schema: { type: 'string', example: 'attachment; filename="factura-001-001-000000001.pdf"' },
              },
            },
          },
          '404': { description: 'PDF no encontrado o archivo no existe en el sistema' },
          '401': { description: 'No autorizado' },
          '500': { description: 'Error del servidor' },
        },
      },
    },
    '/api/v1/invoice-pdf/clave/{claveAcceso}': {
      get: {
        tags: ['PDF Management'],
        summary: 'Obtener PDF por clave de acceso',
        description: 'Busca el PDF usando la clave de acceso de 49 dígitos de la factura electrónica.',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'claveAcceso',
            in: 'path',
            required: true,
            schema: { type: 'string', minLength: 49, maxLength: 49 },
            description: 'Clave de acceso de 49 dígitos de la factura',
            example: '1705202501012345678900110010010000000011234567890',
          },
        ],
        responses: {
          '200': {
            description: 'PDF encontrado',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    data: { $ref: '#/components/schemas/InvoicePDF' },
                  },
                },
              },
            },
          },
          '400': { description: 'Clave de acceso inválida (debe tener 49 dígitos)' },
          '404': { description: 'PDF no encontrado para esta clave de acceso' },
          '401': { description: 'No autorizado' },
          '500': { description: 'Error del servidor' },
        },
      },
    },
    '/api/v1/invoice-pdf/regenerate/{id}': {
      post: {
        tags: ['PDF Management'],
        summary: 'Regenerar PDF de factura',
        description:
          'Regenera el PDF de una factura que ya fue confirmada por el SRI. Útil si el archivo se perdió o se necesita actualizar el formato.',
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'ID de la factura',
            example: '64f8a1b2c3d4e5f6a7b8c9d2',
          },
        ],
        responses: {
          '200': {
            description: 'PDF regenerado exitosamente',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'PDF regenerado exitosamente' },
                    data: { $ref: '#/components/schemas/InvoicePDF' },
                  },
                },
              },
            },
          },
          '400': { description: 'La factura no ha sido confirmada por el SRI (estado debe ser RECIBIDA)' },
          '404': { description: 'Factura no encontrada' },
          '401': { description: 'No autorizado' },
          '500': { description: 'Error del servidor al regenerar PDF' },
        },
      },
    },
    '/api/v1/invoice-pdf/bulk-download': {
      post: {
        tags: ['PDF Management'],
        summary: 'Descarga masiva de PDFs',
        description: 'Descarga múltiples PDFs de facturas en un archivo ZIP.',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  facturaIds: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Array de IDs de facturas',
                    example: ['64f8a1b2c3d4e5f6a7b8c9d2', '64f8a1b2c3d4e5f6a7b8c9d3'],
                  },
                  fechaInicio: {
                    type: 'string',
                    format: 'date',
                    description: 'Fecha de inicio (formato YYYY-MM-DD)',
                    example: '2025-01-01',
                  },
                  fechaFin: {
                    type: 'string',
                    format: 'date',
                    description: 'Fecha de fin (formato YYYY-MM-DD)',
                    example: '2025-01-31',
                  },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'Archivo ZIP con PDFs descargado',
            content: {
              'application/zip': {
                schema: {
                  type: 'string',
                  format: 'binary',
                },
              },
            },
            headers: {
              'Content-Disposition': {
                description: 'Attachment filename',
                schema: { type: 'string', example: 'attachment; filename="facturas-2025-01.zip"' },
              },
            },
          },
          '400': { description: 'Parámetros de búsqueda inválidos' },
          '401': { description: 'No autorizado' },
          '404': { description: 'No se encontraron PDFs para los criterios especificados' },
          '500': { description: 'Error del servidor al generar ZIP' },
        },
      },
    },
  },
  tags: [
    {
      name: 'Invoice Processing',
      description: 'Endpoints for creating and processing electronic invoices.',
    },
    {
      name: 'PDF Management',
      description:
        'Gestión de PDFs generados automáticamente. Los PDFs se crean automáticamente cuando el SRI confirma la recepción de facturas (estado RECIBIDA).',
    },
    {
      name: 'Autenticación y Usuarios',
      description: 'Endpoints for user registration and authentication.',
    },
    {
      name: 'Identification Type Management',
      description: 'Endpoints to manage identification types.',
    },
    {
      name: 'Issuing Company Management',
      description: 'Endpoints to manage issuing companies.',
    },
    {
      name: 'Client Management',
      description: 'Endpoints to manage clients.',
    },
    {
      name: 'Product Management',
      description: 'Endpoints to manage products.',
    },
    {
      name: 'Invoice CRUD',
      description: 'CRUD operations for invoices (not the full processing).',
    },
    {
      name: 'Invoice Detail Management',
      description: 'Endpoints to manage invoice details.',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Token JWT obtenido del endpoint /auth',
      },
    },
    schemas: {
      Factura: { type: 'object' },
      FacturaComplete: {
        type: 'object',
        properties: {
          factura: { $ref: '#/components/schemas/FacturaBody' },
        },
        required: ['factura'],
      },
      FacturaBody: {
        type: 'object',
        properties: {
          infoTributaria: { $ref: '#/components/schemas/FacturaInfoTributaria' },
          infoFactura: { $ref: '#/components/schemas/FacturaInfoFactura' },
          detalles: {
            type: 'array',
            items: { $ref: '#/components/schemas/FacturaDetalleItem' },
          },
        },
        required: ['infoTributaria', 'infoFactura', 'detalles'],
      },
      FacturaInfoTributaria: {
        type: 'object',
        properties: {
          ruc: { type: 'string', example: '0106079783001' },
        },
        required: ['ruc'],
      },
      FacturaInfoFactura: {
        type: 'object',
        properties: {
          fechaEmision: { type: 'string', example: '17/05/2025', description: 'Formato DD/MM/YYYY' },
          tipoIdentificacionComprador: { type: 'string', example: '05' },
          identificacionComprador: { type: 'string', example: '0106079783' },
          razonSocialComprador: { type: 'string', example: 'Juan Pérez' },
          totalSinImpuestos: { type: 'string', example: '100.00' },
          importeTotal: { type: 'string', example: '112.00' },
        },
        required: [
          'fechaEmision',
          'tipoIdentificacionComprador',
          'identificacionComprador',
          'razonSocialComprador',
          'totalSinImpuestos',
          'importeTotal',
        ],
      },
      FacturaDetalleItem: {
        type: 'object',
        properties: {
          detalle: { $ref: '#/components/schemas/FacturaDetalleData' },
        },
        required: ['detalle'],
      },
      FacturaDetalleData: {
        type: 'object',
        properties: {
          codigoPrincipal: { type: 'string', example: 'P001' },
          descripcion: { type: 'string', example: 'Laptop Lenovo' },
          cantidad: { type: 'string', example: '1.00' },
          precioUnitario: { type: 'string', example: '100.00' },
          precioTotalSinImpuesto: { type: 'string', example: '100.00' },
          impuestos: {
            type: 'array',
            items: { $ref: '#/components/schemas/FacturaDetalleImpuesto' },
          },
        },
        required: [
          'codigoPrincipal',
          'descripcion',
          'cantidad',
          'precioUnitario',
          'precioTotalSinImpuesto',
          'impuestos',
        ],
      },
      FacturaDetalleImpuesto: {
        type: 'object',
        properties: {
          impuesto: { $ref: '#/components/schemas/ImpuestoDetail' },
        },
        required: ['impuesto'],
      },
      ImpuestoDetail: {
        type: 'object',
        properties: {
          codigo: { type: 'string', example: '2' },
          codigoPorcentaje: { type: 'string', example: '4', description: 'Tabla 17 SRI. 4 = IVA 15%' },
          tarifa: { type: 'string', example: '15.00' },
          baseImponible: { type: 'string', example: '100.00' },
          valor: { type: 'string', example: '15.00' },
        },
        required: ['codigo', 'codigoPorcentaje', 'tarifa', 'baseImponible', 'valor'],
      },
      NotaCredito: { type: 'object' },
      NotaDebito: { type: 'object' },
      GuiaRemision: { type: 'object' },
      Retencion: { type: 'object' },
      RetencionComplete: {
        type: 'object',
        properties: {
          retencion: { $ref: '#/components/schemas/RetencionBody' },
        },
        required: ['retencion'],
      },
      RetencionBody: {
        type: 'object',
        properties: {
          infoTributaria: { $ref: '#/components/schemas/FacturaInfoTributaria' },
          infoCompRetencion: { $ref: '#/components/schemas/RetencionInfo' },
          docsSustento: {
            type: 'array',
            items: { $ref: '#/components/schemas/RetencionDocSustentoItem' },
          },
        },
        required: ['infoTributaria', 'infoCompRetencion', 'docsSustento'],
      },
      RetencionInfo: {
        type: 'object',
        properties: {
          fechaEmision: { type: 'string', example: '17/05/2025', description: 'Formato DD/MM/YYYY' },
          tipoIdentificacionSujetoRetenido: { type: 'string', example: '04', description: 'Tabla 6 SRI' },
          tipoSujetoRetenido: {
            type: 'string',
            example: '01',
            description: 'Tabla 14 Catálogo ATS. Obligatorio si la identificación es del exterior',
          },
          parteRel: { type: 'string', example: 'NO', description: 'Parte relacionada SI/NO' },
          razonSocialSujetoRetenido: { type: 'string', example: 'Proveedor S.A.' },
          identificacionSujetoRetenido: { type: 'string', example: '1713328506001' },
          periodoFiscal: { type: 'string', example: '05/2025', description: 'Formato MM/YYYY' },
        },
        required: [
          'fechaEmision',
          'tipoIdentificacionSujetoRetenido',
          'razonSocialSujetoRetenido',
          'identificacionSujetoRetenido',
          'periodoFiscal',
        ],
      },
      RetencionDocSustentoItem: {
        type: 'object',
        properties: {
          docSustento: {
            type: 'object',
            properties: {
              codSustento: { type: 'string', example: '01', description: 'Tabla 5 Catálogo ATS' },
              codDocSustento: { type: 'string', example: '01', description: 'Tabla 4 Catálogo ATS' },
              numDocSustento: { type: 'string', example: '001001000000123', description: '15 dígitos' },
              fechaEmisionDocSustento: { type: 'string', example: '10/05/2025' },
              fechaRegistroContable: { type: 'string', example: '10/05/2025' },
              numAutDocSustento: { type: 'string', example: '1005202501179001234500110010010000001231234567818' },
              pagoLocExt: { type: 'string', example: '01', description: 'Tabla 15 Catálogo ATS. 01 = pago local' },
              totalSinImpuestos: { type: 'string', example: '100.00' },
              importeTotal: { type: 'string', example: '115.00' },
              impuestosDocSustento: {
                type: 'array',
                items: { $ref: '#/components/schemas/RetencionImpuestoDocSustentoItem' },
              },
              retenciones: {
                type: 'array',
                items: { $ref: '#/components/schemas/RetencionDetalleItem' },
              },
              pagos: {
                type: 'array',
                items: { $ref: '#/components/schemas/RetencionPagoItem' },
              },
            },
            required: [
              'codSustento',
              'codDocSustento',
              'fechaEmisionDocSustento',
              'pagoLocExt',
              'totalSinImpuestos',
              'importeTotal',
              'impuestosDocSustento',
              'retenciones',
              'pagos',
            ],
          },
        },
        required: ['docSustento'],
      },
      RetencionImpuestoDocSustentoItem: {
        type: 'object',
        properties: {
          impuestoDocSustento: {
            type: 'object',
            properties: {
              codImpuestoDocSustento: { type: 'string', example: '2', description: 'Tabla 16 SRI. 2 = IVA' },
              codigoPorcentaje: { type: 'string', example: '4', description: 'Tabla 17/18 SRI' },
              baseImponible: { type: 'string', example: '100.00' },
              tarifa: { type: 'string', example: '15' },
              valorImpuesto: { type: 'string', example: '15.00' },
            },
            required: ['codImpuestoDocSustento', 'codigoPorcentaje', 'baseImponible', 'tarifa', 'valorImpuesto'],
          },
        },
        required: ['impuestoDocSustento'],
      },
      RetencionDetalleItem: {
        type: 'object',
        properties: {
          retencion: {
            type: 'object',
            properties: {
              codigo: { type: 'string', example: '1', description: 'Tabla 19 SRI. 1=Renta, 2=IVA, 6=ISD' },
              codigoRetencion: { type: 'string', example: '312', description: 'Tablas 20/21 SRI' },
              baseImponible: { type: 'string', example: '100.00' },
              porcentajeRetener: { type: 'string', example: '1.75' },
              valorRetenido: { type: 'string', example: '1.75' },
            },
            required: ['codigo', 'codigoRetencion', 'baseImponible', 'porcentajeRetener', 'valorRetenido'],
          },
        },
        required: ['retencion'],
      },
      RetencionPagoItem: {
        type: 'object',
        properties: {
          pago: {
            type: 'object',
            properties: {
              formaPago: { type: 'string', example: '01', description: 'Tabla 13 Catálogo ATS' },
              total: { type: 'string', example: '115.00' },
            },
            required: ['formaPago', 'total'],
          },
        },
        required: ['pago'],
      },
      GuiaRemisionComplete: {
        type: 'object',
        properties: {
          guia_remision: { $ref: '#/components/schemas/GuiaRemisionBody' },
        },
        required: ['guia_remision'],
      },
      GuiaRemisionBody: {
        type: 'object',
        properties: {
          infoTributaria: { $ref: '#/components/schemas/FacturaInfoTributaria' },
          infoGuiaRemision: { $ref: '#/components/schemas/GuiaRemisionInfo' },
          destinatarios: {
            type: 'array',
            items: { $ref: '#/components/schemas/GuiaRemisionDestinatarioItem' },
          },
        },
        required: ['infoTributaria', 'infoGuiaRemision', 'destinatarios'],
      },
      GuiaRemisionInfo: {
        type: 'object',
        properties: {
          fechaEmision: {
            type: 'string',
            example: '17/05/2025',
            description: 'Formato DD/MM/YYYY. Se usa para la clave de acceso',
          },
          dirPartida: { type: 'string', example: 'Av. Eloy Alfaro 34 y Av. Libertad' },
          razonSocialTransportista: { type: 'string', example: 'Transportes S.A.' },
          tipoIdentificacionTransportista: { type: 'string', example: '04', description: 'Tabla 6 SRI' },
          rucTransportista: { type: 'string', example: '1796875790001' },
          fechaIniTransporte: { type: 'string', example: '17/05/2025', description: 'Formato DD/MM/YYYY' },
          fechaFinTransporte: { type: 'string', example: '18/05/2025', description: 'Formato DD/MM/YYYY' },
          placa: { type: 'string', example: 'MCL0827' },
        },
        required: [
          'fechaEmision',
          'dirPartida',
          'razonSocialTransportista',
          'tipoIdentificacionTransportista',
          'rucTransportista',
          'fechaIniTransporte',
          'fechaFinTransporte',
          'placa',
        ],
      },
      GuiaRemisionDestinatarioItem: {
        type: 'object',
        properties: {
          destinatario: {
            type: 'object',
            properties: {
              identificacionDestinatario: { type: 'string', example: '1716849140001' },
              razonSocialDestinatario: { type: 'string', example: 'Juan Pérez' },
              dirDestinatario: { type: 'string', example: 'Av. Simón Bolívar S/N' },
              motivoTraslado: { type: 'string', example: 'Venta de mercadería' },
              ruta: { type: 'string', example: 'Quito - Cayambe - Otavalo' },
              codDocSustento: { type: 'string', example: '01', description: 'Tabla 3 SRI' },
              numDocSustento: { type: 'string', example: '001-001-000000123' },
              numAutDocSustento: { type: 'string', example: '1705202501179001234500110010010000000011234567810' },
              fechaEmisionDocSustento: { type: 'string', example: '17/05/2025' },
              detalles: {
                type: 'array',
                items: { $ref: '#/components/schemas/GuiaRemisionDetalleItem' },
              },
            },
            required: [
              'identificacionDestinatario',
              'razonSocialDestinatario',
              'dirDestinatario',
              'motivoTraslado',
              'detalles',
            ],
          },
        },
        required: ['destinatario'],
      },
      GuiaRemisionDetalleItem: {
        type: 'object',
        properties: {
          detalle: {
            type: 'object',
            properties: {
              codigoInterno: { type: 'string', example: 'P001' },
              codigoAdicional: { type: 'string', example: 'A001' },
              descripcion: { type: 'string', example: 'Laptop Lenovo' },
              cantidad: { type: 'string', example: '10.00', description: 'Sin precios: solo cantidades' },
            },
            required: ['descripcion', 'cantidad'],
          },
        },
        required: ['detalle'],
      },
      NotaDebitoComplete: {
        type: 'object',
        properties: {
          nota_debito: { $ref: '#/components/schemas/NotaDebitoBody' },
        },
        required: ['nota_debito'],
      },
      NotaDebitoBody: {
        type: 'object',
        properties: {
          infoTributaria: { $ref: '#/components/schemas/FacturaInfoTributaria' },
          infoNotaDebito: { $ref: '#/components/schemas/NotaDebitoInfo' },
          motivos: {
            type: 'array',
            items: { $ref: '#/components/schemas/NotaDebitoMotivoItem' },
          },
        },
        required: ['infoTributaria', 'infoNotaDebito', 'motivos'],
      },
      NotaDebitoInfo: {
        type: 'object',
        properties: {
          fechaEmision: { type: 'string', example: '17/05/2025', description: 'Formato DD/MM/YYYY' },
          tipoIdentificacionComprador: { type: 'string', example: '05' },
          identificacionComprador: { type: 'string', example: '0106079783' },
          razonSocialComprador: { type: 'string', example: 'Juan Pérez' },
          codDocModificado: { type: 'string', example: '01', description: 'Tabla 3 SRI. 01 = Factura' },
          numDocModificado: { type: 'string', example: '001-001-000000123' },
          fechaEmisionDocSustento: { type: 'string', example: '10/05/2025', description: 'Formato DD/MM/YYYY' },
          totalSinImpuestos: { type: 'string', example: '50.00' },
          impuestos: {
            type: 'array',
            items: { $ref: '#/components/schemas/FacturaDetalleImpuesto' },
            description: 'La tarifa de IVA corresponde a la fecha de emisión del documento de sustento',
          },
          valorTotal: { type: 'string', example: '57.50' },
          pagos: {
            type: 'array',
            items: { $ref: '#/components/schemas/NotaDebitoPagoItem' },
          },
        },
        required: [
          'fechaEmision',
          'tipoIdentificacionComprador',
          'identificacionComprador',
          'codDocModificado',
          'numDocModificado',
          'fechaEmisionDocSustento',
          'totalSinImpuestos',
          'impuestos',
          'valorTotal',
          'pagos',
        ],
      },
      NotaDebitoPagoItem: {
        type: 'object',
        properties: {
          pago: {
            type: 'object',
            properties: {
              formaPago: { type: 'string', example: '20', description: 'Tabla 24 SRI' },
              total: { type: 'string', example: '57.50' },
              plazo: { type: 'string', example: '15' },
              unidadTiempo: { type: 'string', example: 'dias' },
            },
            required: ['formaPago', 'total'],
          },
        },
        required: ['pago'],
      },
      NotaDebitoMotivoItem: {
        type: 'object',
        properties: {
          motivo: {
            type: 'object',
            properties: {
              razon: { type: 'string', example: 'Interés por mora' },
              valor: { type: 'string', example: '50.00' },
            },
            required: ['razon', 'valor'],
          },
        },
        required: ['motivo'],
      },
      NotaCreditoComplete: {
        type: 'object',
        properties: {
          nota_credito: { $ref: '#/components/schemas/NotaCreditoBody' },
        },
        required: ['nota_credito'],
      },
      NotaCreditoBody: {
        type: 'object',
        properties: {
          infoTributaria: { $ref: '#/components/schemas/FacturaInfoTributaria' },
          infoNotaCredito: { $ref: '#/components/schemas/NotaCreditoInfo' },
          detalles: {
            type: 'array',
            items: { $ref: '#/components/schemas/NotaCreditoDetalleItem' },
          },
        },
        required: ['infoTributaria', 'infoNotaCredito', 'detalles'],
      },
      NotaCreditoInfo: {
        type: 'object',
        properties: {
          fechaEmision: { type: 'string', example: '17/05/2025', description: 'Formato DD/MM/YYYY' },
          tipoIdentificacionComprador: { type: 'string', example: '05' },
          identificacionComprador: { type: 'string', example: '0106079783' },
          razonSocialComprador: { type: 'string', example: 'Juan Pérez' },
          codDocModificado: { type: 'string', example: '01', description: 'Tabla 3 SRI. 01 = Factura' },
          numDocModificado: { type: 'string', example: '001-001-000000123' },
          fechaEmisionDocSustento: { type: 'string', example: '10/05/2025', description: 'Formato DD/MM/YYYY' },
          totalSinImpuestos: { type: 'string', example: '100.00' },
          valorModificacion: { type: 'string', example: '115.00' },
          moneda: { type: 'string', example: 'DOLAR' },
          motivo: { type: 'string', example: 'DEVOLUCIÓN' },
        },
        required: [
          'fechaEmision',
          'tipoIdentificacionComprador',
          'identificacionComprador',
          'codDocModificado',
          'numDocModificado',
          'fechaEmisionDocSustento',
          'totalSinImpuestos',
          'valorModificacion',
          'motivo',
        ],
      },
      NotaCreditoDetalleItem: {
        type: 'object',
        properties: {
          detalle: { $ref: '#/components/schemas/NotaCreditoDetalleData' },
        },
        required: ['detalle'],
      },
      NotaCreditoDetalleData: {
        type: 'object',
        properties: {
          codigoInterno: { type: 'string', example: 'P001' },
          codigoAdicional: { type: 'string', example: 'A001' },
          descripcion: { type: 'string', example: 'Laptop Lenovo' },
          cantidad: { type: 'string', example: '1.00' },
          precioUnitario: { type: 'string', example: '100.00' },
          descuento: { type: 'string', example: '0.00' },
          precioTotalSinImpuesto: { type: 'string', example: '100.00' },
          impuestos: {
            type: 'array',
            items: { $ref: '#/components/schemas/FacturaDetalleImpuesto' },
          },
        },
        required: ['codigoInterno', 'descripcion', 'cantidad', 'precioUnitario', 'precioTotalSinImpuesto', 'impuestos'],
      },
      UserRegistration: {
        type: 'object',
        properties: {
          // User data
          email: { type: 'string', example: 'admin@empresa.com' },
          password: { type: 'string', example: 'password123' },
          // Company data
          ruc: { type: 'string', example: '1234567890001' },
          razon_social: { type: 'string', example: 'Mi Empresa S.A.' },
          nombre_comercial: { type: 'string', example: 'Mi Empresa' },
          direccion: { type: 'string', example: 'Av. Principal 123' },
          telefono: { type: 'string', example: '0999999999' },
          codigo_establecimiento: { type: 'string', example: '001' },
          punto_emision: { type: 'string', example: '001' },
          tipo_ambiente: { type: 'number', example: 1, description: '1=Pruebas, 2=Producción' },
          tipo_emision: { type: 'number', example: 1, description: '1=Normal' },
          certificate: { type: 'string', description: 'Certificado digital en base64' },
          certificatePassword: { type: 'string', example: 'password_certificado' },
          certificatePath: {
            type: 'string',
            description: 'Ruta al archivo de certificado (alternativa a certificate)',
          },
          // Security
          masterKey: {
            type: 'string',
            example: 'clave_maestra_secreta',
            description: 'Requerida para el primer registro',
          },
          invitationCode: {
            type: 'string',
            example: 'INV2024001',
            description: 'Código de invitación para registros posteriores',
          },
        },
        required: ['email', 'password', 'ruc', 'razon_social'],
      },
      AuthPayload: {
        type: 'object',
        properties: {
          email: { type: 'string', example: 'user@example.com' },
          password: { type: 'string', example: 'password123' },
        },
        required: ['email', 'password'],
      },
      TipoIdentificacionPayload: {
        type: 'object',
        properties: {
          codigo: { type: 'string', example: '01' },
          descripcion: { type: 'string', example: 'RUC' },
        },
        required: ['codigo', 'descripcion'],
      },
      EmpresaEmisoraPayload: {
        type: 'object',
        properties: {
          ruc: { type: 'string', example: '0123456789001' },
          razon_social: { type: 'string', example: 'Mi Empresa S.A.' },
          nombre_comercial: { type: 'string', example: 'Mi Tienda' },
          // Add more fields according to your IssuingCompany model
        },
        required: ['ruc', 'razon_social'],
      },
      ClientePayload: {
        type: 'object',
        properties: {
          tipo_identificacion_id: { type: 'string', example: 'ID_TIPO_IDENTIFICACION' },
          identificacion: { type: 'string', example: '0123456789' },
          razon_social: { type: 'string', example: 'Nombre Cliente' },
          // Add more fields according to your Client model
        },
        required: ['tipo_identificacion_id', 'identificacion', 'razon_social'],
      },
      ProductoPayload: {
        type: 'object',
        properties: {
          codigo: { type: 'string', example: 'PROD001' },
          descripcion: { type: 'string', example: 'Producto de Ejemplo' },
          precio_unitario: { type: 'number', example: 10.99 },
          // Add more fields according to your Product model
        },
        required: ['codigo', 'descripcion', 'precio_unitario'],
      },
      FacturaUpdatePayload: {
        type: 'object',
        properties: {
          // Define the fields that can be updated in an invoice
          // For example, you could allow updating the status or some specific information
          // This is just an example, adjust it to your needs
          observacion: { type: 'string', example: 'Alguna observación adicional' },
        },
      },
      FacturaDetallePayload: {
        type: 'object',
        properties: {
          factura_id: { type: 'string', example: 'ID_FACTURA' },
          producto_id: { type: 'string', example: 'ID_PRODUCTO' },
          cantidad: { type: 'number', example: 1 },
          precio_unitario: { type: 'number', example: 25.5 },
          // Add more fields according to your InvoiceDetail model
        },
        required: ['factura_id', 'producto_id', 'cantidad', 'precio_unitario'],
      },
      EmpresaEmisora: {
        type: 'object',
        properties: {
          ruc: { type: 'string' },
          razon_social: { type: 'string' },
          nombre_comercial: { type: 'string' },
          // Add more fields according to your IssuingCompany model
        },
      },
      Cliente: {
        type: 'object',
        properties: {
          identificacion: { type: 'string' },
          nombre: { type: 'string' },
          // Add more fields according to your Client model
        },
      },
      Producto: {
        type: 'object',
        properties: {
          codigo: { type: 'string' },
          nombre: { type: 'string' },
          precio_venta: { type: 'number' },
          // Add more fields according to your Product model
        },
      },
      FacturaUpdate: {
        type: 'object',
        properties: {
          // Define the fields that can be updated in an invoice
          // For example, you could allow updating the status or some specific information
          // This is just an example, adjust it to your needs
          estado: { type: 'string' },
          sri_estado: { type: 'string' },
        },
      },
      FacturaDetalle: {
        type: 'object',
        properties: {
          factura_id: { type: 'string' },
          producto_id: { type: 'string' },
          cantidad: { type: 'number' },
          precio_unitario: { type: 'number' },
          // Add more fields according to your InvoiceDetail model
        },
      },
      InvoicePDF: {
        type: 'object',
        properties: {
          _id: { type: 'string', example: '64f8a1b2c3d4e5f6a7b8c9d8' },
          factura_id: { type: 'string', example: '64f8a1b2c3d4e5f6a7b8c9d2' },
          clave_acceso: { type: 'string', example: '1705202501012345678900110010010000000011234567890' },
          numero_factura: { type: 'string', example: '001-001-000000001' },
          empresa_emisora: { type: 'string', example: 'Mi Empresa S.A.' },
          cliente: { type: 'string', example: 'Juan Pérez' },
          fecha_emision: { type: 'string', format: 'date-time', example: '2025-01-17T10:30:00.000Z' },
          total: { type: 'number', example: 112.0 },
          pdf_path: { type: 'string', example: '/uploads/pdfs/001-001-000000001.pdf' },
          file_size: { type: 'integer', example: 245760, description: 'Tamaño del archivo en bytes' },
          generado_automaticamente: {
            type: 'boolean',
            example: true,
            description: 'true si fue generado automáticamente al confirmar SRI',
          },
          sri_estado: { type: 'string', example: 'RECIBIDA', enum: ['RECIBIDA', 'DEVUELTA'] },
          fecha_generacion: { type: 'string', format: 'date-time', example: '2025-01-17T10:31:15.000Z' },
          created_at: { type: 'string', format: 'date-time' },
          updated_at: { type: 'string', format: 'date-time' },
        },
        required: ['factura_id', 'clave_acceso', 'numero_factura', 'pdf_path'],
      },
    },
  },
};
