import { SatimLanguage } from '../language.js';

/**
 * CIB and Edahabia are the same terminal and the same flow, so the receipt
 * carries one label rather than detecting a card type.
 */
export const SATIM_PAYMENT_METHOD = 'CIB/EDAHABIA';

/**
 * Contents of a payment receipt.
 *
 * Holds every field the SATIM certification checklist expects on a receipt, and
 * nothing that renders it: the page, the PDF and the email are the
 * application's, so it can brand them freely.
 *
 * Build it once after the payment is confirmed and store it. Reusing the stored
 * paidAt is what makes a reprint identical to the original.
 */
export class Receipt {
  readonly paymentMethod: string = SATIM_PAYMENT_METHOD;

  constructor(
    /** SATIM transaction identifier, also called mdOrder. */
    readonly orderId: string | null,
    readonly orderNumber: string | null,
    readonly approvalCode: string | null,
    readonly paidAt: Date,
    readonly amount: number | null,
    readonly amountInCentimes: number | null,
    readonly currency: string | null,
    readonly currencyLabel: string,
    readonly maskedCard: string | null,
    readonly cardholderName: string | null,
    /** SATIM's own description of the payment. */
    readonly message: string | null,
    readonly language: SatimLanguage,
    /** Hotline text, in the receipt's language. */
    readonly supportMessage: string,
    /** SATIM logo, which must never be shown apart from the hotline text. */
    readonly logo: string,
  ) {}

  /** Locale of this receipt, so a reprint reads exactly as the original. */
  locale(): string {
    return this.language.toLowerCase();
  }

  /** Arabic receipts have to read right to left. */
  direction(): 'rtl' | 'ltr' {
    return this.language === SatimLanguage.AR ? 'rtl' : 'ltr';
  }
}
