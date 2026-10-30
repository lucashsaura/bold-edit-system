// Produto (R10): BOLD_HOME = raiz do pacote, resolvida a partir DESTE arquivo (nunca do cwd nem de um path fixo).
// Versão do produto = package.json (semver). Versões de componentes = config/product.json (internas, "V1").
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function productManifest(root = PACKAGE_ROOT) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const prod = JSON.parse(fs.readFileSync(path.join(root, 'config', 'product.json'), 'utf8'));
  let plugin = null;
  try { plugin = JSON.parse(fs.readFileSync(path.join(root, '.claude-plugin', 'plugin.json'), 'utf8')); } catch { /* sem plugin */ }
  return { schema: 'bold.product-manifest/1', product: prod.product, version: pkg.version, package: pkg.name, bold_home: root,
    platform: { current: process.platform, support: prod.platforms[process.platform] ?? 'UNSUPPORTED' }, platforms: prod.platforms,
    node: { required: pkg.engines?.node ?? null, current: process.versions.node },
    components: prod.components, claude: { skill: 'bold-edit', skill_dir: 'skills/edit', plugin: plugin ? { name: plugin.name, version: plugin.version } : null } };
}
