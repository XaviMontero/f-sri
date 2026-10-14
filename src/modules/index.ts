import { createCreditNoteModule } from './creditNote';
import { createDebitNoteModule } from './debitNote';
import { createDeliveryGuideModule } from './deliveryGuide';
import { DocumentModuleFactory } from './types';
import { createWithholdingModule } from './withholding';

/**
 * Módulos de comprobantes adicionales a la factura. Cada uno vive en su carpeta
 * y se registra aquí. Portados de la serie de @gustavdz (#21, #23, #25, #27).
 */
export const documentModules: DocumentModuleFactory[] = [
  createCreditNoteModule, // 04
  createDebitNoteModule, // 05
  createDeliveryGuideModule, // 06
  createWithholdingModule, // 07
];
