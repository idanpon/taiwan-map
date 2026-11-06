import { realpath } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';

async function physicalPath(path) {
  try {
    return await realpath(path);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return resolve(await physicalPath(dirname(path)), basename(path));
  }
}

function within(parent, path) {
  const part = relative(parent, path);
  return part === '' || (!part.startsWith('..' + sep) && part !== '..' && !part.startsWith(sep));
}

// The build removes its output directory. Never allow a typo or a symlink
// to point that removal at source files, local data, Git, or their parents.
export async function assertBuildOutput(output, root) {
  const source = await physicalPath(resolve(root));
  const target = await physicalPath(resolve(output));
  const dist = resolve(source, 'dist');
  if (within(target, source) || (within(source, target) && target !== dist)) {
    throw new Error('Unsafe output directory: use dist/ or a directory outside the repository');
  }
}
