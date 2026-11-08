import { normalizeApiBase } from '../public/client-runtime.js';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { planningPage } from '../src/planning-ui.mjs';
import { appIcon } from './generate-icons.mjs';
import { page, securityHeaders } from '../src/ui.mjs';
import { assertBuildOutput } from './build-output.mjs';
export async function buildPages({
  output = resolve('dist'),
  apiBase = '',
  customDomain = '',
  authMode = 'bearer',
} = {}) {
  if (!['cookie', 'bearer'].includes(authMode))
    throw new Error('PAGES_AUTH_MODE must be cookie or bearer');
  normalizeApiBase(apiBase);
  if (
    customDomain &&
    !/^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/.test(
      customDomain,
    )
  )
    throw new Error('Invalid PAGES_CUSTOM_DOMAIN');
  const vendor = new URL('../public/vendor/maplibre-6.15.0/', import.meta.url),
    manifest = JSON.parse(await readFile(new URL('manifest.json', vendor), 'utf8'));
  if (manifest.version !== '6.15.0') throw new Error('Unexpected MapLibre version');
  for (const [name, expected] of Object.entries(manifest.sha256))
    if (
      createHash('sha256')
        .update(await readFile(new URL(name, vendor)))
        .digest('hex') !== expected
    )
      throw new Error('MapLibre integrity mismatch: ' + name);
  const passkeyBundle = await readFile(
    new URL('../public/vendor/simplewebauthn-browser-13.2.2.js', import.meta.url),
  );
  const installedBundle = await readFile(
    new URL(
      '../node_modules/@simplewebauthn/browser/dist/bundle/index.umd.min.js',
      import.meta.url,
    ),
  );
  if (!passkeyBundle.equals(installedBundle))
    throw new Error('SimpleWebAuthn bundle differs from the installed locked dependency');
  output = resolve(output);
  const root = fileURLToPath(new URL('..', import.meta.url));
  await assertBuildOutput(output, root);
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(new URL('../public/', import.meta.url), output, { recursive: true });
  // Discover top-level assets so a new shared module cannot miss cache versioning.
  const assetNames = (await readdir(new URL('../public/', import.meta.url)))
    .filter((name) => /\.(?:js|css|webmanifest)$/.test(name))
    .sort();
  const assets = Object.fromEntries(
    await Promise.all(
      assetNames.map(async (name) => [
        name,
        await readFile(new URL('../public/' + name, import.meta.url), 'utf8'),
      ]),
    ),
  );
  const iconHash = createHash('sha256')
    .update(await readFile(new URL('../public/favicon.svg', import.meta.url)))
    .update(await readFile(new URL('../public/apple-touch-icon.png', import.meta.url)))
    .digest('hex');
  const version = Object.values(assets)
    .reduce(
      (hash, source) => hash.update(source),
      createHash('sha256')
        .update(iconHash)
        .update(passkeyBundle)
        .update(page)
        .update(planningPage)
        .update(JSON.stringify(manifest))
        .update(JSON.stringify({ apiBase, authMode, customDomain })),
    )
    .digest('hex')
    .slice(0, 12);
  const csp = securityHeaders['Content-Security-Policy']
    .replace(/; frame-ancestors[^;]*/, '')
    .replace(
      "connect-src 'self'",
      `connect-src 'self'${apiBase ? ' ' + new URL(apiBase).origin : ''}`,
    );
  // Relative files support both /taiwan-map/ and a custom domain root.
  const html = page
    .replace(/(href|src)="\/(?!api\/)/g, '$1="./')
    .replace(
      /((?:href|src)="\.\/(?:[a-z-]+\.(?:js|css)|favicon\.svg|apple-touch-icon\.png))"/g,
      `$1?v=${version}"`,
    )
    .replace(
      '<meta name="theme-color"',
      `<meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="strict-origin-when-cross-origin"><meta name="theme-color"`,
    );
  await writeFile(resolve(output, 'index.html'), html);
  const plannerHtml = planningPage
    .replace(/(href|src)="\/(?!api\/)/g, '$1="./')
    .replace(
      /((?:href|src)="\.\/(?:[a-z-]+\.(?:js|css)|favicon\.svg|apple-touch-icon\.png))"/g,
      `$1?v=${version}"`,
    )
    .replace(
      '<meta name="theme-color"',
      `<meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="referrer" content="strict-origin-when-cross-origin"><meta name="theme-color"`,
    );
  await writeFile(resolve(output, 'planning.html'), plannerHtml);
  for (const [name, source] of Object.entries(assets))
    if (name.endsWith('.js')) {
      const versioned = source.replace(
        /\b(from\s*|import\s*\(\s*|import\s*)(['"])(\.\/[a-z-]+\.js)\2/g,
        (original, prefix, quote, path) =>
          assets[path.slice(2)] ? `${prefix}${quote}${path}?v=${version}${quote}` : original,
      );
      await writeFile(resolve(output, name), versioned);
    }
  await writeFile(
    resolve(output, 'config.js'),
    '// Public config, not a secret store.\nwindow.TAIWAN_CONFIG = Object.freeze(' +
      JSON.stringify({ apiBase, requiresApi: true, authMode }) +
      ');\n',
  );
  for (const size of [192, 512])
    await writeFile(resolve(output, 'icon-' + size + '.png'), appIcon(size));
  await writeFile(resolve(output, '.nojekyll'), '');
  if (customDomain) await writeFile(resolve(output, 'CNAME'), customDomain + '\n');
  return { output, apiConfigured: !!apiBase, customDomain: customDomain || null };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const deployment = JSON.parse(
    await readFile(new URL('../pages.config.json', import.meta.url), 'utf8'),
  );
  console.log(
    JSON.stringify(
      await buildPages({
        apiBase: process.env.PAGES_API_BASE || deployment.apiBase || '',
        customDomain: process.env.PAGES_CUSTOM_DOMAIN || deployment.customDomain || '',
        authMode: process.env.PAGES_AUTH_MODE || deployment.authMode || 'bearer',
      }),
    ),
  );
}
