// Heading positions are measured in the viewport, in document order.
export function getActiveHeadingId(headings, {scrollTop, maxScroll, viewportHeight, navbarHeight}) {
  if (!headings.length) return null;
  const tolerance = 1;
  const next = headings.findIndex(heading => heading.top >= navbarHeight);
  let active = headings.length - 1;
  if (next >= 0) {
    const heading = headings[next];
    active = heading.top > 0 && heading.bottom < viewportHeight / 2 ? next : next - 1;
  }

  if (maxScroll > 0) {
    // Some final headings cannot reach the navbar because the page ends first.
    // Gradually move the activation line through that remaining content.
    const last = headings[headings.length - 1];
    const overflow = Math.max(0, last.top + scrollTop - navbarHeight - maxScroll);
    if (overflow > 0) {
      const start = Math.max(0, maxScroll - overflow);
      const progress = Math.min(1, Math.max(0, (scrollTop - start) / (maxScroll - start)));
      const activationLine = navbarHeight + overflow * progress;
      for (let index = 0; index < headings.length; index += 1) {
        if (headings[index].top <= activationLine + tolerance) active = Math.max(active, index);
      }
    }
    if (scrollTop >= maxScroll - tolerance) {
      const visible = headings.findLastIndex(heading => heading.bottom > navbarHeight && heading.top < viewportHeight);
      if (visible >= 0) active = visible;
    }
  }
  return headings[active]?.id ?? null;
}
