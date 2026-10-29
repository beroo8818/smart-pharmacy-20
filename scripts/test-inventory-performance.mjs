import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(repo,'package.json'));
const desktop=process.argv.includes('--desktop'),root=desktop?path.join(repo,'desktop'):repo;
const filters=process.argv.slice(2).filter(x=>x!=='--desktop');
const {startVitest}=await import(pathToFileURL(require.resolve('vitest/node')));
process.chdir(repo);
const suite=await startVitest('test',filters,{root,config:false,run:true},{
  define:{'import.meta.env.VITE_SUPABASE_URL':JSON.stringify('http://127.0.0.1:54321'),'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify('local-test-only')},
  server:{fs:{allow:[path.dirname(repo)]}},esbuild:{jsx:'automatic'},
  resolve:{alias:{'@':path.join(root,'src'),react:path.dirname(require.resolve('react/package.json')),'react-dom':path.dirname(require.resolve('react-dom/package.json'))},dedupe:['react','react-dom','react-router','react-router-dom','@tanstack/react-query']},
  test:{environment:'jsdom',globals:true,maxWorkers:2,server:{deps:{inline:['react-router','react-router-dom','@tanstack/react-query']}},setupFiles:[path.join(repo,'src/test/setup.ts')],include:['src/**/*.test.{ts,tsx}']},
});
await suite.close();
