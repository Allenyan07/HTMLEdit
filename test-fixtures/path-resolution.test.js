const assert = require('assert');

function getPathSegments(fileUrl) {
  try {
    const url = new URL(fileUrl);
    if (url.protocol !== 'file:') return [];
    return url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part));
  } catch (e) {
    return [];
  }
}

function hasRootPathSegments(data) {
  return !!(data && Array.isArray(data.rootPathSegments) && data.rootPathSegments.length);
}

function startsWithSegments(segments, prefix) {
  if (!segments || !prefix || segments.length <= prefix.length) return false;
  for (let i = 0; i < prefix.length; i += 1) {
    if (segments[i] !== prefix[i]) return false;
  }
  return true;
}

function getAuthorizedRootSegments(fileUrl, rootName) {
  const segments = getPathSegments(fileUrl);
  if (!segments.length || !rootName) return null;
  const index = segments.lastIndexOf(rootName);
  if (index === -1) return null;
  return segments.slice(0, index + 1);
}

function getRelativeSegments(fileUrl, data) {
  const segments = getPathSegments(fileUrl);
  if (!segments.length) return null;
  if (!hasRootPathSegments(data)) throw new Error('DIRECTORY_REAUTH_REQUIRED');
  if (!startsWithSegments(segments, data.rootPathSegments)) return null;
  return segments.slice(data.rootPathSegments.length);
}

const authorizedFrom = 'file:///Users/demo/project-a/html-cases/module-a/detail.html';
const rootPathSegments = getAuthorizedRootSegments(authorizedFrom, 'html-cases');

assert.deepStrictEqual(rootPathSegments, ['Users', 'demo', 'project-a', 'html-cases']);
assert.deepStrictEqual(
  getRelativeSegments('file:///Users/demo/project-a/html-cases/module-b/detail.html', { rootPathSegments }),
  ['module-b', 'detail.html']
);
assert.strictEqual(
  getRelativeSegments('file:///Users/demo/project-b/html-cases/module-b/detail.html', { rootPathSegments }),
  null
);
assert.throws(
  () => getRelativeSegments('file:///Users/demo/project-a/html-cases/module-b/detail.html', { name: 'html-cases' }),
  /DIRECTORY_REAUTH_REQUIRED/
);

console.log('PASS path-resolution');
