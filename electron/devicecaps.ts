export {};

/**
 * Device chip identification.
 *
 * Maps a connected device's ProductType (e.g. "iPhone10,3") to its Apple SoC so
 * the UI can show which chip the phone uses, alongside its name, iOS version
 * and UDID. Pure public device-identity facts — no device I/O.
 */

export type SocFamily =
  | 'A5' | 'A6' | 'A7' | 'A8' | 'A9' | 'A10' | 'A11'
  | 'A12+' | 'pre-A5' | 'unknown';

// classifySoc maps a ProductType identifier to its SoC family. iPhone
// identifiers are "iPhoneMAJOR,MINOR"; the MAJOR number tracks the chip
// generation closely enough:
//   iPhone4,*=A5(4S) 5,*=A6(5/5c) 6,*=A7(5s) 7,*=A8(6) 8,*=A9(6s)
//   9,*=A10(7) 10,*=A11(8/X) 11+,*=A12 or newer.
// iPad numbering doesn't line up cleanly, so iPad reports 'unknown'.
export function classifySoc(productType: string): SocFamily {
  const m = /^iPhone(\d+),\d+$/.exec((productType || '').trim());
  if (!m) return 'unknown';
  const major = parseInt(m[1], 10);
  if (major <= 0 || Number.isNaN(major)) return 'unknown';
  if (major < 4) return 'pre-A5';
  switch (major) {
    case 4: return 'A5';
    case 5: return 'A6';
    case 6: return 'A7';
    case 7: return 'A8';
    case 8: return 'A9';
    case 9: return 'A10';
    case 10: return 'A11';
    default: return 'A12+';
  }
}

// socLabel is a friendlier name for display.
export function socLabel(soc: SocFamily): string {
  switch (soc) {
    case 'A10': return 'A10 Fusion';
    case 'A11': return 'A11 Bionic';
    case 'A12+': return 'A12 or newer';
    case 'pre-A5': return 'A4 or older';
    case 'unknown': return 'Unknown chip';
    default: return soc; // A5…A9
  }
}
