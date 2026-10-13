#!/usr/bin/env bash
# E2E contra el ambiente de PRUEBAS del SRI: registra emisor con su .p12, crea un producto,
# emite una factura a consumidor final y espera la autorización.
#
#   P12=/ruta/firma.p12 P12_PASSWORD=... RUC=0999999999001 RAZON_SOCIAL="..." \
#   MASTER_REGISTRATION_KEY=... API=http://localhost:3000 scripts/e2e-sri-pruebas.sh
#
# Requiere el servidor levantado (npm run build && npm start) con MASTER_REGISTRATION_KEY
# configurado y la base vacía (el primer registro exige la clave maestra).
set -euo pipefail

: "${P12:?ruta al .p12}" "${P12_PASSWORD:?clave del .p12}" "${RUC:?RUC del emisor}" "${RAZON_SOCIAL:?razón social}"
: "${MASTER_REGISTRATION_KEY:?clave maestra del servidor}"
API="${API:-http://localhost:3000}"
DIRECCION="${DIRECCION:-CUENCA}"
EMAIL="${EMAIL:-e2e-$RUC@f-sri.local}"
PASSWORD="${PASSWORD:-e2e-$(date +%s)}"
command -v jq >/dev/null || { echo "jq es requerido"; exit 1; }

echo "▶ Registrando emisor $RUC"
CERT_B64=$(base64 -w0 "$P12")
REGISTER=$(jq -n --arg email "$EMAIL" --arg password "$PASSWORD" --arg ruc "$RUC" --arg rs "$RAZON_SOCIAL" \
  --arg dir "$DIRECCION" --arg cert "$CERT_B64" --arg cpass "$P12_PASSWORD" --arg mk "$MASTER_REGISTRATION_KEY" \
  '{email:$email,password:$password,ruc:$ruc,razon_social:$rs,nombre_comercial:$rs,direccion:$dir,
    codigo_establecimiento:"001",punto_emision:"001",tipo_ambiente:1,tipo_emision:1,
    certificate:$cert,certificate_password:$cpass,masterKey:$mk}')
TOKEN=$(curl -sf -X POST "$API/register" -H 'Content-Type: application/json' -d "$REGISTER" | jq -r .token) \
  || TOKEN=$(curl -sf -X POST "$API/auth" -H 'Content-Type: application/json' \
       -d "$(jq -n --arg e "$EMAIL" --arg p "$PASSWORD" '{email:$e,password:$p}')" | jq -r .token)
[ -n "$TOKEN" ] && [ "$TOKEN" != null ] || { echo "✗ No se pudo registrar/autenticar"; exit 1; }
AUTH=(-H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json')

echo "▶ Creando producto SERV-E2E"
curl -sf -X POST "$API/api/v1/product" "${AUTH[@]}" \
  -d '{"codigo":"SERV-E2E","descripcion":"Servicios profesionales de desarrollo","precio_unitario":10,"tiene_iva":true}' >/dev/null

echo "▶ Emitiendo factura y esperando autorización del SRI…"
FACTURA=$(jq -n --arg ruc "$RUC" '{factura:{
  infoTributaria:{ruc:$ruc},
  infoFactura:{tipoIdentificacionComprador:"07",identificacionComprador:"9999999999999",totalSinImpuestos:"20.00",importeTotal:"23.00",
               pagos:[{formaPago:"20",total:"23.00"}]},
  detalles:[{detalle:{codigoPrincipal:"SERV-E2E",cantidad:"2",impuestos:[{impuesto:{codigoPorcentaje:"4"}}]}}],
  infoAdicional:{"Observación":"Factura de prueba end to end f-sri + firmaec.js"}}}')
RESULT=$(curl -s -X POST "$API/api/v1/invoice/complete?esperar=true" "${AUTH[@]}" -d "$FACTURA")
echo "$RESULT" | jq '.data'
ID=$(echo "$RESULT" | jq -r .data.id)
ESTADO=$(echo "$RESULT" | jq -r .data.estado)
CLAVE=$(echo "$RESULT" | jq -r .data.clave_acceso)

if [ "$ESTADO" = "AUTORIZADO" ]; then
  curl -sf "$API/api/v1/invoice/$ID/xml" "${AUTH[@]}" -o "factura-$CLAVE.xml"
  echo "✅ AUTORIZADO — XML autorizado en factura-$CLAVE.xml"
  sleep 3
  curl -s "$API/api/v1/invoice-pdf/access-key/$CLAVE" "${AUTH[@]}" | jq '{pdf_url, estado, pdf_provider}'
else
  echo "✗ Estado final: $ESTADO"; exit 1
fi
