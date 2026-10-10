import {execFileSync} from 'node:child_process';
import {copyFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
for(const [command,args] of [['chatterbot/node_modules/typescript/bin/tsc',['-b']],['chatterbot/node_modules/vite/bin/vite.js',['build']]]){
  execFileSync(process.execPath,[root+command,...args],{cwd:root+'chatterbot',stdio:'inherit'});
}
copyFileSync(root+'bunkr/ui/client/index.html',root+'bunkr/ui/index.html');
