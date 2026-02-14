const { getNetworkMessage, makeSkeleton } = require('../frontend/polish-utils');

describe('Polish utils', () => {
  it('should return offline message when network is unavailable', () => {
    expect(getNetworkMessage(false)).toMatch(/офлайн/i);
    expect(getNetworkMessage(true)).toBe('');
  });

  it('should build skeleton html with bounded line count', () => {
    const html = makeSkeleton(4);
    expect(html).toContain('skeleton-list');
    const count = (html.match(/skeleton-line/g) || []).length;
    expect(count).toBe(4);

    const clamped = makeSkeleton(999);
    const clampedCount = (clamped.match(/skeleton-line/g) || []).length;
    expect(clampedCount).toBe(12);
  });
});
