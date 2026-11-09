const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  SectionBuilder,
  ThumbnailBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags
} = require('discord.js');

function splitTextSegments(value) {
  const segments = [];
  let lines = [];
  for (const line of String(value || '').split(/\r?\n/)) {
    if (line.trim() === '---') {
      if (lines.length) segments.push({ type: 'text', value: lines.join('\n') });
      segments.push({ type: 'divider' });
      lines = [];
    } else {
      lines.push(line);
    }
  }
  if (lines.length) segments.push({ type: 'text', value: lines.join('\n') });
  return segments;
}

function addTextSegments(card, segments) {
  for (const segment of segments) {
    if (segment.type === 'divider') {
      card.addSeparatorComponents(new SeparatorBuilder()
        .setDivider(true)
        .setSpacing(SeparatorSpacingSize.Small));
      continue;
    }
    const text = segment.value;
    for (let i = 0; i < text.length; i += 3900) {
      card.addTextDisplayComponents(new TextDisplayBuilder().setContent(text.slice(i, i + 3900)));
    }
  }
}

function addText(card, value) {
  addTextSegments(card, splitTextSegments(value));
}

function embedToContainer(embed, rows = []) {
  const data = typeof embed.toJSON === 'function' ? embed.toJSON() : (embed.data || embed);
  const card = new ContainerBuilder();
  if (data.color !== undefined && data.color !== null) card.setAccentColor(data.color);

  if (data.author?.name) addText(card, `-# ${data.author.name}`);
  if (data.title) {
    const title = data.url ? `[${data.title}](${data.url})` : data.title;
    addText(card, `### ${title}`);
  }

  if (data.description) {
    if (data.thumbnail?.url) {
      const segments = splitTextSegments(data.description);
      const firstTextIndex = segments.findIndex(segment => segment.type === 'text');
      const firstText = firstTextIndex === 0 ? segments.shift().value : '';
      const firstChunk = firstText.slice(0, 3900) || ' ';
      card.addSectionComponents(new SectionBuilder()
        .addTextDisplayComponents(new TextDisplayBuilder().setContent(firstChunk))
        .setThumbnailAccessory(new ThumbnailBuilder().setURL(data.thumbnail.url)));
      if (firstText.length > 3900) addText(card, firstText.slice(3900));
      addTextSegments(card, segments);
    } else {
      addText(card, data.description);
    }
  }

  const fields = (data.fields || []).map(field => `**${field.name}**\n${field.value}`);
  if (fields.length) {
    card.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    addText(card, fields.join('\n\n'));
  }

  if (data.image?.url) {
    card.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(
      new MediaGalleryItemBuilder().setURL(data.image.url)
    ));
  }

  if (data.footer?.text || data.timestamp) {
    card.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
    const timestamp = data.timestamp ? Date.parse(data.timestamp) : NaN;
    const relative = Number.isFinite(timestamp) ? ` · <t:${Math.floor(timestamp / 1000)}:R>` : '';
    addText(card, `-# ${data.footer?.text || 'ZERON'}${relative}`);
  }

  for (const row of rows) card.addActionRowComponents(row);
  return card;
}

function toV2Payload(payload, options = {}) {
  const input = typeof payload === 'string' ? { content: payload } : { ...(payload || {}) };
  const ephemeral = Boolean(options.ephemeral || input.ephemeral || (Number(input.flags || 0) & MessageFlags.Ephemeral));
  const flags = options.includeFlags === false
    ? input.flags
    : (Number(input.flags || 0) | MessageFlags.IsComponentsV2 | (ephemeral ? MessageFlags.Ephemeral : 0));

  const extra = { ...input };
  delete extra.content;
  delete extra.embeds;
  delete extra.components;
  delete extra.ephemeral;
  if (options.includeFlags !== false || input.flags !== undefined) extra.flags = flags;

  const incoming = (input.components || []).flat().filter(Boolean);
  const isContainer = component => component instanceof ContainerBuilder ||
    component.type === 17 || component.data?.type === 17;
  const cards = incoming.filter(isContainer);
  const rows = incoming.filter(component => !isContainer(component));
  const embeds = input.embeds || [];

  if (input.content) {
    const contentCard = new ContainerBuilder();
    addText(contentCard, input.content);
    cards.push(contentCard);
  }

  for (const embed of embeds) cards.push(embedToContainer(embed));

  if (!cards.length && rows.length) cards.push(new ContainerBuilder());
  if (!cards.length) cards.push(new ContainerBuilder());

  // Components V2 action rows must live inside a container.
  const finalCard = cards[cards.length - 1];
  for (const row of rows) finalCard.addActionRowComponents(row);

  return { ...extra, components: cards };
}

module.exports = { addText, embedToContainer, toV2Payload };
