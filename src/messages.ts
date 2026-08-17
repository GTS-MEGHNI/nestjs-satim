import { SatimLanguage } from './language.js';

/**
 * The two strings SATIM requires the package to supply itself.
 *
 * Not an i18n library: these never grow, and they follow the language of the
 * gateway call rather than the application locale, so the wording matches what
 * the customer saw on the payment page.
 */
export interface SatimMessages {
  /**
   * Wording required by the SATIM integration guide when an authorisation is
   * reversed: the gateway reports no error of its own for that case.
   */
  transactionRejected: string;

  /**
   * Hotline text required by SATIM. It must always be shown together with the
   * SATIM logo, never on its own.
   */
  supportMessage: string;
}

export const SATIM_MESSAGES: Record<SatimLanguage, SatimMessages> = {
  [SatimLanguage.EN]: {
    transactionRejected: 'Your transaction was rejected',
    supportMessage: 'If you have a payment issue, please contact the SATIM toll-free number 3020',
  },
  [SatimLanguage.FR]: {
    transactionRejected: 'Votre transaction a été rejetée',
    supportMessage:
      'En cas de problème de paiement, veuillez contacter le numéro vert de la SATIM 3020',
  },
  [SatimLanguage.AR]: {
    transactionRejected: 'تم رفض معاملتك',
    supportMessage: 'إذا واجهت مشكلة في الدفع، يرجى الاتصال بالرقم الأخضر لساتيم 3020',
  },
};

export function messagesFor(language: SatimLanguage): SatimMessages {
  return SATIM_MESSAGES[language];
}
