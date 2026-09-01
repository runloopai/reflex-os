/** The avatar image games embed for the player in front of them. */
import { describe, expect, it } from 'vitest';
import { avatarColorIndex, avatarImage } from '../server/avatar.ts';

describe('avatarImage', () => {
  it('serves the uploaded picture when there is one', () => {
    const png = Buffer.from('fake-png');
    const image = avatarImage({
      id: 'user_1',
      name: 'Alex',
      avatar: `data:image/png;base64,${png.toString('base64')}`,
    });
    expect(image.contentType).toBe('image/png');
    expect(image.generated).toBe(false);
    expect(Buffer.from(image.body as Buffer).toString()).toBe('fake-png');
  });

  // A game points an <img> at this URL unconditionally, so "no picture" has
  // to be an image rather than a 404 it would have to handle.
  it('draws the initial chip when the player uploaded nothing', () => {
    const image = avatarImage({ id: 'user_1', name: 'alex', avatar: '' });
    expect(image.contentType).toBe('image/svg+xml');
    expect(image.generated).toBe(true);
    expect(image.body).toContain('>A<');
  });

  it('falls back to a question mark for an empty name', () => {
    expect(avatarImage({ id: 'user_1', name: '  ', avatar: '' }).body).toContain('>?<');
  });

  it('escapes a name that would otherwise break the SVG', () => {
    const image = avatarImage({ id: 'user_1', name: '<script>', avatar: '' });
    expect(image.body).not.toContain('<script>');
    expect(image.body).toContain('&lt;');
  });

  it('draws the chip for an avatar that is not a decodable data URL', () => {
    const image = avatarImage({ id: 'user_1', name: 'Alex', avatar: 'https://example.test/a.png' });
    expect(image.generated).toBe(true);
  });
});

describe('avatarColorIndex', () => {
  // Same player, same color, in the arcade and in the game beside it.
  it('is stable per player and spread across the palette', () => {
    expect(avatarColorIndex('user_1')).toBe(avatarColorIndex('user_1'));
    const ids = Array.from({ length: 40 }, (_, i) => `user_${i}`);
    expect(new Set(ids.map(avatarColorIndex)).size).toBeGreaterThan(3);
  });
});
