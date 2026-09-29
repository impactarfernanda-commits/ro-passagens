export const DETAILED_JUSTIFICATION_MIN_LENGTH = 20;
const LATIN_LETTER = /[A-Za-zÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞàáâãäåæçèéêëìíîïðñòóôõöøùúûüýþÿ]/;

export function hasMeaningfulText(value: string | null | undefined, minLength: number) {
  const normalized = (value || "").trim();
  return normalized.length >= minLength && LATIN_LETTER.test(normalized);
}

export function detailedJustificationIsValid(value: string | null | undefined) {
  return hasMeaningfulText(value, DETAILED_JUSTIFICATION_MIN_LENGTH);
}

export function travelLocationIsValid(value: string | null | undefined) {
  return hasMeaningfulText(value, 3);
}
