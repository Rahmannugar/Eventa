import { allCountries } from 'country-region-data';

export interface LocationOption {
  label: string;
  value: string;
}

export const countryOptions: LocationOption[] = allCountries
  .map(([name, code]) => ({ label: name, value: code }))
  .sort((left, right) => left.label.localeCompare(right.label));

export function regionOptions(countryCode: string): LocationOption[] {
  const country = allCountries.find(([, code]) => code === countryCode);
  return (country?.[2] ?? [])
    .filter(([, code]) => /^[A-Z0-9][A-Z0-9-]{0,7}$/.test(code))
    .map(([name, code]) => ({ label: name, value: code }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

export function regionCodeForName(
  countryCode: string,
  regionName: string,
): string {
  return (
    regionOptions(countryCode).find(
      ({ label }) =>
        label.toLocaleLowerCase('en') === regionName.toLocaleLowerCase('en'),
    )?.value ?? ''
  );
}

export function regionNameForCode(
  countryCode: string,
  regionCode: string,
): string {
  return (
    regionOptions(countryCode).find(({ value }) => value === regionCode)
      ?.label ?? ''
  );
}
