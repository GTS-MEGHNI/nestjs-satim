import { randomInt } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Length SATIM requires of an order number. */
export const ORDER_NUMBER_LENGTH = 10;

/**
 * Ten random alphanumeric characters, in the format SATIM requires.
 *
 * Drawn from the cryptographic generator rather than Math.random: the number is
 * the only thing tying a payment attempt to an order, and a predictable one
 * would let an outsider guess another merchant's references.
 */
export function randomOrderNumber(): string {
  let orderNumber = '';

  for (let index = 0; index < ORDER_NUMBER_LENGTH; index++) {
    orderNumber += ALPHABET[randomInt(ALPHABET.length)];
  }

  return orderNumber;
}
