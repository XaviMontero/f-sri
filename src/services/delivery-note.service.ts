import { DeliveryNoteRequest } from '../interfaces/delivery-note.interface';
import { convertirFecha, generarClaveAcceso } from '../utils/invoice.utils';
import { generarXMLGuiaRemision } from '../utils/xml.utils';
import { firmarXML } from '../utils/firma.utils';
import { enviarComprobanteSRI, autorizarComprobanteSRI, AutorizacionSRI, RespuestaSRI } from '../utils/sri.utils';
import { generateDeliveryNotePDF } from '../utils/pdf.utils';
import { PDFStorageFactory } from './storage';
import { InvoiceService } from './invoice.service';
import DeliveryNote from '../models/DeliveryNote';
import DeliveryNotePDF from '../models/DeliveryNotePDF';
import IssuingCompany from '../models/IssuingCompany';
import fs from 'fs';

/**
 * Servicio para manejar todas las operaciones relacionadas con guías de remisión (codDoc 06)
 */
export class DeliveryNoteService {
  /**
   * Valida que los datos básicos de una guía de remisión estén presentes
   */
  static validarDatosGuiaRemision(datos: DeliveryNoteRequest): boolean {
    return !!(
      datos.infoTributaria &&
      datos.infoGuiaRemision &&
      datos.infoGuiaRemision.dirPartida &&
      datos.infoGuiaRemision.razonSocialTransportista &&
      datos.infoGuiaRemision.rucTransportista &&
      datos.infoGuiaRemision.placa &&
      datos.destinatarios &&
      datos.destinatarios.length > 0 &&
      datos.destinatarios.every((d) => d.destinatario && d.destinatario.detalles && d.destinatario.detalles.length > 0)
    );
  }

  /**
   * Genera el siguiente secuencial de guía de remisión para una empresa
   */
  static async generarSecuencial(rucCompany: string): Promise<string> {
    const empresa = await IssuingCompany.findOne({ ruc: rucCompany });
    if (!empresa) {
      throw new Error(`Empresa with RUC ${rucCompany} not found`);
    }

    const ultimaGuia = await DeliveryNote.findOne({
      empresa_emisora_id: empresa._id,
    }).sort({ secuencial: -1 });

    let secuencial = '000000001';
    if (ultimaGuia) {
      const siguiente = parseInt(ultimaGuia.secuencial) + 1;
      secuencial = siguiente.toString().padStart(9, '0');
    }
    return secuencial;
  }

  /**
   * Valida y resuelve todas las entidades necesarias para emitir la guía de remisión
   */
  static async procesarGuiaRemisionCompleta(datos: DeliveryNoteRequest) {
    if (!this.validarDatosGuiaRemision(datos)) {
      throw new Error('Datos de guía de remisión inválidos o incompletos');
    }

    const empresa = await InvoiceService.buscarIssuingCompany(datos.infoTributaria.ruc);
    if (!empresa) {
      throw new Error('Empresa emisora no encontrada');
    }

    const secuencial = await this.generarSecuencial(empresa.ruc);
    const fechaEmision = convertirFecha(datos.infoGuiaRemision.fechaEmision);
    const fechaIniTransporte = convertirFecha(datos.infoGuiaRemision.fechaIniTransporte);
    const fechaFinTransporte = convertirFecha(datos.infoGuiaRemision.fechaFinTransporte);

    if (isNaN(fechaEmision.getTime()) || isNaN(fechaIniTransporte.getTime()) || isNaN(fechaFinTransporte.getTime())) {
      throw new Error('Invalid date format');
    }

    return {
      empresa,
      secuencial,
      fechaEmision,
      fechaIniTransporte,
      fechaFinTransporte,
    };
  }

  /**
   * Procesa y guarda una guía de remisión completa,
   * y dispara el envío asíncrono al SRI
   * @param datos Los datos de la guía de remisión recibidos del cliente
   * @returns La guía de remisión creada
   */
  static async crearGuiaRemisionCompleta(datos: DeliveryNoteRequest) {
    const { empresa, secuencial, fechaEmision, fechaIniTransporte, fechaFinTransporte } =
      await this.procesarGuiaRemisionCompleta(datos);

    const serie = `${empresa.codigo_establecimiento}${empresa.punto_emision}`;
    const claveAcceso = generarClaveAcceso({
      fecha: fechaEmision,
      tipoComprobante: '06',
      ruc: empresa.ruc,
      ambiente: empresa.tipo_ambiente.toString(),
      serie,
      secuencial,
      codigoNumerico: Math.floor(10000000 + Math.random() * 89999999).toString(),
      tipoEmision: empresa.tipo_emision.toString(),
    });

    const xml = generarXMLGuiaRemision(datos, empresa, claveAcceso, secuencial);

    const guiaRemision = new DeliveryNote({
      empresa_emisora_id: empresa._id,
      fecha_emision: fechaEmision,
      clave_acceso: claveAcceso,
      secuencial,
      estado: 'CREADA',
      dir_partida: datos.infoGuiaRemision.dirPartida,
      razon_social_transportista: datos.infoGuiaRemision.razonSocialTransportista,
      tipo_identificacion_transportista: datos.infoGuiaRemision.tipoIdentificacionTransportista,
      ruc_transportista: datos.infoGuiaRemision.rucTransportista,
      fecha_ini_transporte: fechaIniTransporte,
      fecha_fin_transporte: fechaFinTransporte,
      placa: datos.infoGuiaRemision.placa,
      destinatarios: datos.destinatarios,
      xml,
      sri_estado: 'PENDIENTE',
      datos_originales: JSON.stringify(datos),
    });

    await guiaRemision.save();

    this.procesarEnvioSRI(guiaRemision, empresa, datos).catch((error) => {
      console.error('Error in asynchronous SRI sending process:', error);
    });

    return {
      guia_remision: guiaRemision,
      xml: guiaRemision.xml,
      xml_firmado: guiaRemision.xml_firmado || null,
      respuesta_sri: null,
    };
  }

  /**
   * Procesa el envío asíncrono de la guía de remisión al SRI:
   * firma XAdES-BES, recepción y consulta de autorización
   */
  static async procesarEnvioSRI(guiaRemision: any, empresa: any, datos: DeliveryNoteRequest): Promise<void> {
    let respuestaSRI: RespuestaSRI | null = null;

    try {
      const p12Path = empresa.certificatePath;
      const p12Password = empresa.certificatePassword || '';

      if (!p12Path || !fs.existsSync(p12Path)) {
        guiaRemision.sri_estado = 'ERROR_FIRMA';
        guiaRemision.sri_mensajes = { mensaje: 'Certificate not found for signing' };
        await guiaRemision.save();
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

        const xmlFirmado = await firmarXML(guiaRemision.xml, p12Path, workingPassword, '06');

        guiaRemision.xml_firmado = xmlFirmado;
        guiaRemision.sri_fecha_envio = new Date();
        await guiaRemision.save();

        respuestaSRI = await enviarComprobanteSRI(xmlFirmado);

        guiaRemision.sri_fecha_respuesta = new Date();
        guiaRemision.sri_estado = respuestaSRI.estado;
        if (respuestaSRI.mensajes) {
          guiaRemision.sri_mensajes = respuestaSRI.mensajes;
        }
        await guiaRemision.save();

        if (respuestaSRI.estado === 'RECIBIDA') {
          console.log(
            `✅ GUÍA DE REMISIÓN RECIBIDA POR SRI - ID: ${guiaRemision._id}, Clave: ${guiaRemision.clave_acceso}, Secuencial: ${guiaRemision.secuencial}`,
          );
          await this.generarPDFGuiaRemision(guiaRemision, empresa, datos);
          this.programarConsultaAutorizacion(String(guiaRemision._id));
        } else {
          console.log(`⚠️ SRI Estado: ${respuestaSRI.estado} - Guía de remisión ID: ${guiaRemision._id}`);
        }
      } catch (error: any) {
        console.error('Error during certificate processing or signing:', error.message);
        guiaRemision.sri_estado = 'ERROR_FIRMA';
        guiaRemision.sri_mensajes = { error: error.message };
        await guiaRemision.save();
      }
    } catch (error: any) {
      console.error('Error during signing or sending to SRI:', error.message);
      guiaRemision.sri_estado = 'ERROR_PROCESO';
      guiaRemision.sri_mensajes = { error: error.message };
      await guiaRemision.save();
    }
  }

  /**
   * Programa consultas de autorización al SRI con reintentos
   */
  static programarConsultaAutorizacion(guiaRemisionId: string, intento = 1, maxIntentos = 3, delayMs = 5000): void {
    const timer = setTimeout(async () => {
      try {
        const resultado = await DeliveryNoteService.consultarAutorizacionSRI(guiaRemisionId);
        const pendiente = !resultado || (resultado.estado !== 'AUTORIZADO' && resultado.estado !== 'NO AUTORIZADO');

        if (pendiente && intento < maxIntentos) {
          DeliveryNoteService.programarConsultaAutorizacion(guiaRemisionId, intento + 1, maxIntentos, delayMs);
        }
      } catch (error: any) {
        console.error('Error en la consulta de autorización automática:', error.message);
      }
    }, delayMs);

    timer.unref?.();
  }

  /**
   * Consulta el estado de autorización de una guía de remisión ya recibida por el SRI
   * y actualiza el documento con el resultado
   */
  static async consultarAutorizacionSRI(guiaRemisionId: string): Promise<AutorizacionSRI | null> {
    try {
      const guiaRemision = await DeliveryNote.findById(guiaRemisionId);
      if (!guiaRemision || !guiaRemision.clave_acceso) {
        throw new Error('Guía de remisión no encontrada o sin clave de acceso');
      }

      const respuesta = await autorizarComprobanteSRI(guiaRemision.clave_acceso);

      guiaRemision.sri_estado = respuesta.estado;
      guiaRemision.sri_fecha_respuesta = new Date();
      if (respuesta.mensajes) {
        guiaRemision.sri_mensajes = respuesta.mensajes;
      }

      if (respuesta.estado === 'AUTORIZADO') {
        guiaRemision.estado = 'AUTORIZADA';
        guiaRemision.autorizacion_numero = respuesta.numeroAutorizacion || guiaRemision.clave_acceso;
        guiaRemision.fecha_autorizacion = respuesta.fechaAutorizacion
          ? new Date(respuesta.fechaAutorizacion)
          : new Date();
        console.log(`✅ GUÍA DE REMISIÓN AUTORIZADA POR SRI - Secuencial: ${guiaRemision.secuencial}`);
      }

      await guiaRemision.save();
      return respuesta;
    } catch (error: any) {
      console.error('Error al consultar autorización SRI:', error.message);
      return null;
    }
  }

  /**
   * Genera y almacena el PDF (RIDE) de una guía de remisión recibida por el SRI
   */
  static async generarPDFGuiaRemision(guiaRemision: any, empresa: any, datos: DeliveryNoteRequest): Promise<void> {
    try {
      const numeroAutorizacion = guiaRemision.clave_acceso;
      const fechaAutorizacion = guiaRemision.sri_fecha_respuesta || new Date();

      const pdfBuffer = await generateDeliveryNotePDF({
        guiaRemision: datos,
        empresa,
        claveAcceso: guiaRemision.clave_acceso,
        secuencial: guiaRemision.secuencial,
        fechaEmision: guiaRemision.fecha_emision,
        numeroAutorizacion,
        fechaAutorizacion,
      });

      const storage = PDFStorageFactory.create();
      const filename = `guia_remision_${guiaRemision.secuencial}_${guiaRemision.clave_acceso}`;
      const uploadResult = await storage.upload(pdfBuffer, filename);

      const deliveryNotePDF = new DeliveryNotePDF({
        guia_remision_id: guiaRemision._id,
        claveAcceso: guiaRemision.clave_acceso,
        pdf_url: uploadResult.url,
        pdf_public_id: uploadResult.publicId,
        pdf_provider: uploadResult.provider,
        tamano_archivo: uploadResult.size,
        numero_autorizacion: numeroAutorizacion,
        fecha_autorizacion: fechaAutorizacion,
        estado: 'GENERADO',
      });

      await deliveryNotePDF.save();
      console.log(`✅ PDF de guía de remisión guardado: ${uploadResult.url}`);
    } catch (error) {
      console.error('❌ Error generating delivery note PDF:', error);

      try {
        const errorPDF = new DeliveryNotePDF({
          guia_remision_id: guiaRemision._id,
          claveAcceso: guiaRemision.clave_acceso,
          pdf_url: '',
          pdf_public_id: '',
          pdf_provider: 'error',
          tamano_archivo: 0,
          numero_autorizacion: guiaRemision.clave_acceso,
          fecha_autorizacion: new Date(),
          estado: 'ERROR',
        });

        await errorPDF.save();
      } catch (dbError) {
        console.error('❌ Error saving delivery note PDF error record:', dbError);
      }
    }
  }
}
