export const MAX_FILE_ATTACHMENTS = 16;
export const MAX_FILE_ATTACHMENT_BYTES = 8 * 1024 * 1024;

function safeName(value, fallback = '附件') {
  const name = String(value || '').replace(/[\\/\0]/g, '').trim();
  return name.slice(0, 120) || fallback;
}

export function nativePathFromFile(file) {
  const candidate = file?.path || file?.nativePath || file?.fullPath;
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : null;
}

export function fileUriPaths(dataTransfer) {
  const raw = dataTransfer?.getData?.('text/uri-list') || '';
  return raw
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => value && !value.startsWith('#'))
    .filter((value) => value.toLowerCase().startsWith('file://'))
    .map((value) => {
      try {
        return decodeURIComponent(new URL(value).pathname)
          .replace(/^\/[A-Za-z]:/, (drive) => drive.slice(1))
          .replaceAll('/', '\\');
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function nativePathsFromDataTransfer(dataTransfer) {
  const bridge = globalThis.__MINI_AGENT_FILE_BRIDGE__
    || globalThis.miniAgentFileBridge;
  if (typeof bridge?.pathsFromDataTransfer === 'function') {
    try {
      const paths = bridge.pathsFromDataTransfer(dataTransfer);
      if (Array.isArray(paths)) return paths.filter((path) => typeof path === 'string' && path.trim());
    } catch {
      // Fall through to the browser-provided path hints.
    }
  }
  const uriPaths = fileUriPaths(dataTransfer);
  if (uriPaths.length > 0) return uriPaths;
  return Array.from(dataTransfer?.files || [])
    .map(nativePathFromFile)
    .filter(Boolean);
}

export function dataTransferContainsDirectory(dataTransfer) {
  if (Array.from(dataTransfer?.files || []).some(hasDirectoryRelativePath)) return true;
  return Array.from(dataTransfer?.items || []).some((item) => {
    try {
      return item.webkitGetAsEntry?.()?.isDirectory === true;
    } catch {
      return false;
    }
  });
}

export function isImageFile(file) {
  return typeof file?.type === 'string' && file.type.startsWith('image/');
}

export function hasDirectoryRelativePath(file) {
  return typeof file?.webkitRelativePath === 'string' && file.webkitRelativePath.includes('/');
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('无法读取文件'));
    reader.readAsDataURL(file);
  });
}

export function createFileAttachment(file, contentBase64, index = 0) {
  return {
    id: `file_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
    name: safeName(file?.name),
    mimeType: file?.type || 'application/octet-stream',
    size: Number(file?.size) || 0,
    contentBase64,
    mediaKind: isImageFile(file) ? 'image' : 'file',
  };
}

export function createPathAttachment(path, index = 0) {
  const normalized = String(path || '').trim();
  if (!normalized) return null;
  const name = normalized.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '本地路径';
  return {
    id: `path_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 7)}`,
    name: safeName(name, '本地路径'),
    path: normalized,
    source: 'path',
    kind: 'path',
    mediaKind: 'file',
  };
}

export function normalizeFileAttachments(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, MAX_FILE_ATTACHMENTS)
    .filter((attachment) => attachment && typeof attachment === 'object')
    .map((attachment, index) => ({
      ...attachment,
      id: attachment.id || `attachment_${index}`,
      name: safeName(attachment.name),
      size: Number(attachment.size) || 0,
      mediaKind: attachment.mediaKind || 'file',
    }))
    .filter((attachment) => attachment.path || attachment.contentBase64);
}
