/**
 * ISO 639-1 languages accepted by the SATIM hosted payment page.
 */
export const SatimLanguage = {
  AR: 'AR',
  FR: 'FR',
  EN: 'EN',
} as const;

export type SatimLanguage = (typeof SatimLanguage)[keyof typeof SatimLanguage];

export function isSatimLanguage(value: string): value is SatimLanguage {
  return value === 'AR' || value === 'FR' || value === 'EN';
}
