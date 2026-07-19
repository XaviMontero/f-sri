import { WithholdingRequest } from '../interfaces/withholding.interface';
import { convertirFecha, generarClaveAcceso } from '../utils/invoice.utils';
import { generarXMLRetencion } from '../utils/xml.utils';
import { firmarXML } from '../utils/firma.utils';
import { enviarComprobanteSRI, autorizarComprobanteSRI, AutorizacionSRI, RespuestaSRI } from '../utils/sri.utils';
import { generateWithholdingPDF } from '../utils/pdf.utils';
import { PDFStorageFactory } from './storage';
import { InvoiceService } from './invoice.service';
import Withholding from '../models/Withholding';
import WithholdingPDF from '../models/WithholdingPDF';
import IssuingCompany from '../models/IssuingCompany';
import fs from 'fs';

/**
 * Servicio para manejar todas las operaciones relacionadas con
 * comprobantes de retención ATS 2.0.0 (codDoc 07)
 */
export class WithholdingService {
  /**
   * Valida que los datos básicos de un comprobante de retención estén presentes
   */
  static validarDatosRetencion(datos: WithholdingRequest): boolean {
    return !!(
      datos.infoTributaria &&
      datos.infoCompRetencion &&
      datos.infoCompRetencion.identificacionSujetoRetenido &&
      datos.infoCompRetencion.razonSocialSujetoRetenido &&
      datos.infoCompRetencion.periodoFiscal &&
      datos.docsSustento &&
      datos.docsSustento.length > 0 &&
      datos.docsSustento.every(
        (d) =>
          d.docSustento &&
          d.docSustento.retenciones &&
          d.docSustento.retenciones.length > 0 &&
          d.docSustento.impuestosDocSustento &&
          d.docSustento.impuestosDocSustento.length > 0 &&
          d.docSustento.pagos &&
          d.docSustento.pagos.length > 0,
      )
    );
  }

  /**
   * Genera el siguiente secuencial de comprobante de retención para una empresa
   */
  static async generarSecuencial(rucCompany: string): Promise<string> {
    const empresa = await IssuingCompany.findOne({ ruc: rucCompany });
    if (!empresa) {
      throw new Error(`Empresa with RUC ${rucCompany} not found`);
    }

    const ultimaRetencion = await Withholding.findOne({
      empresa_emisora_id: empresa._id,
    }).sort({ secuencial: -1 });

    let secuencial = '000000001';
    if (ultimaRetencion) {
      const siguiente = parseInt(ultimaRetencion.secuencial) + 1;
      secuencial = siguiente.toString().padStart(9, '0');
    }
    return secuencial;
  }

  /**
   * Valida y resuelve todas las entidades necesarias para emitir el comprobante
   */
  static async procesarRetencionCompleta(datos: WithholdingRequest) {
    if (!this.validarDatosRetencion(datos)) {
      throw new Error('Datos de comprobante de retención inválidos o incompletos');
    }

    const empresa = await InvoiceService.buscarIssuingCompany(datos.infoTributaria.ruc);
    if (!empresa) {
      throw new Error('Empresa emisora no encontrada');
    }

    const secuencial = await this.generarSecuencial(empresa.ruc);
    const fechaEmision = convertirFecha(datos.infoCompRetencion.fechaEmision);

    if (isNaN(fechaEmision.getTime())) {
      throw new Error('Invalid date format');
    }

    return {
      empresa,
      secuencial,
      fechaEmision,
    };
  }

  /**
   * Procesa y guarda un comprobante de retención completo,
   * y dispara el envío asíncrono al SRI
   * @param datos Los datos del comprobante de retención recibidos del cliente
   * @returns El comprobante de retención creado
   */
  static async crearRetencionCompleta(datos: WithholdingRequest) {
    const { empresa, secuencial, fechaEmision } = await this.procesarRetencionCompleta(datos);

    const serie = `${empresa.codigo_establecimiento}${empresa.punto_emision}`;
    const claveAcceso = generarClaveAcceso({
      fecha: fechaEmision,
      tipoComprobante: '07',
      ruc: empresa.ruc,
      ambiente: empresa.tipo_ambiente.toString(),
      serie,
      secuencial,
      codigoNumerico: Math.floor(10000000 + Math.random() * 89999999).toString(),
      tipoEmision: empresa.tipo_emision.toString(),
    });

    const totalRetenido = datos.docsSustento
      .flatMap((d) => d.docSustento.retenciones)
      .reduce((s, r) => s + parseFloat(r.retencion.valorRetenido), 0);

    const xml = generarXMLRetencion(datos, empresa, claveAcceso, secuencial);

    const retencion = new Withholding({
      empresa_emisora_id: empresa._id,
      fecha_emision: fechaEmision,
      clave_acceso: claveAcceso,
      secuencial,
      estado: 'CREADA',
      tipo_identificacion_sujeto_retenido: datos.infoCompRetencion.tipoIdentificacionSujetoRetenido,
      razon_social_sujeto_retenido: datos.infoCompRetencion.razonSocialSujetoRetenido,
      identificacion_sujeto_retenido: datos.infoCompRetencion.identificacionSujetoRetenido,
      periodo_fiscal: datos.infoCompRetencion.periodoFiscal,
      total_retenido: totalRetenido,
      docs_sustento: datos.docsSustento,
      xml,
      sri_estado: 'PENDIENTE',
      datos_originales: JSON.stringify(datos),
    });

    await retencion.save();

    this.procesarEnvioSRI(retencion, empresa, datos).catch((error) => {
      console.error('Error in asynchronous SRI sending process:', error);
    });

    return {
      retencion,
      xml: retencion.xml,
      xml_firmado: retencion.xml_firmado || null,
      respuesta_sri: null,
    };
  }

  /**
   * Procesa el envío asíncrono del comprobante de retención al SRI:
   * firma XAdES-BES, recepción y consulta de autorización
   */
  static async procesarEnvioSRI(retencion: any, empresa: any, datos: WithholdingRequest): Promise<void> {
    let respuestaSRI: RespuestaSRI | null = null;

    try {
      const p12Path = empresa.certificatePath;
      const p12Password = empresa.certificatePassword || '';

      if (!p12Path || !fs.existsSync(p12Path)) {
        retencion.sri_estado = 'ERROR_FIRMA';
        retencion.sri_mensajes = { mensaje: 'Certificate not found for signing' };
        await retencion.save();
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

        const xmlFirmado = await firmarXML(retencion.xml, p12Path, workingPassword, '07');

        retencion.xml_firmado = xmlFirmado;
        retencion.sri_fecha_envio = new Date();
        await retencion.save();

        respuestaSRI = await enviarComprobanteSRI(xmlFirmado);

        retencion.sri_fecha_respuesta = new Date();
        retencion.sri_estado = respuestaSRI.estado;
        if (respuestaSRI.mensajes) {
          retencion.sri_mensajes = respuestaSRI.mensajes;
        }
        await retencion.save();

        if (respuestaSRI.estado === 'RECIBIDA') {
          console.log(
            `✅ RETENCIÓN RECIBIDA POR SRI - ID: ${retencion._id}, Clave: ${retencion.clave_acceso}, Secuencial: ${retencion.secuencial}`,
          );
          await this.generarPDFRetencion(retencion, empresa, datos);
          this.programarConsultaAutorizacion(String(retencion._id));
        } else {
          console.log(`⚠️ SRI Estado: ${respuestaSRI.estado} - Retención ID: ${retencion._id}`);
        }
      } catch (error: any) {
        console.error('Error during certificate processing or signing:', error.message);
        retencion.sri_estado = 'ERROR_FIRMA';
        retencion.sri_mensajes = { error: error.message };
        await retencion.save();
      }
    } catch (error: any) {
      console.error('Error during signing or sending to SRI:', error.message);
      retencion.sri_estado = 'ERROR_PROCESO';
      retencion.sri_mensajes = { error: error.message };
      await retencion.save();
    }
  }

  /**
   * Programa consultas de autorización al SRI con reintentos
   */
  static programarConsultaAutorizacion(retencionId: string, intento = 1, maxIntentos = 3, delayMs = 5000): void {
    const timer = setTimeout(async () => {
      try {
        const resultado = await WithholdingService.consultarAutorizacionSRI(retencionId);
        const pendiente = !resultado || (resultado.estado !== 'AUTORIZADO' && resultado.estado !== 'NO AUTORIZADO');

        if (pendiente && intento < maxIntentos) {
          WithholdingService.programarConsultaAutorizacion(retencionId, intento + 1, maxIntentos, delayMs);
        }
      } catch (error: any) {
        console.error('Error en la consulta de autorización automática:', error.message);
      }
    }, delayMs);

    timer.unref?.();
  }

  /**
   * Consulta el estado de autorización de un comprobante de retención ya recibido
   * por el SRI y actualiza el documento con el resultado
   */
  static async consultarAutorizacionSRI(retencionId: string): Promise<AutorizacionSRI | null> {
    try {
      const retencion = await Withholding.findById(retencionId);
      if (!retencion || !retencion.clave_acceso) {
        throw new Error('Comprobante de retención no encontrado o sin clave de acceso');
      }

      const respuesta = await autorizarComprobanteSRI(retencion.clave_acceso);

      retencion.sri_estado = respuesta.estado;
      retencion.sri_fecha_respuesta = new Date();
      if (respuesta.mensajes) {
        retencion.sri_mensajes = respuesta.mensajes;
      }

      if (respuesta.estado === 'AUTORIZADO') {
        retencion.estado = 'AUTORIZADA';
        retencion.autorizacion_numero = respuesta.numeroAutorizacion || retencion.clave_acceso;
        retencion.fecha_autorizacion = respuesta.fechaAutorizacion ? new Date(respuesta.fechaAutorizacion) : new Date();
        console.log(`✅ RETENCIÓN AUTORIZADA POR SRI - Secuencial: ${retencion.secuencial}`);
      }

      await retencion.save();
      return respuesta;
    } catch (error: any) {
      console.error('Error al consultar autorización SRI:', error.message);
      return null;
    }
  }

  /**
   * Genera y almacena el PDF (RIDE) de un comprobante de retención recibido por el SRI
   */
  static async generarPDFRetencion(retencion: any, empresa: any, datos: WithholdingRequest): Promise<void> {
    try {
      const numeroAutorizacion = retencion.clave_acceso;
      const fechaAutorizacion = retencion.sri_fecha_respuesta || new Date();

      const pdfBuffer = await generateWithholdingPDF({
        retencion: datos,
        empresa,
        claveAcceso: retencion.clave_acceso,
        secuencial: retencion.secuencial,
        fechaEmision: retencion.fecha_emision,
        numeroAutorizacion,
        fechaAutorizacion,
      });

      const storage = PDFStorageFactory.create();
      const filename = `retencion_${retencion.secuencial}_${retencion.clave_acceso}`;
      const uploadResult = await storage.upload(pdfBuffer, filename);

      const withholdingPDF = new WithholdingPDF({
        retencion_id: retencion._id,
        claveAcceso: retencion.clave_acceso,
        pdf_url: uploadResult.url,
        pdf_public_id: uploadResult.publicId,
        pdf_provider: uploadResult.provider,
        tamano_archivo: uploadResult.size,
        numero_autorizacion: numeroAutorizacion,
        fecha_autorizacion: fechaAutorizacion,
        estado: 'GENERADO',
      });

      await withholdingPDF.save();
      console.log(`✅ PDF de retención guardado: ${uploadResult.url}`);
    } catch (error) {
      console.error('❌ Error generating withholding PDF:', error);

      try {
        const errorPDF = new WithholdingPDF({
          retencion_id: retencion._id,
          claveAcceso: retencion.clave_acceso,
          pdf_url: '',
          pdf_public_id: '',
          pdf_provider: 'error',
          tamano_archivo: 0,
          numero_autorizacion: retencion.clave_acceso,
          fecha_autorizacion: new Date(),
          estado: 'ERROR',
        });

        await errorPDF.save();
      } catch (dbError) {
        console.error('❌ Error saving withholding PDF error record:', dbError);
      }
    }
  }
}
