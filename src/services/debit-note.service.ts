import { DebitNoteRequest } from '../interfaces/debit-note.interface';
import { convertirFecha, generarClaveAcceso } from '../utils/invoice.utils';
import { generarXMLNotaDebito } from '../utils/xml.utils';
import { firmarXML } from '../utils/firma.utils';
import { enviarComprobanteSRI, autorizarComprobanteSRI, AutorizacionSRI, RespuestaSRI } from '../utils/sri.utils';
import { generateDebitNotePDF } from '../utils/pdf.utils';
import { PDFStorageFactory } from './storage';
import { InvoiceService } from './invoice.service';
import DebitNote from '../models/DebitNote';
import DebitNotePDF from '../models/DebitNotePDF';
import Invoice from '../models/Invoice';
import IssuingCompany from '../models/IssuingCompany';
import { IClient } from '../models/Client';
import fs from 'fs';

/**
 * Servicio para manejar todas las operaciones relacionadas con notas de débito (codDoc 05)
 */
export class DebitNoteService {
  /**
   * Valida que los datos básicos de una nota de débito estén presentes
   */
  static validarDatosNotaDebito(datos: DebitNoteRequest): boolean {
    return !!(
      datos.infoTributaria &&
      datos.infoNotaDebito &&
      datos.motivos &&
      datos.motivos.length > 0 &&
      datos.infoNotaDebito.numDocModificado &&
      datos.infoNotaDebito.impuestos &&
      datos.infoNotaDebito.impuestos.length > 0 &&
      datos.infoNotaDebito.pagos &&
      datos.infoNotaDebito.pagos.length > 0
    );
  }

  /**
   * Genera el siguiente secuencial de nota de débito para una empresa
   */
  static async generarSecuencial(rucCompany: string): Promise<string> {
    const empresa = await IssuingCompany.findOne({ ruc: rucCompany });
    if (!empresa) {
      throw new Error(`Empresa with RUC ${rucCompany} not found`);
    }

    const ultimaNota = await DebitNote.findOne({
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
   * Valida y resuelve todas las entidades necesarias para emitir la nota de débito
   */
  static async procesarNotaDebitoCompleta(datos: DebitNoteRequest) {
    if (!this.validarDatosNotaDebito(datos)) {
      throw new Error('Datos de nota de débito inválidos o incompletos');
    }

    const tipoIdent = await InvoiceService.buscarTipoIdentificacion(datos.infoNotaDebito.tipoIdentificacionComprador);
    if (!tipoIdent) {
      throw new Error('Identification type not found');
    }

    const empresa = await InvoiceService.buscarIssuingCompany(datos.infoTributaria.ruc);
    if (!empresa) {
      throw new Error('Empresa emisora no encontrada');
    }

    const cliente = await InvoiceService.buscarClient(datos.infoNotaDebito.identificacionComprador);
    if (!cliente) {
      throw new Error('Client not found');
    }

    const secuencial = await this.generarSecuencial(empresa.ruc);
    const fechaEmision = convertirFecha(datos.infoNotaDebito.fechaEmision);
    const fechaEmisionDocSustento = convertirFecha(datos.infoNotaDebito.fechaEmisionDocSustento);

    if (isNaN(fechaEmision.getTime()) || isNaN(fechaEmisionDocSustento.getTime())) {
      throw new Error('Invalid date format');
    }

    // Optional link to the modified invoice when it exists in this system
    const facturaModificada = await Invoice.findOne({
      empresa_emisora_id: empresa._id,
      secuencial: datos.infoNotaDebito.numDocModificado.split('-').pop(),
    });

    return {
      empresa,
      cliente,
      secuencial,
      fechaEmision,
      fechaEmisionDocSustento,
      facturaModificada,
    };
  }

  /**
   * Procesa y guarda una nota de débito completa,
   * y dispara el envío asíncrono al SRI
   * @param datos Los datos de la nota de débito recibidos del cliente
   * @returns La nota de débito creada
   */
  static async crearNotaDebitoCompleta(datos: DebitNoteRequest) {
    const { empresa, cliente, secuencial, fechaEmision, fechaEmisionDocSustento, facturaModificada } =
      await this.procesarNotaDebitoCompleta(datos);

    const serie = `${empresa.codigo_establecimiento}${empresa.punto_emision}`;
    const claveAcceso = generarClaveAcceso({
      fecha: fechaEmision,
      tipoComprobante: '05',
      ruc: empresa.ruc,
      ambiente: empresa.tipo_ambiente.toString(),
      serie,
      secuencial,
      codigoNumerico: Math.floor(10000000 + Math.random() * 89999999).toString(),
      tipoEmision: empresa.tipo_emision.toString(),
    });

    const totalSinImpuestos = parseFloat(datos.infoNotaDebito.totalSinImpuestos);
    const totalImpuestos = datos.infoNotaDebito.impuestos.reduce((s, i) => s + parseFloat(i.impuesto.valor), 0);
    const valorTotal = parseFloat(datos.infoNotaDebito.valorTotal);

    const xml = generarXMLNotaDebito(datos, empresa, cliente, claveAcceso, secuencial);

    const notaDebito = new DebitNote({
      empresa_emisora_id: empresa._id,
      cliente_id: cliente._id,
      factura_modificada_id: facturaModificada?._id,
      fecha_emision: fechaEmision,
      clave_acceso: claveAcceso,
      secuencial,
      estado: 'CREADA',
      cod_doc_modificado: datos.infoNotaDebito.codDocModificado,
      num_doc_modificado: datos.infoNotaDebito.numDocModificado,
      fecha_emision_doc_sustento: fechaEmisionDocSustento,
      total_sin_impuestos: totalSinImpuestos,
      total_impuestos: totalImpuestos,
      valor_total: valorTotal,
      motivos: datos.motivos.map((m) => ({ razon: m.motivo.razon, valor: parseFloat(m.motivo.valor) })),
      xml,
      sri_estado: 'PENDIENTE',
      datos_originales: JSON.stringify(datos),
    });

    await notaDebito.save();

    this.procesarEnvioSRI(notaDebito, empresa, cliente, datos).catch((error) => {
      console.error('Error in asynchronous SRI sending process:', error);
    });

    return {
      nota_debito: notaDebito,
      xml: notaDebito.xml,
      xml_firmado: notaDebito.xml_firmado || null,
      respuesta_sri: null,
    };
  }

  /**
   * Procesa el envío asíncrono de la nota de débito al SRI:
   * firma XAdES-BES, recepción y consulta de autorización
   */
  static async procesarEnvioSRI(
    notaDebito: any,
    empresa: any,
    cliente: IClient,
    datos: DebitNoteRequest,
  ): Promise<void> {
    let respuestaSRI: RespuestaSRI | null = null;

    try {
      const p12Path = empresa.certificatePath;
      const p12Password = empresa.certificatePassword || '';

      if (!p12Path || !fs.existsSync(p12Path)) {
        notaDebito.sri_estado = 'ERROR_FIRMA';
        notaDebito.sri_mensajes = { mensaje: 'Certificate not found for signing' };
        await notaDebito.save();
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

        const xmlFirmado = await firmarXML(notaDebito.xml, p12Path, workingPassword, '05');

        notaDebito.xml_firmado = xmlFirmado;
        notaDebito.sri_fecha_envio = new Date();
        await notaDebito.save();

        respuestaSRI = await enviarComprobanteSRI(xmlFirmado);

        notaDebito.sri_fecha_respuesta = new Date();
        notaDebito.sri_estado = respuestaSRI.estado;
        if (respuestaSRI.mensajes) {
          notaDebito.sri_mensajes = respuestaSRI.mensajes;
        }
        await notaDebito.save();

        if (respuestaSRI.estado === 'RECIBIDA') {
          console.log(
            `✅ NOTA DE DÉBITO RECIBIDA POR SRI - ID: ${notaDebito._id}, Clave: ${notaDebito.clave_acceso}, Secuencial: ${notaDebito.secuencial}`,
          );
          await this.generarPDFNotaDebito(notaDebito, empresa, cliente, datos);
          this.programarConsultaAutorizacion(String(notaDebito._id));
        } else {
          console.log(`⚠️ SRI Estado: ${respuestaSRI.estado} - Nota de débito ID: ${notaDebito._id}`);
        }
      } catch (error: any) {
        console.error('Error during certificate processing or signing:', error.message);
        notaDebito.sri_estado = 'ERROR_FIRMA';
        notaDebito.sri_mensajes = { error: error.message };
        await notaDebito.save();
      }
    } catch (error: any) {
      console.error('Error during signing or sending to SRI:', error.message);
      notaDebito.sri_estado = 'ERROR_PROCESO';
      notaDebito.sri_mensajes = { error: error.message };
      await notaDebito.save();
    }
  }

  /**
   * Programa consultas de autorización al SRI con reintentos
   */
  static programarConsultaAutorizacion(notaDebitoId: string, intento = 1, maxIntentos = 3, delayMs = 5000): void {
    const timer = setTimeout(async () => {
      try {
        const resultado = await DebitNoteService.consultarAutorizacionSRI(notaDebitoId);
        const pendiente = !resultado || (resultado.estado !== 'AUTORIZADO' && resultado.estado !== 'NO AUTORIZADO');

        if (pendiente && intento < maxIntentos) {
          DebitNoteService.programarConsultaAutorizacion(notaDebitoId, intento + 1, maxIntentos, delayMs);
        }
      } catch (error: any) {
        console.error('Error en la consulta de autorización automática:', error.message);
      }
    }, delayMs);

    timer.unref?.();
  }

  /**
   * Consulta el estado de autorización de una nota de débito ya recibida por el SRI
   * y actualiza el documento con el resultado
   */
  static async consultarAutorizacionSRI(notaDebitoId: string): Promise<AutorizacionSRI | null> {
    try {
      const notaDebito = await DebitNote.findById(notaDebitoId);
      if (!notaDebito || !notaDebito.clave_acceso) {
        throw new Error('Nota de débito no encontrada o sin clave de acceso');
      }

      const respuesta = await autorizarComprobanteSRI(notaDebito.clave_acceso);

      notaDebito.sri_estado = respuesta.estado;
      notaDebito.sri_fecha_respuesta = new Date();
      if (respuesta.mensajes) {
        notaDebito.sri_mensajes = respuesta.mensajes;
      }

      if (respuesta.estado === 'AUTORIZADO') {
        notaDebito.estado = 'AUTORIZADA';
        notaDebito.autorizacion_numero = respuesta.numeroAutorizacion || notaDebito.clave_acceso;
        notaDebito.fecha_autorizacion = respuesta.fechaAutorizacion
          ? new Date(respuesta.fechaAutorizacion)
          : new Date();
        console.log(`✅ NOTA DE DÉBITO AUTORIZADA POR SRI - Secuencial: ${notaDebito.secuencial}`);
      }

      await notaDebito.save();
      return respuesta;
    } catch (error: any) {
      console.error('Error al consultar autorización SRI:', error.message);
      return null;
    }
  }

  /**
   * Genera y almacena el PDF (RIDE) de una nota de débito recibida por el SRI
   */
  static async generarPDFNotaDebito(
    notaDebito: any,
    empresa: any,
    cliente: IClient,
    datos: DebitNoteRequest,
  ): Promise<void> {
    try {
      const numeroAutorizacion = notaDebito.clave_acceso;
      const fechaAutorizacion = notaDebito.sri_fecha_respuesta || new Date();

      const pdfBuffer = await generateDebitNotePDF({
        notaDebito: datos,
        empresa,
        cliente,
        claveAcceso: notaDebito.clave_acceso,
        secuencial: notaDebito.secuencial,
        fechaEmision: notaDebito.fecha_emision,
        numeroAutorizacion,
        fechaAutorizacion,
      });

      const storage = PDFStorageFactory.create();
      const filename = `nota_debito_${notaDebito.secuencial}_${notaDebito.clave_acceso}`;
      const uploadResult = await storage.upload(pdfBuffer, filename);

      const debitNotePDF = new DebitNotePDF({
        nota_debito_id: notaDebito._id,
        claveAcceso: notaDebito.clave_acceso,
        pdf_url: uploadResult.url,
        pdf_public_id: uploadResult.publicId,
        pdf_provider: uploadResult.provider,
        tamano_archivo: uploadResult.size,
        numero_autorizacion: numeroAutorizacion,
        fecha_autorizacion: fechaAutorizacion,
        estado: 'GENERADO',
      });

      await debitNotePDF.save();
      console.log(`✅ PDF de nota de débito guardado: ${uploadResult.url}`);
    } catch (error) {
      console.error('❌ Error generating debit note PDF:', error);

      try {
        const errorPDF = new DebitNotePDF({
          nota_debito_id: notaDebito._id,
          claveAcceso: notaDebito.clave_acceso,
          pdf_url: '',
          pdf_public_id: '',
          pdf_provider: 'error',
          tamano_archivo: 0,
          numero_autorizacion: notaDebito.clave_acceso,
          fecha_autorizacion: new Date(),
          estado: 'ERROR',
        });

        await errorPDF.save();
      } catch (dbError) {
        console.error('❌ Error saving debit note PDF error record:', dbError);
      }
    }
  }
}
