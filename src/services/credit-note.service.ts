import { CreditNoteRequest, CreditNoteProductDetail } from '../interfaces/credit-note.interface';
import { convertirFecha, generarClaveAcceso } from '../utils/invoice.utils';
import { generarXMLNotaCredito } from '../utils/xml.utils';
import { firmarXML } from '../utils/firma.utils';
import { enviarComprobanteSRI, autorizarComprobanteSRI, AutorizacionSRI, RespuestaSRI } from '../utils/sri.utils';
import { generateCreditNotePDF } from '../utils/pdf.utils';
import { PDFStorageFactory } from './storage';
import { InvoiceService } from './invoice.service';
import CreditNote from '../models/CreditNote';
import CreditNoteDetail from '../models/CreditNoteDetail';
import CreditNotePDF from '../models/CreditNotePDF';
import Invoice from '../models/Invoice';
import IssuingCompany from '../models/IssuingCompany';
import { IClient } from '../models/Client';
import { IProduct } from '../models/Product';
import fs from 'fs';

/**
 * Servicio para manejar todas las operaciones relacionadas con notas de crédito (codDoc 04)
 */
export class CreditNoteService {
  /**
   * Valida que los datos básicos de una nota de crédito estén presentes
   */
  static validarDatosNotaCredito(datos: CreditNoteRequest): boolean {
    return !!(
      datos.infoTributaria &&
      datos.infoNotaCredito &&
      datos.detalles &&
      datos.detalles.length > 0 &&
      datos.infoNotaCredito.numDocModificado &&
      datos.infoNotaCredito.motivo
    );
  }

  /**
   * Genera el siguiente secuencial de nota de crédito para una empresa
   */
  static async generarSecuencial(rucCompany: string): Promise<string> {
    const empresa = await IssuingCompany.findOne({ ruc: rucCompany });
    if (!empresa) {
      throw new Error(`Empresa with RUC ${rucCompany} not found`);
    }

    const ultimaNota = await CreditNote.findOne({
      empresa_emisora_id: empresa._id,
    }).sort({ secuencial: -1 });

    let secuencial = '000000001';
    if (ultimaNota) {
      const siguiente = parseInt(ultimaNota.secuencial) + 1;
      secuencial = siguiente.toString().padStart(9, '0');
    }
    return secuencial;
  }

  /**
   * Busca todos los productos listados en los detalles de una nota de crédito
   */
  static async buscarProducts(detalles: CreditNoteProductDetail[]): Promise<IProduct[]> {
    const productos = [];
    for (const det of detalles) {
      const codigo = det.detalle?.codigoInterno;
      const producto = await InvoiceService.buscarProduct(codigo);
      if (!producto) {
        throw new Error(`Product not found: ${codigo}`);
      }
      productos.push(producto);
    }
    return productos;
  }

  /**
   * Valida y resuelve todas las entidades necesarias para emitir la nota de crédito
   */
  static async procesarNotaCreditoCompleta(datos: CreditNoteRequest) {
    if (!this.validarDatosNotaCredito(datos)) {
      throw new Error('Datos de nota de crédito inválidos o incompletos');
    }

    const tipoIdent = await InvoiceService.buscarTipoIdentificacion(datos.infoNotaCredito.tipoIdentificacionComprador);
    if (!tipoIdent) {
      throw new Error('Identification type not found');
    }

    const empresa = await InvoiceService.buscarIssuingCompany(datos.infoTributaria.ruc);
    if (!empresa) {
      throw new Error('Empresa emisora no encontrada');
    }

    const cliente = await InvoiceService.buscarClient(datos.infoNotaCredito.identificacionComprador);
    if (!cliente) {
      throw new Error('Client not found');
    }

    const productos = await this.buscarProducts(datos.detalles);
    const secuencial = await this.generarSecuencial(empresa.ruc);
    const fechaEmision = convertirFecha(datos.infoNotaCredito.fechaEmision);
    const fechaEmisionDocSustento = convertirFecha(datos.infoNotaCredito.fechaEmisionDocSustento);

    if (isNaN(fechaEmision.getTime()) || isNaN(fechaEmisionDocSustento.getTime())) {
      throw new Error('Invalid date format');
    }

    // Optional link to the modified invoice when it exists in this system
    const facturaModificada = await Invoice.findOne({
      empresa_emisora_id: empresa._id,
      secuencial: datos.infoNotaCredito.numDocModificado.split('-').pop(),
    });

    return {
      empresa,
      cliente,
      productos,
      secuencial,
      fechaEmision,
      fechaEmisionDocSustento,
      facturaModificada,
    };
  }

  /**
   * Procesa y guarda una nota de crédito completa con todos sus detalles,
   * y dispara el envío asíncrono al SRI
   * @param datos Los datos de la nota de crédito recibidos del cliente
   * @returns La nota de crédito creada y sus detalles
   */
  static async crearNotaCreditoCompleta(datos: CreditNoteRequest) {
    const { empresa, cliente, productos, secuencial, fechaEmision, fechaEmisionDocSustento, facturaModificada } =
      await this.procesarNotaCreditoCompleta(datos);

    const serie = `${empresa.codigo_establecimiento}${empresa.punto_emision}`;
    const claveAcceso = generarClaveAcceso({
      fecha: fechaEmision,
      tipoComprobante: '04',
      ruc: empresa.ruc,
      ambiente: empresa.tipo_ambiente.toString(),
      serie,
      secuencial,
      codigoNumerico: Math.floor(10000000 + Math.random() * 89999999).toString(),
      tipoEmision: empresa.tipo_emision.toString(),
    });

    const totalSinImpuestos = parseFloat(datos.infoNotaCredito.totalSinImpuestos);
    const totalIva = datos.detalles.reduce((s, d) => s + parseFloat(d.detalle.impuestos[0].impuesto.valor), 0);
    const valorModificacion = parseFloat(datos.infoNotaCredito.valorModificacion);

    const xml = generarXMLNotaCredito(datos, empresa, cliente, claveAcceso, secuencial);

    const notaCredito = new CreditNote({
      empresa_emisora_id: empresa._id,
      cliente_id: cliente._id,
      factura_modificada_id: facturaModificada?._id,
      fecha_emision: fechaEmision,
      clave_acceso: claveAcceso,
      secuencial,
      estado: 'CREADA',
      cod_doc_modificado: datos.infoNotaCredito.codDocModificado,
      num_doc_modificado: datos.infoNotaCredito.numDocModificado,
      fecha_emision_doc_sustento: fechaEmisionDocSustento,
      total_sin_impuestos: totalSinImpuestos,
      total_iva: totalIva,
      valor_modificacion: valorModificacion,
      motivo: datos.infoNotaCredito.motivo,
      xml,
      sri_estado: 'PENDIENTE',
      datos_originales: JSON.stringify(datos),
    });

    await notaCredito.save();

    this.procesarEnvioSRI(notaCredito, empresa, cliente, productos, datos).catch((error) => {
      console.error('Error in asynchronous SRI sending process:', error);
    });

    const detallesGuardados = await this.crearDetallesNotaCredito(notaCredito._id, datos.detalles, productos);

    return {
      nota_credito: notaCredito,
      detalles: detallesGuardados,
      xml: notaCredito.xml,
      xml_firmado: notaCredito.xml_firmado || null,
      respuesta_sri: null,
    };
  }

  /**
   * Crea los detalles de una nota de crédito en la base de datos
   */
  static async crearDetallesNotaCredito(
    notaCreditoId: string | any,
    detalles: CreditNoteProductDetail[],
    products: IProduct[],
  ) {
    const detallesGuardados = [];

    for (let i = 0; i < detalles.length; i++) {
      const det = detalles[i].detalle;
      const prod = products[i];

      const detDoc = new CreditNoteDetail({
        nota_credito_id: notaCreditoId,
        producto_id: prod._id,
        cantidad: parseFloat(det.cantidad),
        precio_unitario: parseFloat(det.precioUnitario),
        subtotal: parseFloat(det.precioTotalSinImpuesto),
        valor_iva: parseFloat(det.impuestos[0].impuesto.valor),
      });

      await detDoc.save();
      detallesGuardados.push(detDoc);
    }

    return detallesGuardados;
  }

  /**
   * Procesa el envío asíncrono de la nota de crédito al SRI:
   * firma XAdES-BES, recepción y consulta de autorización
   */
  static async procesarEnvioSRI(
    notaCredito: any,
    empresa: any,
    cliente: IClient,
    productos: IProduct[],
    datos: CreditNoteRequest,
  ): Promise<void> {
    let respuestaSRI: RespuestaSRI | null = null;

    try {
      const p12Path = empresa.certificatePath;
      const p12Password = empresa.certificatePassword || '';

      if (!p12Path || !fs.existsSync(p12Path)) {
        notaCredito.sri_estado = 'ERROR_FIRMA';
        notaCredito.sri_mensajes = { mensaje: 'Certificate not found for signing' };
        await notaCredito.save();
        return;
      }

      try {
        const diagnosis = await InvoiceService.diagnoseP12Certificate(p12Path, p12Password);
        if (!diagnosis.isValidP12) {
          throw new Error(`El archivo P12 no es válido: ${diagnosis.error}`);
        }

        let workingPassword = p12Password;
        const passwordVerification = await InvoiceService.verifyP12Password(p12Path, p12Password);
        if (!passwordVerification.valid) {
          const passwordSearch = await InvoiceService.findWorkingP12Password(p12Path, p12Password);
          if (passwordSearch.password === null) {
            throw new Error(`Error de contraseña del certificado P12: ${passwordVerification.error}`);
          }
          workingPassword = passwordSearch.password;
        }

        const xmlFirmado = await firmarXML(notaCredito.xml, p12Path, workingPassword, '04');

        notaCredito.xml_firmado = xmlFirmado;
        notaCredito.sri_fecha_envio = new Date();
        await notaCredito.save();

        respuestaSRI = await enviarComprobanteSRI(xmlFirmado);

        notaCredito.sri_fecha_respuesta = new Date();
        notaCredito.sri_estado = respuestaSRI.estado;
        if (respuestaSRI.mensajes) {
          notaCredito.sri_mensajes = respuestaSRI.mensajes;
        }
        await notaCredito.save();

        if (respuestaSRI.estado === 'RECIBIDA') {
          console.log(
            `✅ NOTA DE CRÉDITO RECIBIDA POR SRI - ID: ${notaCredito._id}, Clave: ${notaCredito.clave_acceso}, Secuencial: ${notaCredito.secuencial}`,
          );
          await this.generarPDFNotaCredito(notaCredito, empresa, cliente, productos, datos);
          this.programarConsultaAutorizacion(String(notaCredito._id));
        } else {
          console.log(`⚠️ SRI Estado: ${respuestaSRI.estado} - Nota de crédito ID: ${notaCredito._id}`);
        }
      } catch (error: any) {
        console.error('Error during certificate processing or signing:', error.message);
        notaCredito.sri_estado = 'ERROR_FIRMA';
        notaCredito.sri_mensajes = { error: error.message };
        await notaCredito.save();
      }
    } catch (error: any) {
      console.error('Error during signing or sending to SRI:', error.message);
      notaCredito.sri_estado = 'ERROR_PROCESO';
      notaCredito.sri_mensajes = { error: error.message };
      await notaCredito.save();
    }
  }

  /**
   * Programa consultas de autorización al SRI con reintentos
   */
  static programarConsultaAutorizacion(notaCreditoId: string, intento = 1, maxIntentos = 3, delayMs = 5000): void {
    const timer = setTimeout(async () => {
      try {
        const resultado = await CreditNoteService.consultarAutorizacionSRI(notaCreditoId);
        const pendiente = !resultado || (resultado.estado !== 'AUTORIZADO' && resultado.estado !== 'NO AUTORIZADO');

        if (pendiente && intento < maxIntentos) {
          CreditNoteService.programarConsultaAutorizacion(notaCreditoId, intento + 1, maxIntentos, delayMs);
        }
      } catch (error: any) {
        console.error('Error en la consulta de autorización automática:', error.message);
      }
    }, delayMs);

    timer.unref?.();
  }

  /**
   * Consulta el estado de autorización de una nota de crédito ya recibida por el SRI
   * y actualiza el documento con el resultado
   */
  static async consultarAutorizacionSRI(notaCreditoId: string): Promise<AutorizacionSRI | null> {
    try {
      const notaCredito = await CreditNote.findById(notaCreditoId);
      if (!notaCredito || !notaCredito.clave_acceso) {
        throw new Error('Nota de crédito no encontrada o sin clave de acceso');
      }

      const respuesta = await autorizarComprobanteSRI(notaCredito.clave_acceso);

      notaCredito.sri_estado = respuesta.estado;
      notaCredito.sri_fecha_respuesta = new Date();
      if (respuesta.mensajes) {
        notaCredito.sri_mensajes = respuesta.mensajes;
      }

      if (respuesta.estado === 'AUTORIZADO') {
        notaCredito.estado = 'AUTORIZADA';
        notaCredito.autorizacion_numero = respuesta.numeroAutorizacion || notaCredito.clave_acceso;
        notaCredito.fecha_autorizacion = respuesta.fechaAutorizacion
          ? new Date(respuesta.fechaAutorizacion)
          : new Date();
        console.log(`✅ NOTA DE CRÉDITO AUTORIZADA POR SRI - Secuencial: ${notaCredito.secuencial}`);
      }

      await notaCredito.save();
      return respuesta;
    } catch (error: any) {
      console.error('Error al consultar autorización SRI:', error.message);
      return null;
    }
  }

  /**
   * Genera y almacena el PDF (RIDE) de una nota de crédito recibida por el SRI
   */
  static async generarPDFNotaCredito(
    notaCredito: any,
    empresa: any,
    cliente: IClient,
    productos: IProduct[],
    datos: CreditNoteRequest,
  ): Promise<void> {
    try {
      const numeroAutorizacion = notaCredito.clave_acceso;
      const fechaAutorizacion = notaCredito.sri_fecha_respuesta || new Date();

      const pdfBuffer = await generateCreditNotePDF({
        notaCredito: datos,
        empresa,
        cliente,
        productos,
        claveAcceso: notaCredito.clave_acceso,
        secuencial: notaCredito.secuencial,
        fechaEmision: notaCredito.fecha_emision,
        numeroAutorizacion,
        fechaAutorizacion,
      });

      const storage = PDFStorageFactory.create();
      const filename = `nota_credito_${notaCredito.secuencial}_${notaCredito.clave_acceso}`;
      const uploadResult = await storage.upload(pdfBuffer, filename);

      const creditNotePDF = new CreditNotePDF({
        nota_credito_id: notaCredito._id,
        claveAcceso: notaCredito.clave_acceso,
        pdf_url: uploadResult.url,
        pdf_public_id: uploadResult.publicId,
        pdf_provider: uploadResult.provider,
        tamano_archivo: uploadResult.size,
        numero_autorizacion: numeroAutorizacion,
        fecha_autorizacion: fechaAutorizacion,
        estado: 'GENERADO',
      });

      await creditNotePDF.save();
      console.log(`✅ PDF de nota de crédito guardado: ${uploadResult.url}`);
    } catch (error) {
      console.error('❌ Error generating credit note PDF:', error);

      try {
        const errorPDF = new CreditNotePDF({
          nota_credito_id: notaCredito._id,
          claveAcceso: notaCredito.clave_acceso,
          pdf_url: '',
          pdf_public_id: '',
          pdf_provider: 'error',
          tamano_archivo: 0,
          numero_autorizacion: notaCredito.clave_acceso,
          fecha_autorizacion: new Date(),
          estado: 'ERROR',
        });

        await errorPDF.save();
      } catch (dbError) {
        console.error('❌ Error saving credit note PDF error record:', dbError);
      }
    }
  }
}
