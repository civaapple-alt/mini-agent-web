import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPastedTextAttachment,
  MAX_PASTED_TEXT_ATTACHMENT_BYTES,
  normalizeTextAttachments,
  shouldCapturePastedText,
  utf8ByteLength,
} from '../utils/pasteAttachments.js';

test('only long, multiline, or diagnostic pastes become attachments', () => {
  assert.equal(shouldCapturePastedText('检查这个函数'), false);
  assert.equal(shouldCapturePastedText('INFO: Shutting down'), true);
  assert.equal(shouldCapturePastedText(['one', 'two', 'three', 'four', 'five', 'six'].join('\n')), true);
  assert.equal(shouldCapturePastedText('a'.repeat(1200)), true);
});

test('pasted text attachments stay bounded and normalized', () => {
  const content = '错误日志';
  const attachment = createPastedTextAttachment(content);
  assert.equal(attachment.name, 'pasted-text.txt');
  assert.equal(attachment.size, utf8ByteLength(content));
  assert.equal(normalizeTextAttachments([attachment]).length, 1);
  assert.equal(
    normalizeTextAttachments([{ content: 'x'.repeat(MAX_PASTED_TEXT_ATTACHMENT_BYTES) + '中' }]).length,
    0,
  );
});
