import path from 'path';
import fs from 'fs';
import mkdirp from 'mkdirp';
import execa from 'execa';
import {BuilderOptions, MessageError} from '@pika/types';
const DEFAULT_ENTRYPOINT = 'types';

function getTsConfigPath(options, cwd) {
  return path.resolve(cwd, options.tsconfig || 'tsconfig.json');
}

function getTscBin(cwd) {
  try {
    return require.resolve('typescript/bin/tsc', {paths: [cwd]});
  } catch (err) {
    // ignore err
    return null;
  }
}

export function manifest(manifest, {options}: BuilderOptions) {
  if (options.entrypoint !== null) {
    let keys = options.entrypoint || [DEFAULT_ENTRYPOINT];
    if (typeof keys === 'string') {
      keys = [keys];
    }
    for (const key of keys) {
      manifest[key] = manifest[key] || 'dist-types/index.d.ts';
    }
  }
}

export async function beforeBuild({options, cwd}: BuilderOptions) {
  const tsConfigPath = getTsConfigPath(options, cwd);
  if (options.tsconfig && !fs.existsSync(tsConfigPath)) {
    throw new MessageError(`"${tsConfigPath}" file does not exist.`);
  }
}

export async function build({cwd, out, options, reporter}: BuilderOptions): Promise<void> {
  await (async () => {
    const writeToTypings = path.join(out, 'dist-types/index.d.ts');
    const importAsNode = path.join(out, 'dist-node', 'index.js');

    if (fs.existsSync(path.join(cwd, 'index.d.ts'))) {
      mkdirp.sync(path.dirname(writeToTypings));
      fs.copyFileSync(path.join(cwd, 'index.d.ts'), writeToTypings);
      return;
    }
    if (fs.existsSync(path.join(cwd, 'src', 'index.d.ts'))) {
      mkdirp.sync(path.dirname(writeToTypings));
      fs.copyFileSync(path.join(cwd, 'src', 'index.d.ts'), writeToTypings);
      return;
    }

    const tsConfigPath = getTsConfigPath(options, cwd);
    const tscBin = getTscBin(cwd);
    const additionalArgs = options.args || [];
    if (tscBin && fs.existsSync(tsConfigPath)) {
      await execa(
        tscBin,
        [
          '-d',
          '--emitDeclarationOnly',
          '--declarationMap',
          'false',
          '--project',
          tsConfigPath,
          '--declarationDir',
          path.join(out, 'dist-types/'),
          ...additionalArgs,
        ],
        {cwd},
      );
      return;
    }

    // !!! Still experimental:
    // const dtTypesDependency = path.join(
    //   cwd,
    //   "node_modules",
    //   "@types",
    //   manifest.name
    // );
    // const dtTypesExist = fs.existsSync(dtTypesDependency);
    // if (dtTypesExist) {
    //   fs.copyFileSync(dtTypesDependency, writeToTypings);
    //   return;
    // }

    reporter.info('no type definitions found, auto-generating...');
    const tsc = (await import('typescript')) as any;
    if (!tsc.generateTypesForModule) {
      console.error(`
  ⚠️  dist-types/: Attempted to generate type definitions, but "typescript@^3.5.0" no longer supports this.
                  Please either downgrade typescript, or author an "index.d.ts" type declaration file yourself.
                  See https://github.com/pikapkg/builders/issues/65 for more info.
  `);
      throw new Error(`Failed to build: dist-types/`);
    }

    const nodeImport = await import(importAsNode);
    const guessedTypes = tsc.generateTypesForModule('AutoGeneratedTypings', nodeImport, {});
    mkdirp.sync(path.dirname(writeToTypings));
    fs.writeFileSync(writeToTypings, guessedTypes);
  })();

  reporter.created(path.join(out, 'dist-types', 'index.d.ts'), 'types');
}
