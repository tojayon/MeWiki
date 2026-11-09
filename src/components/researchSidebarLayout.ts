/** Both panels use the same preferred widths, never each other's already-clamped result. */
export function researchSidebarWidths(width: number, leftPreferred: number, rightPreferred: number, leftVisible: boolean, rightVisible: boolean) {
  const leftMinimum = width > 0 && width < 720 ? Math.min(180, Math.floor(width * 0.45)) : 260;
  const leftMaximum = width > 0 && width < 720 ? Math.min(320, Math.floor(width * 0.5)) : Math.min(520, Math.max(260, width - 360));
  let left = Math.round(Math.min(leftMaximum, Math.max(leftMinimum, leftPreferred)));
  let right = Math.round(Math.min(520, Math.max(260, rightPreferred)));
  if (width >= 1000 && leftVisible && rightVisible && left + right > width - 360) {
    const available = width - 360 - 520;
    const requested = left + right - 520;
    left = 260 + Math.round(available * (left - 260) / requested);
    right = width - 360 - left;
  }
  return { left, right };
}
