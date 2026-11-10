import {readFile,readdir,stat} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
let count=0;
async function walk(dir){for(const name of await readdir(dir)){const file=join(dir,name);if((await stat(file)).isDirectory())await walk(file);else if(file.endsWith('.js')||file.endsWith('.mjs')){const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});if(result.status){console.error(result.stderr);process.exit(1);}count++;}}}
await walk('extension');await walk('scripts');
const manifest=JSON.parse(await readFile('extension/manifest.json'));
for(const path of [manifest.background.service_worker,manifest.action.default_popup,manifest.options_page.split('#')[0],...Object.values(manifest.icons)])await stat(join('extension',path));
if(manifest.manifest_version!==3)throw new Error('Manifest V3 requerido');
if(manifest.permissions.includes('contextMenus')||manifest.permissions.includes('activeTab'))throw new Error('El alta del sitio actual no requiere contextMenus ni activeTab.');
for(const file of ['extension/background.js','extension/popup.js'])if(/chrome\.contextMenus/.test(await readFile(file,'utf8')))throw new Error(`Menú contextual retirado: ${file}`);
console.log(`${count} módulos válidos. Manifiesto y recursos correctos.`);
