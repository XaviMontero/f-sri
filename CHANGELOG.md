# Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versionado [SemVer](https://semver.org/lang/es/).

## [2.0.0] - 2026-10-14

Primera versión estable con **firma válida para el SRI** y **todos los comprobantes electrónicos**.
Los cinco comprobantes fueron **AUTORIZADOS en el ambiente de pruebas del SRI** con un certificado real.

### Añadido
- **Nota de crédito (04), nota de débito (05), guía de remisión (06) y comprobante de retención ATS 2.0.0 (07)**:
  `POST /api/v1/{credit-note|debit-note|delivery-note|withholding}/complete`. Aporte de @gustavdz (#21, #23, #25, #27), integrado en #30.
- **Firma XAdES-BES** con [firmaec.js](https://github.com/XaviMontero/firmaec.js) (#28). Se elige el certificado con uso
  `digitalSignature` cuando el `.p12` trae varias claves (#29, idea de @KiddyTheKid en #19).
- **Autorización SRI** con reintentos y envío idempotente y reanudable: `?esperar=true`, `/{id}/enviar`, `/{id}/estado` y `/{id}/xml`.
- **RIDE** con código de barras para los cinco comprobantes, generado solo tras AUTORIZADO; `GET|POST /{id}/pdf` y regeneración real.
- `ultimo_secuencial` y `ultimos_secuenciales` por tipo de comprobante, para migrar desde otro sistema sin el error 45 (#29).
- Búsquedas por clave lógica: `/product/code/{codigo}`, `/client/docid/{identificacion}` y `/identification-type/code/{codigo}` (#29, de @KiddyTheKid).
- `scripts/e2e-sri-pruebas.sh` y E2E opt-in por comprobante contra el SRI real.
- `compose.yml` para levantar MongoDB en local (de @gustavdz).

### Cambiado
- Arquitectura por capas DDD/hexagonal (`domain`, `application`, `infrastructure`, `http`, `modules`) con composition root en `src/container.ts`.
- **IVA 15%** vigente y catálogo completo de tarifas. Los totales se calculan en el servidor y, si el cliente envía totales que no cuadran, se responde 400.
- Factura en esquema 1.1.0, con `pagos` y hasta 6 decimales.
- Secuenciales atómicos por establecimiento, punto de emisión y tipo de comprobante.
- Tests: de Jest a **Vitest**, con 612 tests y 88% de cobertura.
- `ENCRYPTION_KEY` recomendada en hex de 64 caracteres (`openssl rand -hex 32`), compatible con las claves anteriores.
- **firmaec.js se instala desde npm** (`firmaec.js@^5.2.0`); se elimina el tarball de `vendor/`.
- Dependencias actualizadas: puppeteer 25 (Chrome 155), nodemailer 10, xmlbuilder2 4, axios, express/qs, jws, lodash, mongoose y otras.
- `npm run dev` usa `tsx watch`; se retiran nodemon, ts-node y ts-node-dev.

### Seguridad
- Facturas, comprobantes, PDFs y empresa emisora quedan **acotados a la empresa del token**.
- El certificado y su contraseña ya no se exponen por la API.
- Se elimina `certificatePath`, que permitía leer archivos arbitrarios del servidor.
- El `.p12` ya no se escribe en disco y se elimina la prueba de contraseñas "comunes".
- El HTML del RIDE se escapa.
- `npm audit` pasa de 21 paquetes vulnerables a uno, `node-forge`, que llega a través de firmaec.js y no tiene versión corregida.
  Solo se usa para abrir el `.p12`; el advisory (GHSA-86w9-cpqp-85rv) afecta a la *verificación* de firmas RSA, que no se usa.

### ⚠️ Incompatibles con 1.x
- Se retiran `PUT /api/v1/invoice/{id}` y `POST /api/v1/invoice` (sin `/complete`).
- Rutas de PDFs: `/invoice-pdf/invoice/{id}`, `/invoice-pdf/access-key/{clave}` y `/invoice-pdf/download/{clave}`.
- `SRI_ENVIRONMENT` ya no se usa: el ambiente lo define `tipo_ambiente` de cada empresa.
- Requiere Node ≥ 20.19, y `JWT_SECRET` y `ENCRYPTION_KEY` definidos.

### Contribuidores
¡Gracias a @gustavdz y @KiddyTheKid!

## [1.0.0] - 2025-06-01

Primera release pública.

[2.0.0]: https://github.com/XaviMontero/f-sri/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/XaviMontero/f-sri/releases/tag/v1.0.0
