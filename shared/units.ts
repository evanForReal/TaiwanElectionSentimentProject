export type Units = "metric" | "imperial";

const CM_PER_INCH = 2.54;

export function formatLength(cm: number, units: Units, opts: { precise?: boolean } = {}): string {
  if (!Number.isFinite(cm)) return "–";
  if (units === "imperial") {
    const totalInches = cm / CM_PER_INCH;
    const rounded = opts.precise ? Math.round(totalInches * 2) / 2 : Math.round(totalInches);
    const feet = Math.floor(rounded / 12);
    const inches = rounded - feet * 12;
    if (feet === 0) return `${inches}″`;
    return inches === 0 ? `${feet}′` : `${feet}′ ${inches}″`;
  }
  if (Math.abs(cm) >= 100 && !opts.precise) return `${(cm / 100).toFixed(2)} m`;
  return `${Math.round(cm)} cm`;
}

/** Value shown in a numeric input, in the user's unit (cm or inches). */
export function toDisplay(cm: number, units: Units): number {
  return units === "imperial" ? Math.round((cm / CM_PER_INCH) * 10) / 10 : Math.round(cm);
}

export function fromDisplay(value: number, units: Units): number {
  return units === "imperial" ? value * CM_PER_INCH : value;
}

export function unitLabel(units: Units): string {
  return units === "imperial" ? "in" : "cm";
}

/**
 * Parses free-form lengths: "240", "240cm", "2.4m", "8'", "8' 6\"", "8ft 6in", "96in".
 * Bare numbers are read in the user's units. Returns cm or null.
 */
export function parseLength(input: string, units: Units): number | null {
  const s = input.trim().toLowerCase().replace(/[″”]/g, '"').replace(/[′’]/g, "'");
  if (!s) return null;
  const ftIn = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|ft|feet)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inches)?)?$/);
  if (ftIn) return (parseFloat(ftIn[1]) * 12 + (ftIn[2] ? parseFloat(ftIn[2]) : 0)) * CM_PER_INCH;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*(mm|cm|m|in|"|inches)?$/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  switch (m[2]) {
    case "mm":
      return v / 10;
    case "cm":
      return v;
    case "m":
      return v * 100;
    case "in":
    case '"':
    case "inches":
      return v * CM_PER_INCH;
    default:
      return fromDisplay(v, units);
  }
}
