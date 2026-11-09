// Embed builder cards as Components V2. A line that is only --- becomes a divider line.
const {
  ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize,
  MediaGalleryBuilder, MediaGalleryItemBuilder
} = require('discord.js');

function hexToInt(hex, fallback) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  return match ? parseInt(match[1], 16) : fallback;
}

function buildEmbedCard({ title, description, imageUrl, colorHex }) {
  const card = new ContainerBuilder().setAccentColor(hexToInt(colorHex, 0x46BBFF));
  if (title) card.addTextDisplayComponents(new TextDisplayBuilder().setContent(`### ${title}`));

  let buffer = [];
  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) card.addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
    buffer = [];
  };
  for (const line of String(description || '').split('\n')) {
    if (line.trim() === '---') {
      flush();
      card.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    } else {
      buffer.push(line);
    }
  }
  flush();

  if (imageUrl) card.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imageUrl)));
  return card;
}

module.exports = { buildEmbedCard, hexToInt };
