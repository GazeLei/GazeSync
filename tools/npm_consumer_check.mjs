/** Verify a tarball-installed consumer, without source-tree aliases or a registry upload. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (!process.argv[2])
  throw new Error(
    "Pass a directory containing a tarball-installed node_modules/gazesync",
  );
const directory = resolve(process.argv[2]);
const installed = join(directory, "node_modules/gazesync");
const pkg = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
assert.equal(pkg.type, "module");
assert.deepEqual(Object.keys(pkg.exports).sort(), [
  ".",
  "./adapters",
  "./browser",
  "./simulation",
]);
assert.equal(Object.keys(pkg.dependencies ?? {}).length, 0);
for (const hook of [
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "dependencies",
])
  assert.equal(
    pkg.scripts?.[hook],
    undefined,
    `Unexpected installation lifecycle hook: ${hook}`,
  );
const consumer = mkdtempSync(join(directory, "gazesync-consumer-"));
const esm = `
import assert from 'node:assert/strict';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {GazeSession, InteractionController, createView, contentToViewport} from 'gazesync';
import {ModelAdapter} from 'gazesync/adapters';
import {generateExperiment, executeExperiment, summarizeExperiment} from 'gazesync/simulation';
import {attachBrowserControls, createGazeSurface} from 'gazesync/browser';
assert.equal(realpathSync(fileURLToPath(import.meta.resolve('gazesync'))), ${JSON.stringify(realpathSync(join(installed, "dist/index.js")))});
assert.equal(typeof document, 'undefined');
assert.equal(typeof attachBrowserControls, 'function');
assert.equal(typeof createGazeSurface, 'function');
const controller = new InteractionController(createView({width:800,height:600,contentWidth:400,contentHeight:200,panBounds:'none'}));
controller.rotate(Math.PI/2, 0);
const p=contentToViewport(controller.view,{x:300,y:100});
assert.ok(Math.abs(p.x-400)<1e-8 && Math.abs(p.y-500)<1e-8);
assert.ok(new GazeSession());
assert.equal(typeof ModelAdapter,'function');
const e=generateExperiment({width:390,height:844,displayHz:120,inputHz:1000,gazeHz:600,rightGazeHz:120,mode:'binocular-independent',contentMotion:true});
const s=summarizeExperiment(e,executeExperiment(e));
assert.ok(s.samples>0 && s.samples===s.expectedSamples && s.mappedSamples>0);
assert.equal(s.frameMismatches,0);assert.equal(s.pendingSamples,0);assert.equal(s.replayExact,true);
assert.ok(Number.isFinite(s.maxReconstructionErrorPx) && s.maxReconstructionErrorPx<1e-8);
console.log(JSON.stringify({esmImports:4,samples:s.samples,replayExact:s.replayExact}));
`;
writeFileSync(join(consumer, "runtime.mjs"), esm);
const esmResult = JSON.parse(
  execFileSync(process.execPath, [join(consumer, "runtime.mjs")], {
    cwd: consumer,
    encoding: "utf8",
  }),
);
writeFileSync(
  join(consumer, "runtime.cjs"),
  `
const assert=require('node:assert/strict');
assert.throws(()=>require('gazesync'), {code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});
(async()=>{const {createView}=await import('gazesync');assert.equal(createView({width:100,height:100,contentWidth:100,contentHeight:100}).scale,1)})().catch(e=>{console.error(e);process.exitCode=1});
`,
);
execFileSync(process.execPath, [join(consumer, "runtime.cjs")], {
  cwd: consumer,
  stdio: "pipe",
});
writeFileSync(
  join(consumer, "core.mts"),
  `
import {createView, GazeSession, type GazeSample} from 'gazesync';
import {ModelAdapter} from 'gazesync/adapters';
import {generateExperiment, type ExperimentConfig} from 'gazesync/simulation';
const v=createView({width:100,height:100,contentWidth:100,contentHeight:100});
const s=new GazeSession();
s.present({t:0,view:v,surface:{id:'s',epoch:'1'}});
const a=new ModelAdapter({sourceId:'m',clockId:'session',clockEpoch:'0',surfaceId:'s',surfaceEpoch:'1',type:'pog2d',eye:'left',timestampUnit:'ms'});
// @ts-expect-error valid rays require their actual ray geometry
const invalid:GazeSample={id:'i',sourceId:'m',eye:'left',clockId:'session',clockEpoch:'0',timeMs:1,surfaceId:'s',surfaceEpoch:'1',type:'ray3d',valid:true,confidence:1};
const config:ExperimentConfig={width:100,height:100,displayHz:60,inputHz:120,gazeHz:120,mode:'monocular-left'};
void [a,invalid,generateExperiment(config)];
`,
);
copyFileSync(
  join(root, "tests/types/consumer.ts"),
  join(consumer, "browser.mts"),
);
const compiler = join(root, "node_modules/typescript/bin/tsc");
for (const [name, module, lib, source] of [
  ["node-core", "NodeNext", ["ES2022"], "core.mts"],
  ["node-browser", "NodeNext", ["ES2022", "DOM"], "browser.mts"],
  ["bundler-browser", "ESNext", ["ES2022", "DOM"], "browser.mts"],
]) {
  const config = join(consumer, `tsconfig-${name}.json`);
  writeFileSync(
    config,
    JSON.stringify({
      compilerOptions: {
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        module,
        moduleResolution: module === "NodeNext" ? "NodeNext" : "Bundler",
        target: "ES2022",
        lib,
        types: [],
      },
      files: [source],
    }),
  );
  execFileSync(process.execPath, [compiler, "-p", config], {
    cwd: consumer,
    stdio: "pipe",
  });
}
console.log(
  JSON.stringify(
    {
      package: pkg.name,
      version: pkg.version,
      ...esmResult,
      commonjsDynamicImport: true,
      staticRequireSupported: false,
      installedTypeChecks: [
        "NodeNext core without DOM",
        "NodeNext browser",
        "Bundler browser",
      ],
      installationHooks: 0,
    },
    null,
    2,
  ),
);
