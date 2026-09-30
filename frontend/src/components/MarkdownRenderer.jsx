import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function MarkdownLink({ href, title, children }) {
  return (
    <a href={href} title={title} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}

const markdownComponents = { a: MarkdownLink };
const remarkPlugins = [remarkGfm];

export default function MarkdownRenderer({ children }) {
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={markdownComponents}>
      {children}
    </ReactMarkdown>
  );
}
