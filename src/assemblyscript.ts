// Forked from https://github.com/ed-25519/vite-plugin-assemblyscript-asc/blob/main/src/index.ts
import asc from 'assemblyscript/dist/asc.js'
import fs from 'fs'
import type { SourceMapPayload } from 'module'
import { join, resolve } from 'path'
import type { Plugin } from 'vite'

interface AssemblyScriptPluginOptions {
  projectRoot: string
  configFile: string
  srcMatch: string
  srcEntryFile: string
  mapFile: string
  sourceRoot: string
  extra: string[]
}

const defaultOptions: AssemblyScriptPluginOptions = {
  projectRoot: '.',
  sourceRoot: '/',
  configFile: 'asconfig.json',
  srcMatch: 'assembly',
  srcEntryFile: 'assembly/index.ts',
  mapFile: './build/index.wasm.map',
  extra: [],
}

async function compile(
  entryFile: string,
  mode: 'debug' | 'release',
  options: AssemblyScriptPluginOptions,
  server?: any,
  signal?: AbortSignal,
) {
  console.log('[asc] compiling...')

  const { error, stdout, stderr, stats } = await asc.main(
    [entryFile, '--config', options.configFile, '--target', mode, ...options.extra.flat(Infinity)],
    {},
  )

  if (signal?.aborted) return

  if (error) {
    console.log('Compilation failed: ' + error.message)
    console.log(stdout.toString())
    console.log(stderr.toString())
  }
  else {
    console.log(stdout.toString())
    console.log(stats.toString())
    const mapFile = join(options.projectRoot, options.mapFile)

    if (signal?.aborted) return

    const mapJson = fs.readFileSync(mapFile, 'utf-8')
    const map = JSON.parse(mapJson) as SourceMapPayload

    if (signal?.aborted) return

    // This is the magic that makes paths work for open-in-editor from devtools console.
    map.sourceRoot = options.sourceRoot

    fs.writeFileSync(mapFile, JSON.stringify(map), 'utf-8')

    if (signal?.aborted) return

    if (server) {
      const wasmFile = mapFile.replace('.map', '')
      const wasmPath = wasmFile.startsWith('./')
        ? wasmFile.slice(1)
        : '/' + wasmFile.replace(options.projectRoot + '/', '')
      server.ws.send({
        type: 'update',
        updates: [
          {
            type: 'js-update',
            path: wasmPath,
            acceptedPath: wasmPath,
            timestamp: Date.now(),
          },
        ],
      })
    }
  }
}

export function assemblyScript(
  userOptions: Partial<AssemblyScriptPluginOptions> = defaultOptions,
): Plugin {
  const options = {
    ...defaultOptions,
    ...userOptions,
  }

  const entryFile = join(options.projectRoot, options.srcEntryFile)
  const matchPath = resolve(join(options.projectRoot, options.srcMatch))

  let handledTimestamp: any
  let buildMode: 'debug' | 'release' = 'debug'
  let viteServer: any
  let currentAbortController: AbortController | null = null
  let isCompiling = false
  let pendingCompile = false
  let debounceTimeout: NodeJS.Timeout | null = null

  const runCompile = async () => {
    if (isCompiling) {
      pendingCompile = true
      return
    }

    isCompiling = true
    pendingCompile = false

    const abortController = new AbortController()
    currentAbortController = abortController

    try {
      await compile(entryFile, 'debug', options, viteServer, abortController.signal)
    }
    finally {
      currentAbortController = null
      isCompiling = false

      if (pendingCompile) {
        runCompile()
      }
    }
  }

  return {
    name: 'vite-plugin-assemblyscript',
    configResolved(config) {
      buildMode = config.mode === 'production' ? 'release' : 'debug'
    },
    configureServer(server) {
      viteServer = server
    },
    async handleHotUpdate({ file, timestamp }) {
      if (file.startsWith(matchPath)) {
        if (timestamp === handledTimestamp) return
        handledTimestamp = timestamp

        if (currentAbortController) {
          currentAbortController.abort()
        }

        if (debounceTimeout) {
          clearTimeout(debounceTimeout)
        }

        debounceTimeout = setTimeout(() => {
          debounceTimeout = null
          runCompile()
        }, 500)
      }
    },
    async buildStart() {
      await compile(entryFile, buildMode, options)
    },
  }
}
