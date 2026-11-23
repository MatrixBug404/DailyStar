import React from 'react';

interface ArticleBodyProps {
  body: string;
  className?: string;
}

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; text: string }
  | { type: 'rule' };

/**
 * Reads article bodies as the Markdown the CMS editor writes.
 *
 * This intentionally supports a conservative editorial subset and returns
 * React elements: raw HTML is rendered as text, links are limited to safe
 * schemes, and no rich-text dependency or `dangerouslySetInnerHTML` is used.
 */
export function ArticleBody({ body, className = '' }: ArticleBodyProps) {
  const blocks = parseBlocks(body ?? '');

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className={`font-serif text-lg leading-8 text-charcoal ${className}`}>
      {blocks.map((block, index) => renderBlock(block, index))}
    </div>
  );
}

function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
      paragraph = [];
    }
  };

  const flushList = () => {
    if (list) {
      blocks.push({ type: 'list', ordered: list.ordered, items: list.items });
      list = null;
    }
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === '') {
      flushParagraph();
      flushList();
      index += 1;
      continue;
    }

    if (line.trim().startsWith('```')) {
      flushParagraph();
      flushList();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushList();
      // Demote one level so body Markdown never duplicates the page <h1>.
      blocks.push({
        type: 'heading',
        level: Math.min(heading[1].length + 1, 6),
        text: heading[2].trim(),
      });
      index += 1;
      continue;
    }

    if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushParagraph();
      flushList();
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      flushList();
      const quoteLines = [quote[1]];
      index += 1;
      while (index < lines.length) {
        const next = lines[index].match(/^>\s?(.*)$/);
        if (!next) {
          break;
        }
        quoteLines.push(next[1]);
        index += 1;
      }
      blocks.push({ type: 'quote', text: quoteLines.join(' ') });
      continue;
    }

    const unordered = line.match(/^\s*[-*+]\s+(.*)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (unordered || ordered) {
      flushParagraph();
      const isOrdered = Boolean(ordered);
      if (list && list.ordered !== isOrdered) {
        flushList();
      }
      if (!list) {
        list = { ordered: isOrdered, items: [] };
      }
      list.items.push((unordered ? unordered[1] : ordered![1]).trim());
      index += 1;
      continue;
    }

    if (list && /^\s+/.test(line)) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      index += 1;
      continue;
    }

    flushList();
    paragraph.push(line.trim());
    index += 1;
  }

  flushParagraph();
  flushList();
  return blocks;
}

function isSafeHref(href: string): boolean {
  return (
    href.startsWith('/') ||
    href.startsWith('#') ||
    href.startsWith('http://') ||
    href.startsWith('https://') ||
    href.startsWith('mailto:')
  );
}

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const pattern =
    /(\[([^\]]+)\]\(([^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_)/g;
  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let tokenIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const key = `${keyPrefix}-${tokenIndex}`;
    tokenIndex += 1;

    if (match[2] !== undefined && match[3] !== undefined) {
      const href = match[3];
      if (isSafeHref(href)) {
        nodes.push(
          <a
            key={key}
            href={href}
            className="text-crimson underline decoration-crimson/40 underline-offset-2 transition-colors hover:text-crimson-dark"
          >
            {renderInline(match[2], `${key}-label`)}
          </a>,
        );
      } else {
        nodes.push(match[0]);
      }
    } else if (match[4] !== undefined) {
      nodes.push(
        <code
          key={key}
          className="rounded-sm bg-paper-dark px-1.5 py-0.5 font-mono text-[0.88em] text-ink"
        >
          {match[4]}
        </code>,
      );
    } else if (match[5] !== undefined || match[6] !== undefined) {
      nodes.push(
        <strong key={key} className="font-semibold text-ink">
          {renderInline(match[5] ?? match[6] ?? '', `${key}-strong`)}
        </strong>,
      );
    } else if (match[7] !== undefined || match[8] !== undefined) {
      nodes.push(
        <em key={key}>{renderInline(match[7] ?? match[8] ?? '', `${key}-em`)}</em>,
      );
    } else {
      nodes.push(match[0]);
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function renderBlock(block: Block, index: number): React.ReactNode {
  switch (block.type) {
    case 'heading': {
      const Heading = `h${block.level}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <Heading
          key={index}
          className="mb-3 mt-9 font-serif text-2xl font-bold tracking-tight text-ink first:mt-0"
        >
          {renderInline(block.text, `heading-${index}`)}
        </Heading>
      );
    }
    case 'paragraph':
      return (
        <p key={index} className="mb-6">
          {renderInline(block.text, `paragraph-${index}`)}
        </p>
      );
    case 'list': {
      const List = block.ordered ? 'ol' : 'ul';
      return (
        <List
          key={index}
          className={`mb-6 space-y-2 pl-6 ${block.ordered ? 'list-decimal' : 'list-disc'}`}
        >
          {block.items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item, `list-${index}-${itemIndex}`)}</li>
          ))}
        </List>
      );
    }
    case 'quote':
      return (
        <blockquote
          key={index}
          className="mb-6 border-l-4 border-crimson bg-paper-dark/60 px-5 py-3 font-serif text-xl italic leading-relaxed text-ink"
        >
          {renderInline(block.text, `quote-${index}`)}
        </blockquote>
      );
    case 'code':
      return (
        <pre
          key={index}
          className="mb-6 overflow-x-auto border border-rule bg-paper-dark px-4 py-3 font-mono text-sm leading-6 text-ink"
        >
          <code>{block.text}</code>
        </pre>
      );
    case 'rule':
      return <hr key={index} className="my-8 border-rule" />;
  }
}
